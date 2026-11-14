'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { analyzeCoupangResults } from '@/lib/coupangMarket';
import { colorMismatch, sizeMismatch } from '@/lib/candidateFilter';
import { scoreCandidate, type DimState, type ScoreResult } from '@/lib/candidateScore';
import type { ImageMatchResult } from '@/lib/candidateImageMatch';
import {
  researchCoupangComparisons,
  inspectCoupangCandidate,
  matchCandidateImages,
  type CandidateDetail,
  type CoupangResearchCandidate,
  type CoupangResearchResult,
} from '@/app/dashboard/sourcing/list/researchActions';
import { addSourcingComparisons } from '@/app/dashboard/sourcing/list/actions';
import { Badge, MarketBadgeRow } from '@/components/MarketBadge';
import { MARKET_SIZE_LABEL } from '@/components/ComparisonEntryEditor';

type DetailState =
  | { status: 'loading' }
  | { status: 'done'; detail: CandidateDetail }
  | { status: 'error'; message: string };

// 한 번 누를 때 읽어볼 후보 수 상한. 동시에 1개씩만 읽는다 - Next.js가 화면에서 부른
// 서버 액션을 어차피 한 줄로 세워서 하나씩 실행하고, Bright Data 분당 호출 제한도 있다.
const INSPECT_MAX = 12;
const INSPECT_CONCURRENCY = 1;

type Mismatch = { material: 'dict' | 'ai' | 'detail' | null; size: string | null; color: string | null };

function candidateKey(c: CoupangResearchCandidate, i: number): string {
  return c.url || String(i);
}

function parsePrice(p: string | null): number | null {
  if (!p) return null;
  const n = Number(p.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type SortMode = 'default' | 'accuracy' | 'review' | 'priceAsc' | 'priceDesc';

// 내 상품 사진을 화면에서 줄여서(긴 변 640px JPEG) 서버로 보낸다 - 사진 원본이 크면
// 서버 호출 크기 제한에 걸리고 AI 비교에도 이 정도면 충분하다.
const IMAGE_BATCH = 8;
const REF_MAX_SIDE = 640;

type RefImage = { dataUrl: string; mimeType: 'image/jpeg'; base64: string };

async function fileToRefImage(file: File): Promise<RefImage> {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일(JPG/PNG)만 올릴 수 있어요.');
  const url = URL.createObjectURL(file);
  try {
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('이 사진을 열 수 없어요. JPG/PNG로 저장해서 다시 올려주세요.'));
      el.src = url;
    });
    const scale = Math.min(1, REF_MAX_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('사진을 처리하지 못했어요.');
    ctx.fillStyle = '#fff'; // 투명 PNG 배경이 검게 나오지 않게
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { dataUrl, mimeType: 'image/jpeg', base64: dataUrl.split(',')[1] || '' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DIM_MARK: Record<DimState, string> = { match: '✓', mismatch: '✗', unknown: '?' };
const DIM_CLS: Record<DimState, string> = {
  match: 'text-profit',
  mismatch: 'text-warn',
  unknown: 'text-inkSoft',
};

function parseCount(s: string | null): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 값이 없는 후보(가격 미상 등)는 어느 방향이든 항상 맨 아래로 보낸다.
function compareNullLast(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

// 선택된 후보들의 가격을 보고 "price_range" 기본값을 만든다. 쿠팡
// 가격대 표기(components/SourcingList.tsx의 PLATFORM_LABEL 옆에 쓰는
// 문구)와 같은 형식("12,000~34,000원" / "12,000원")으로 맞춤.
function suggestPriceRange(selected: CoupangResearchCandidate[]): string {
  const prices = selected.map((c) => parsePrice(c.price)).filter((n): n is number => n != null);
  if (prices.length === 0) return '';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `${min.toLocaleString()}원` : `${min.toLocaleString()}~${max.toLocaleString()}원`;
}

// 소싱 리스트 카드의 "비교 상품군"에서 쓰는 하위 패널 - 손으로 쿠팡을
// 검색해서 베껴 적지 않고, 이미 있는 쿠팡 실데이터 조사 로직을 그대로
// 호출해서 후보를 보여주고 체크한 것만 비교 상품으로 저장한다.
export default function CoupangResearchPanel({
  item,
  onSaved,
}: {
  item: any;
  onSaved: () => void;
}) {
  const [keyword, setKeyword] = useState(item.title || '');
  const [userMaterial, setUserMaterial] = useState('');
  const [userSize, setUserSize] = useState('');
  const [userColor, setUserColor] = useState('');
  // 조사하기를 누른 시점의 사이즈/색상 - 조사 후 입력칸을 고쳐도 이미 받은
  // 후보의 배지가 슬쩍 바뀌지 않게 고정해둔다(다시 조사해야 반영).
  const [applied, setApplied] = useState({ keyword: '', material: '', size: '', color: '' });
  const [details, setDetails] = useState<Map<string, DetailState>>(new Map());
  const [inspecting, setInspecting] = useState(false);
  const [inspectProgress, setInspectProgress] = useState({ done: 0, total: 0 });
  const [inspectSummary, setInspectSummary] = useState('');
  // 상세 확인을 중간에 멈추거나, 새로 조사하기를 눌렀을 때 옛 작업의 결과가
  // 새 목록에 섞이지 않게 하는 번호표(바뀌면 옛 작업은 결과를 버린다)
  const inspectRun = useRef(0);
  useEffect(() => () => { inspectRun.current++; }, []);

  // 내 상품 사진 비교(선택): 사진은 이 화면에서만 쓰고 저장하지 않는다.
  const [refImage, setRefImage] = useState<RefImage | null>(null);
  const [refError, setRefError] = useState('');
  const [imageRequested, setImageRequested] = useState(false); // 이번 조사에 사진 비교를 쓰는지
  const [imageMatches, setImageMatches] = useState<Map<string, ImageMatchResult>>(new Map());
  const [imageMatching, setImageMatching] = useState(false);
  const [imageProgress, setImageProgress] = useState({ done: 0, total: 0 });
  const [imageSummary, setImageSummary] = useState('');
  const imageRun = useRef(0);
  useEffect(() => () => { imageRun.current++; }, []);
  const [loading, setLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [result, setResult] = useState<CoupangResearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [priceRange, setPriceRange] = useState('');
  const [priceRangeTouched, setPriceRangeTouched] = useState(false);
  const [marketSize, setMarketSize] = useState<'high' | 'mid' | 'low' | ''>('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 조사 결과 자동 저장/복원 - 패널을 닫았다 다시 열어도(또는 새로고침해도) 마지막에 보던
  // 화면이 그대로 돌아오게 한다. 이 브라우저(localStorage)에 항목별로 저장하고, 내 상품 사진은
  // 저장하지 않는다. 저장이 안 되는 환경(프라이빗 창 등)에서는 조용히 건너뛴다.
  const storageKey = `hion.coupangResearch.v1.${item.id}`;
  const [hydrated, setHydrated] = useState(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const s = raw ? JSON.parse(raw) : null;
      const strs = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      if (s && s.v === 1) {
        if (typeof s.keyword === 'string') setKeyword(s.keyword);
        if (typeof s.userMaterial === 'string') setUserMaterial(s.userMaterial);
        if (typeof s.userSize === 'string') setUserSize(s.userSize);
        if (typeof s.userColor === 'string') setUserColor(s.userColor);
        if (s.applied && typeof s.applied === 'object') {
          setApplied({
            keyword: String(s.applied.keyword ?? ''),
            material: String(s.applied.material ?? ''),
            size: String(s.applied.size ?? ''),
            color: String(s.applied.color ?? ''),
          });
        }
        // 조사 결과가 없는 저장본(입력칸만 저장됨)이면 입력칸만 복원한다
        if (!(s.result && Array.isArray(s.result.candidates))) {
          setHydrated(true);
          return;
        }
        setResult(s.result as CoupangResearchResult);
        setSelected(new Set(strs(s.selected)));
        setRemoved(new Set(strs(s.removed)));
        if (['default', 'accuracy', 'review', 'priceAsc', 'priceDesc'].includes(s.sortMode)) {
          setSortMode(s.sortMode as SortMode);
        }
        if (typeof s.priceRange === 'string') setPriceRange(s.priceRange);
        if (s.marketSize === 'high' || s.marketSize === 'mid' || s.marketSize === 'low') setMarketSize(s.marketSize);
        if (Array.isArray(s.details)) {
          setDetails(
            new Map(
              s.details
                .filter((e: any) => Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object')
                .map((e: any) => [e[0], { status: 'done', detail: e[1] } as DetailState])
            )
          );
        }
        if (Array.isArray(s.imageMatches)) {
          setImageMatches(
            new Map(
              s.imageMatches.filter((e: any) => Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object')
            )
          );
        }
        setImageRequested(s.imageRequested === true);
        setRestoredAt(typeof s.savedAt === 'number' ? s.savedAt : Date.now());
      }
    } catch {
      // 저장된 값이 깨졌거나 접근 불가 - 복원만 건너뛴다
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated || loading) return;
    try {
      if (!result) {
        // 아직 조사 전이라도 입력칸(검색어·재질·사이즈·색상)은 남겨둔다. 단, 이미 저장된 조사 결과가
        // 있으면(조사 실패 등으로 화면이 잠깐 비었을 때) 그걸 지우지 않는다.
        const dirty = keyword !== (item.title || '') || !!userMaterial || !!userSize || !!userColor;
        if (!dirty) return;
        const prevRaw = localStorage.getItem(storageKey);
        const prev = prevRaw ? JSON.parse(prevRaw) : null;
        if (prev && prev.result) return;
      }
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          v: 1,
          savedAt: Date.now(),
          keyword,
          userMaterial,
          userSize,
          userColor,
          applied,
          result,
          selected: [...selected],
          removed: [...removed],
          sortMode,
          priceRange,
          marketSize,
          details: [...details.entries()]
            .filter(([, d]) => d.status === 'done')
            .map(([k, d]) => [k, (d as { status: 'done'; detail: CandidateDetail }).detail]),
          imageMatches: [...imageMatches.entries()],
          imageRequested,
        })
      );
    } catch {
      // 용량 초과 등 - 저장만 건너뛴다
    }
  }, [
    hydrated, loading, item.title, storageKey, result, keyword, userMaterial, userSize, userColor, applied,
    selected, removed, sortMode, priceRange, marketSize, details, imageMatches, imageRequested,
  ]);

  function clearSavedResearch() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // 무시
    }
    imageRun.current++;
    inspectRun.current++;
    setImageMatching(false);
    setInspecting(false);
    setResult(null);
    setRestoredAt(null);
    setSelected(new Set());
    setRemoved(new Set());
    setDetails(new Map());
    setImageMatches(new Map());
    setImageRequested(false);
    setImageSummary('');
  }

  function selectedCandidates(): CoupangResearchCandidate[] {
    if (!result) return [];
    return result.candidates.filter((c, i) => selected.has(candidateKey(c, i)));
  }

  function handleToggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 경쟁 상품이 아닌 후보(재질·용도가 다른 상품 등)를 목록에서 치운다.
  // 저장 전 후보 목록에서만 숨기는 것이라 DB엔 영향 없다.
  function handleRemove(key: string) {
    setRemoved((prev) => new Set(prev).add(key));
    setSelected((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  // 후보별 "내 상품과 다른 점"(재질/사이즈/색상). 재질은 서버가 이미 판정해서
  // 내려준 materialBadge, 사이즈/색상은 상품명만 보고 여기서 바로 계산한다.
  const mismatches = useMemo(() => {
    const map = new Map<string, Mismatch>();
    if (!result) return map;
    result.candidates.forEach((c, i) => {
      const key = candidateKey(c, i);
      let material: Mismatch['material'] = c.materialBadge
        ? c.materialBadge.type === 'dictionary_different'
          ? 'dict'
          : 'ai'
        : null;
      let size = applied.size ? sizeMismatch(applied.size, c.name) : null;
      let color = applied.color ? colorMismatch(applied.color, c.name) : null;

      // 상품 페이지를 직접 읽어 확인한 결과가 있으면 상품명만 보고 한 추정보다
      // 우선한다(옵션에 내 사이즈/색이 있는데 상품명엔 다른 게 적힌 경우 등).
      const d = details.get(key);
      if (d?.status === 'done') {
        const det = d.detail;
        if (det.materialVerdict === 'different') material = 'detail';
        // 페이지를 읽은 AI가 "같다"고 해도 사전이 확정한 재질 다름 배지는 지우지 않는다
        // (제목에 다른 재질 단어가 있는 건 확실한 근거). 제목만 보고 한 AI 추정만 정정한다.
        else if (det.materialVerdict === 'same' && material === 'ai') material = null;
        if (det.sizeStatus === 'mismatch') size = `확인된 옵션에 없음(${det.sizes.slice(0, 3).join(', ')})`;
        else if (det.sizeStatus === 'match') size = null;
        if (det.colorStatus === 'mismatch') color = `확인된 옵션에 없음(${det.colors.slice(0, 3).join(', ')})`;
        else if (det.colorStatus === 'match') color = null;
      }
      map.set(key, { material, size, color });
    });
    return map;
  }, [result, applied, details]);

  // 후보별 정확도 점수(0~100). 상품명 + 사전/AI 재질 판정 + 상품 페이지를 읽은 결과를 합친다.
  const scores = useMemo(() => {
    const map = new Map<string, ScoreResult>();
    if (!result) return map;
    result.candidates.forEach((c, i) => {
      const key = candidateKey(c, i);
      const d = details.get(key);
      map.set(
        key,
        scoreCandidate({
          title: c.name,
          keyword: applied.keyword,
          conditions: { material: applied.material, size: applied.size, color: applied.color },
          materialBadge: c.materialBadge
            ? c.materialBadge.type === 'dictionary_different'
              ? 'dict'
              : 'ai'
            : null,
          detail:
            d?.status === 'done'
              ? {
                  materialVerdict: d.detail.materialVerdict,
                  sizeStatus: d.detail.sizeStatus,
                  colorStatus: d.detail.colorStatus,
                }
              : null,
          image: imageMatches.get(key) ?? null,
          // 사진 비교 결과가 하나도 없으면(전부 실패) 점수에 넣지 않는다 - 안 그러면 모든 후보가
          // 똑같이 "사진 모름"으로 같은 점수가 되어 정확도순 정렬이 의미가 없어진다
          imageRequested: imageRequested && imageMatches.size > 0,
        })
      );
    });
    return map;
  }, [result, applied, details, imageMatches, imageRequested]);

  // 아직 안 지운 후보 중 해당 종류로 걸린 것의 key 목록
  function keysWhere(pred: (m: Mismatch) => boolean): string[] {
    const keys: string[] = [];
    mismatches.forEach((m, key) => {
      if (!removed.has(key) && pred(m)) keys.push(key);
    });
    return keys;
  }

  function removeMany(keys: string[]) {
    if (keys.length === 0) return;
    setRemoved((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  }

  // "확정" 불일치(사전 재질/사이즈/색상)만 일괄 제거 대상으로 묶는다.
  // AI 추정은 틀릴 수 있어서 별도 버튼으로 따로 둔다.
  const materialKeys = keysWhere((m) => m.material === 'dict');
  const aiKeys = keysWhere((m) => m.material === 'ai');
  const sizeKeys = keysWhere((m) => !!m.size);
  const colorKeys = keysWhere((m) => !!m.color);
  const detailMaterialKeys = keysWhere((m) => m.material === 'detail');
  // 사진이 확실히 다른 후보(AI 추정이라 "전부" 버튼엔 넣지 않고 따로 둔다)
  const imageKeys: string[] = [];
  scores.forEach((s, key) => {
    if (!removed.has(key) && s.image === 'mismatch') imageKeys.push(key);
  });
  const anyMismatchKeys = keysWhere(
    (m) => m.material === 'dict' || !!m.size || !!m.color
  );
  const visibleKeys = result
    ? result.candidates.map((c, i) => candidateKey(c, i)).filter((k) => !removed.has(k))
    : [];
  const uncheckedKeys = visibleKeys.filter((k) => !selected.has(k));
  const pendingInspectCount = visibleKeys.filter((k) => details.get(k)?.status !== 'done').length;

  // 남은 후보(안 지운 것) 기준으로 시장규모/경쟁강도/가격대를 다시 계산한다.
  // 서버가 준 badges는 "지우기 전 전체 후보" 기준이라, 재질 다른 상품을
  // 지우고도 그 숫자가 그대로면 시장 판단이 흐려진다.
  const liveBadges = useMemo(() => {
    if (!result) return null;
    const remaining = result.candidates.filter((c, i) => !removed.has(candidateKey(c, i)));
    if (remaining.length === 0) return null;
    return analyzeCoupangResults(
      remaining.map((c, i) => ({
        rank: i + 1,
        name: c.name,
        price: c.price,
        reviewCount: c.reviewCount,
        url: c.url,
        imageUrl: c.imageUrl,
      }))
    )?.badges ?? null;
  }, [result, removed]);

  // 선택이 바뀔 때마다, 사용자가 직접 가격대를 수정하지 않았으면 선택된
  // 후보 기준으로 다시 추천값을 채워준다 (직접 수정한 뒤에는 덮어쓰지 않음).
  useEffect(() => {
    if (!result || priceRangeTouched) return;
    const picked = result.candidates.filter((c, i) => selected.has(candidateKey(c, i)));
    setPriceRange(suggestPriceRange(picked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, result]);

  // 사진을 바꾸거나 지우면 이전 사진 기준의 비교 결과는 버린다(새 사진 점수로 오해하지 않게)
  function resetImageMatches() {
    imageRun.current++;
    setImageMatching(false);
    setImageMatches(new Map());
    setImageSummary('');
    setImageRequested(false);
  }

  async function handleRefFile(file: File | null) {
    setRefError('');
    if (!file) return;
    try {
      const next = await fileToRefImage(file);
      resetImageMatches();
      setRefImage(next);
    } catch (e: any) {
      setRefImage(null);
      setRefError(typeof e?.message === 'string' && /[가-힣]/.test(e.message) ? e.message : '사진을 불러오지 못했어요.');
    }
  }

  // 후보 사진을 내 상품 사진과 비교한다. 후보를 IMAGE_BATCH장씩 묶어 순서대로 보낸다.
  // (한 번에 다 보내면 느리고 중간 실패 시 전부 날아감 / 진행 표시·중단 가능)
  async function runImageMatch(
    cands: CoupangResearchCandidate[],
    ref: RefImage,
    skipKeys: Set<string>,
    alreadyDone: Set<string>
  ) {
    const run = ++imageRun.current;
    const items = cands
      .map((c, i) => ({ key: candidateKey(c, i), url: c.imageUrl }))
      .filter((x) => !!x.url && !skipKeys.has(x.key) && !alreadyDone.has(x.key));
    if (items.length === 0) {
      setImageMatching(false);
      setImageSummary('새로 비교할 후보가 없어요. (이미 모두 비교했거나, 사진이 없는 후보예요)');
      return;
    }
    setImageMatching(true);
    setImageSummary('');
    setImageProgress({ done: 0, total: items.length });
    let done = 0;
    let compared = 0;
    let failedBatches = 0;
    let lastError = '';
    for (let s = 0; s < items.length && imageRun.current === run; s += IMAGE_BATCH) {
      const batch = items.slice(s, s + IMAGE_BATCH);
      try {
        const res = await matchCandidateImages(
          { mimeType: ref.mimeType, base64: ref.base64 },
          batch.map((b) => b.url)
        );
        if (imageRun.current !== run) return;
        if ('error' in res) {
          failedBatches++;
          lastError = res.error;
        } else {
          setImageMatches((prev) => {
            const next = new Map(prev);
            batch.forEach((b, n) => {
              const r = res.results[n];
              if (r) next.set(b.key, r);
            });
            return next;
          });
          compared += res.results.filter(Boolean).length;
        }
      } catch {
        if (imageRun.current !== run) return;
        failedBatches++;
        lastError = '사진 비교 중 오류가 났어요.';
      }
      done += batch.length;
      setImageProgress({ done, total: items.length });
    }
    if (imageRun.current === run) {
      setImageMatching(false);
      const missed = items.length - compared;
      setImageSummary(
        compared === 0
          ? `사진을 비교하지 못했어요. ${lastError || '후보 사진을 받아오지 못했어요.'} 버튼을 다시 눌러보세요.`
          : missed > 0
            ? `${items.length}개 중 ${compared}개를 비교했어요. 나머지 ${missed}개는 사진을 못 받았거나 AI가 판단하지 못했어요${failedBatches > 0 && lastError ? ` (${lastError})` : ''}. 버튼을 다시 누르면 그 후보만 다시 비교해요.`
            : `사진 비교 완료 (${compared}개)`
      );
    }
  }

  function handleImageMatchClick() {
    if (!result || !refImage || imageMatching) return;
    // 이미 비교한 후보와 지운 후보는 건너뛰고, 못 한 후보만 다시 비교한다
    setImageRequested(true);
    runImageMatch(result.candidates, refImage, removed, new Set(imageMatches.keys()));
  }

  function handleStopImageMatch() {
    imageRun.current++;
    setImageMatching(false);
  }

  async function handleResearch() {
    if (!keyword.trim() || loading) return;
    setLoading(true);
    setResearchError(null);
    imageRun.current++;
    setImageMatching(false);
    setImageMatches(new Map());
    setImageSummary('');
    setResult(null);
    setSelected(new Set());
    setRemoved(new Set());
    setSaveError(null);
    inspectRun.current++;
    setInspecting(false);
    setDetails(new Map());
    setRestoredAt(null);
    try {
      const res = await researchCoupangComparisons(keyword, {
        material: userMaterial.trim(),
        size: userSize.trim(),
        color: userColor.trim(),
      });
      if ('error' in res) {
        setResearchError(res.error);
        return;
      }
      setApplied({
        keyword: keyword.trim(),
        material: userMaterial.trim(),
        size: userSize.trim(),
        color: userColor.trim(),
      });
      // 조건을 적었으면 "내 상품과 가까운 순"으로 먼저 보여준다
      setSortMode(
        userMaterial.trim() || userSize.trim() || userColor.trim() || refImage ? 'accuracy' : 'default'
      );
      setResult(res);
      // 내 상품 사진이 있으면 조사가 끝나는 대로 후보 사진과 비교를 시작한다(화면은 먼저 보여줌)
      setImageRequested(!!refImage);
      if (refImage) runImageMatch(res.candidates, refImage, new Set(), new Set());
      setPriceRange('');
      setPriceRangeTouched(false);
      setMarketSize(res.suggestedMarketSize);
    } finally {
      setLoading(false);
    }
  }

  // 남은 후보의 쿠팡 상품 페이지를 읽어서 상품정보(소재)와 옵션(사이즈/색상)을
  // 확인한다. 후보당 Bright Data 호출 1번 + AI 1번이라 느리고 비용이 들어서,
  // 눌렀을 때만 / 안 지운 후보만 / 최대 INSPECT_MAX개씩 처리한다.
  async function handleInspect() {
    if (!result || inspecting) return;
    const targets = visibleKeys
      .filter((k) => details.get(k)?.status !== 'done')
      // 체크한 것 먼저, 그다음 정확도 점수가 높은 것부터(위쪽 후보부터 확인해야 의미가 큼)
      .sort(
        (a, b) =>
          Number(selected.has(b)) - Number(selected.has(a)) ||
          (scores.get(b)?.score ?? 0) - (scores.get(a)?.score ?? 0)
      )
      .slice(0, INSPECT_MAX);
    if (targets.length === 0) return;

    const byKey = new Map<string, CoupangResearchCandidate>();
    result.candidates.forEach((c, i) => byKey.set(candidateKey(c, i), c));

    const run = ++inspectRun.current;
    setInspecting(true);
    setInspectProgress({ done: 0, total: targets.length });
    setInspectSummary('');
    setDetails((prev) => {
      const next = new Map(prev);
      targets.forEach((k) => next.set(k, { status: 'loading' }));
      return next;
    });

    let cursor = 0;
    let done = 0;
    let failed = 0;
    async function worker() {
      while (cursor < targets.length && inspectRun.current === run) {
        const key = targets[cursor++];
        const c = byKey.get(key);
        let state: DetailState;
        try {
          const res = c
            ? await inspectCoupangCandidate(c.url, {
                material: applied.material,
                size: applied.size,
                color: applied.color,
              })
            : { error: '후보를 찾지 못했어요.' };
          state = 'error' in res ? { status: 'error', message: res.error } : { status: 'done', detail: res.detail };
        } catch {
          state = { status: 'error', message: '확인 중 오류가 났어요. 다시 시도해주세요.' };
        }
        if (inspectRun.current !== run) return;
        done++;
        if (state.status === 'error') failed++;
        setInspectProgress({ done, total: targets.length });
        setDetails((prev) => new Map(prev).set(key, state));
      }
    }
    await Promise.all(Array.from({ length: INSPECT_CONCURRENCY }, worker));
    if (inspectRun.current === run) {
      setInspecting(false);
      setInspectSummary(
        `${done}개 확인 완료` + (failed > 0 ? ` (실패 ${failed}개 - 후보 옆 문구를 보고 다시 눌러보세요)` : '')
      );
    }
  }

  function handleStopInspect() {
    inspectRun.current++;
    setInspecting(false);
    // 아직 읽는 중이던 항목은 로딩 표시를 풀어준다
    setDetails((prev) => {
      const next = new Map(prev);
      next.forEach((v, k) => {
        if (v.status === 'loading') next.delete(k);
      });
      return next;
    });
  }

  function handleSave() {
    const picked = selectedCandidates();
    if (picked.length === 0) {
      setSaveError('저장할 후보를 1개 이상 선택해주세요.');
      return;
    }
    setSaveError(null);
    startTransition(async () => {
      const res = await addSourcingComparisons(
        item.id,
        picked.map((c) => ({
          title: c.name,
          link: c.url,
          prices: [{ platform: 'coupang' as const, priceRange, marketSize }],
          source: 'coupang_auto' as const,
        }))
      );
      if (!res || 'error' in res) {
        setSaveError(res?.error ?? '저장에 실패했어요. 다시 시도해주세요.');
        return;
      }
      // 저장한 후보는 체크 표시를 풀어둔다(다시 열었을 때 같은 후보를 또 저장하지 않게).
      // 패널이 곧 닫혀서 자동 저장이 못 돌 수 있으니 저장본도 직접 고친다.
      setSelected(new Set());
      try {
        const raw = localStorage.getItem(storageKey);
        const s = raw ? JSON.parse(raw) : null;
        if (s && typeof s === 'object') {
          s.selected = [];
          localStorage.setItem(storageKey, JSON.stringify(s));
        }
      } catch {
        // 무시
      }
      onSaved();
    });
  }

  return (
    <div className="grid gap-3 bg-paper rounded-md p-3">
      <div className="flex gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
          placeholder="조사할 키워드"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
        />
        <button
          type="button"
          onClick={handleResearch}
          disabled={loading || !keyword.trim()}
          className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50 shrink-0"
        >
          {loading ? '조사 중...' : '조사하기'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input
          value={userMaterial}
          onChange={(e) => setUserMaterial(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
          placeholder="재질/방식 (예: 극세사)"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs min-w-0"
        />
        <input
          value={userSize}
          onChange={(e) => setUserSize(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
          placeholder="사이즈 (예: 40x60)"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs min-w-0"
        />
        <input
          value={userColor}
          onChange={(e) => setUserColor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
          placeholder="색상 (예: 그레이)"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs min-w-0"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <label className="cursor-pointer rounded-full bg-white px-3 py-1 font-semibold text-accent ring-1 ring-paperLine hover:ring-accent">
          {refImage ? '내 상품 사진 바꾸기' : '내 상품 사진 올리기 (선택)'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              handleRefFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </label>
        {refImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={refImage.dataUrl} alt="내 상품 사진" className="w-9 h-9 rounded object-cover ring-1 ring-paperLine" />
            <button
              type="button"
              onClick={() => {
                resetImageMatches();
                setRefImage(null);
                setRefError('');
              }}
              className="text-inkSoft underline"
            >
              사진 지우기
            </button>
          </>
        )}
        <span className="text-inkSoft">
          사진을 올리고 조사하면 후보 사진과 AI로 비교해서 닮은 정도를 점수에 반영해요. 사진은 이 화면에서만 쓰고 저장하지 않아요.
        </span>
      </div>
      {refError && <p className="text-[11px] text-warn">{refError}</p>}
      <p className="text-[11px] text-inkSoft -mt-1.5">
        재질·사이즈·색상은 선택이에요. 적으면 검색어에 같이 넣어서 찾고, 상품명에 다른 값이 적힌 후보엔 배지를 달아줘요(여러 개는 쉼표로).
      </p>

      {loading && (
        <p className="text-[11px] text-inkSoft">
          조사 중이에요... 캡차 재시도가 겹치면 최대 1~2분 걸릴 수 있어요.
        </p>
      )}

      {researchError && (
        <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1.5">
          {researchError} 수동으로 비교 상품을 추가해주세요.
        </p>
      )}

      {result && restoredAt && (
        <p className="text-[11px] text-inkSoft bg-white ring-1 ring-paperLine rounded px-2 py-1.5">
          마지막으로 보던 조사 결과를 불러왔어요 (
          {new Date(restoredAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          ). 이 브라우저에만 저장돼요. 새로 찾으려면 &quot;조사하기&quot;를 누르세요.{' '}
          <button type="button" onClick={clearSavedResearch} className="underline">
            저장된 결과 지우기
          </button>
        </p>
      )}

      {result && (
        <>
          <p className="text-[11px] text-inkSoft">
            쿠팡 검색어: <span className="text-ink font-semibold">{result.searchedQuery}</span>
          </p>
          {result.fallbackNote && (
            <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1.5">{result.fallbackNote}</p>
          )}

          {liveBadges ? (
            <>
              <MarketBadgeRow badges={liveBadges} />
              {removed.size > 0 && (
                <p className="text-[11px] text-inkSoft">
                  제거하고 남은 {visibleKeys.length}개 기준으로 다시 계산한 값이에요.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-inkSoft">후보를 모두 제거해서 시장 분석을 표시할 수 없어요.</p>
          )}

          {(refImage || imageRequested) && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-white ring-1 ring-paperLine px-2 py-1.5 text-[11px]">
              <button
                type="button"
                onClick={handleImageMatchClick}
                disabled={!refImage || imageMatching}
                className="rounded-full bg-accentBg px-3 py-1 font-semibold text-accent disabled:opacity-50"
              >
                {imageMatching
                  ? `사진 비교 중 ${imageProgress.done}/${imageProgress.total}`
                  : imageRequested
                    ? '사진 비교 다시 하기 (못 한 후보만)'
                    : '내 사진으로 후보 비교하기'}
              </button>
              {imageMatching && (
                <button type="button" onClick={handleStopImageMatch} className="text-inkSoft underline">
                  멈추기
                </button>
              )}
              {imageSummary && !imageMatching && <span className="font-semibold text-ink">{imageSummary}</span>}
              {!refImage && imageRequested && (
                <span className="text-inkSoft">사진을 지워서 다시 비교할 수 없어요. 사진을 올려주세요.</span>
              )}
              <span className="text-inkSoft">AI가 사진만 보고 추정한 점수라 틀릴 수 있어요.</span>
            </div>
          )}

          <div className="grid gap-1 rounded-md bg-white ring-1 ring-paperLine px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleInspect}
                disabled={inspecting || visibleKeys.filter((k) => details.get(k)?.status !== 'done').length === 0}
                className="rounded-full bg-accentBg px-3 py-1 text-[11px] font-semibold text-accent disabled:opacity-50"
              >
                {inspecting
                  ? `상세·옵션 확인 중 ${inspectProgress.done}/${inspectProgress.total}`
                  : `남은 후보 상세·옵션 확인 (최대 ${INSPECT_MAX}개)`}
              </button>
              {inspecting && (
                <button
                  type="button"
                  onClick={handleStopInspect}
                  className="text-[11px] text-inkSoft underline"
                >
                  멈추기
                </button>
              )}
            </div>
            {inspectSummary && !inspecting && (
              <p className="text-[11px] text-ink font-semibold">{inspectSummary}</p>
            )}
            {!inspecting && pendingInspectCount > INSPECT_MAX && (
              <p className="text-[11px] text-inkSoft">
                확인 안 한 후보가 {pendingInspectCount}개예요. 한 번에 {INSPECT_MAX}개씩만 읽으니, 먼저 지운 뒤 누르거나 끝나고 한 번 더 누르면 다음 {INSPECT_MAX}개를 읽어요.
              </p>
            )}
            <p className="text-[11px] text-inkSoft">
              각 후보의 쿠팡 페이지를 하나씩 열어 소재·사이즈·색상 옵션을 읽어서 비교해요. 후보당 10~40초라 12개면 2~8분쯤 걸리고,
              먼저 일괄 제거나 ✕로 아닌 것들을 지운 뒤 누르세요. 페이지에 적혀 있지 않은 정보는 판정하지 않아요.
            </p>
          </div>

          {(anyMismatchKeys.length > 0 || aiKeys.length > 0 || uncheckedKeys.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-white ring-1 ring-paperLine px-2 py-1.5">
              <span className="text-[11px] text-inkSoft shrink-0">일괄 제거</span>
              {materialKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => removeMany(materialKeys)}
                  className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:text-warn"
                >
                  재질 다름 {materialKeys.length}개
                </button>
              )}
              {detailMaterialKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => removeMany(detailMaterialKeys)}
                  title="상품 페이지를 읽고 AI가 판정한 결과예요. 근거 문구를 확인하세요"
                  className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:text-warn"
                >
                  상세 확인 재질 다름 {detailMaterialKeys.length}개
                </button>
              )}
              {sizeKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => removeMany(sizeKeys)}
                  className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:text-warn"
                >
                  사이즈 다름 {sizeKeys.length}개
                </button>
              )}
              {colorKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => removeMany(colorKeys)}
                  className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:text-warn"
                >
                  색상 다름 {colorKeys.length}개
                </button>
              )}
              {imageKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => removeMany(imageKeys)}
                  title="AI가 사진을 보고 추정한 것이라 틀릴 수 있어요. 지우기 전에 사진을 확인하세요"
                  className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:text-warn"
                >
                  사진 많이 다름(AI 추정) {imageKeys.length}개
                </button>
              )}
              {aiKeys.length > 0 && (
                <button
                  type="button"
                  onClick={() => removeMany(aiKeys)}
                  title="AI가 추정한 것이라 틀릴 수 있어요"
                  className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:text-warn"
                >
                  AI 추정 다름 {aiKeys.length}개
                </button>
              )}
              {anyMismatchKeys.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMany(anyMismatchKeys)}
                  className="rounded-full bg-warnBg px-2.5 py-1 text-[11px] font-semibold text-warn"
                >
                  조건 안 맞는 것 전부 {anyMismatchKeys.length}개
                </button>
              )}
              {uncheckedKeys.length > 0 && selected.size > 0 && (
                <button
                  type="button"
                  onClick={() => removeMany(uncheckedKeys)}
                  className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink hover:text-warn"
                >
                  체크 안 한 것 {uncheckedKeys.length}개
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-inkSoft">정렬</span>
            {(
              [
                ['default', '쿠팡 순서'],
                ['accuracy', '정확도 높은 순'],
                ['review', '리뷰 많은 순'],
                ['priceAsc', '가격 낮은 순'],
                ['priceDesc', '가격 높은 순'],
              ] as [SortMode, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`rounded-full px-2.5 py-1 font-semibold ${
                  sortMode === mode ? 'bg-ink text-white' : 'bg-paper text-ink hover:text-accent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-1.5">
            {result.candidates
              .map((c, i) => ({ c, key: candidateKey(c, i) }))
              .filter(({ key }) => !removed.has(key))
              .sort((x, y) => {
                if (sortMode === 'accuracy') {
                  const d = (scores.get(y.key)?.score ?? 0) - (scores.get(x.key)?.score ?? 0);
                  // 점수가 같으면 리뷰 많은 쪽이 위
                  return d || compareNullLast(parseCount(x.c.reviewCount), parseCount(y.c.reviewCount), -1);
                }
                if (sortMode === 'review') return compareNullLast(parseCount(x.c.reviewCount), parseCount(y.c.reviewCount), -1);
                if (sortMode === 'priceAsc') return compareNullLast(parsePrice(x.c.price), parsePrice(y.c.price), 1);
                if (sortMode === 'priceDesc') return compareNullLast(parsePrice(x.c.price), parsePrice(y.c.price), -1);
                return 0;
              })
              .map(({ c, key }) => {
                const checked = selected.has(key);
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer ring-1 ${
                      checked ? 'ring-accent bg-accentBg' : 'ring-paperLine bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggle(key)}
                      className="shrink-0"
                    />
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        className="w-10 h-10 rounded object-cover shrink-0 bg-paperLine"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded shrink-0 bg-paperLine" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-ink line-clamp-2 leading-snug">{c.name}</p>
                      <p className="text-inkSoft">
                        {c.price ? `${c.price}원` : '가격 미상'}
                        {c.reviewCount ? ` · 리뷰 ${c.reviewCount}개` : ''}
                      </p>
                      {(() => {
                        const s = scores.get(key);
                        if (!s) return null;
                        const dims: [string, DimState | null][] = [
                          ['재질', s.material],
                          ['사이즈', s.size],
                          ['색상', s.color],
                          ['사진', s.image],
                        ];
                        const shown = dims.filter((x): x is [string, DimState] => x[1] != null);
                        return (
                          <p className="text-[11px] flex flex-wrap items-center gap-x-2">
                            <span
                              className={`font-semibold ${
                                s.score >= 70 ? 'text-profit' : s.score >= 40 ? 'text-ink' : 'text-warn'
                              }`}
                            >
                              정확도 {s.score}점
                            </span>
                            {shown.map(([label, st]) => (
                              <span key={label} className={DIM_CLS[st]}>
                                {label} {DIM_MARK[st]}
                                {label === '재질' && s.aiGuess ? '(AI추정)' : ''}
                                {label === '사진' && s.imageScore != null ? ` ${s.imageScore}%` : ''}
                                {label === '사진' && st === 'mismatch' && imageMatches.get(key)?.note
                                  ? ` (${imageMatches.get(key)?.note})`
                                  : ''}
                              </span>
                            ))}
                            {shown.some(([label, st]) => label !== '사진' && st === 'unknown') && !s.inspected && (
                              <span className="text-inkSoft">· ? = 상품명만으론 몰라요</span>
                            )}
                          </p>
                        );
                      })()}
                      <div className="flex flex-wrap gap-1 mt-0.5 empty:hidden">
                        {/* 재질 배지는 일괄 제거 버튼과 같은 판정(mismatches)을 그려서, 배지와 버튼 숫자가 어긋나지 않게 한다 */}
                        {mismatches.get(key)?.material === 'dict' && c.materialBadge?.type === 'dictionary_different' && (
                          <Badge tier="bad">재질 다름: {c.materialBadge.matchedKeyword}</Badge>
                        )}
                        {mismatches.get(key)?.material === 'ai' && (
                          <Badge tier="ok">AI 추정: 다른 방식일 수 있음</Badge>
                        )}
                        {mismatches.get(key)?.material === 'detail' && (
                          <Badge tier="bad">상세 확인: 재질 다름</Badge>
                        )}
                        {mismatches.get(key)?.size && (
                          <Badge tier="bad">사이즈 다름: {mismatches.get(key)?.size}</Badge>
                        )}
                        {mismatches.get(key)?.color && (
                          <Badge tier="bad">색상 다름: {mismatches.get(key)?.color}</Badge>
                        )}
                      </div>
                      {(() => {
                        const d = details.get(key);
                        if (!d) return null;
                        if (d.status === 'loading') return <p className="text-[11px] text-inkSoft">상세 읽는 중...</p>;
                        if (d.status === 'error')
                          return <p className="text-[11px] text-warn">상세 확인 실패: {d.message}</p>;
                        const det = d.detail;
                        const parts = [
                          det.material ? `소재 ${det.material}` : null,
                          det.sizes.length ? `사이즈 ${det.sizes.slice(0, 4).join(', ')}` : null,
                          det.colors.length ? `색상 ${det.colors.slice(0, 4).join(', ')}` : null,
                        ].filter(Boolean);
                        return (
                          <p className="text-[11px] text-inkSoft">
                            {parts.length ? `상세: ${parts.join(' · ')}` : '상세: 페이지에서 소재/옵션 정보를 못 찾았어요'}
                            {det.evidence ? ` (근거: "${det.evidence}")` : ''}
                          </p>
                        );
                      })()}
                    </div>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-profit underline shrink-0"
                    >
                      [링크]
                    </a>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemove(key);
                      }}
                      title="경쟁 상품 아님 - 목록에서 제거"
                      className="text-inkSoft hover:text-warn shrink-0 px-1"
                    >
                      ✕
                    </button>
                  </label>
                );
              })}
          </div>

          {removed.size > 0 && (
            <button
              type="button"
              onClick={() => setRemoved(new Set())}
              className="text-[11px] text-inkSoft underline justify-self-start"
            >
              제거한 {removed.size}개 다시 보기
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <input
              value={priceRange}
              onChange={(e) => {
                setPriceRange(e.target.value);
                setPriceRangeTouched(true);
              }}
              placeholder="형성 가격대 (선택 시 자동 채움)"
              className="border border-paperLine bg-white px-2 py-1.5 text-xs"
            />
            <select
              value={marketSize}
              onChange={(e) => setMarketSize(e.target.value as 'high' | 'mid' | 'low' | '')}
              className="border border-paperLine bg-white px-2 py-1.5 text-xs"
            >
              <option value="">시장규모</option>
              <option value="high">{MARKET_SIZE_LABEL.high}</option>
              <option value="mid">{MARKET_SIZE_LABEL.mid}</option>
              <option value="low">{MARKET_SIZE_LABEL.low}</option>
            </select>
          </div>

          {saveError && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1.5">{saveError}</p>}

          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || selected.size === 0}
            className="btn-primary py-1.5 text-xs font-semibold self-start px-4 disabled:opacity-50"
          >
            {isPending ? '저장 중...' : `선택한 ${selected.size}개 저장`}
          </button>
        </>
      )}
    </div>
  );
}
