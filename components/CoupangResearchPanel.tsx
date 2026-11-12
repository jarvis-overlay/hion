'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { analyzeCoupangResults } from '@/lib/coupangMarket';
import { colorMismatch, sizeMismatch } from '@/lib/candidateFilter';
import {
  researchCoupangComparisons,
  type CoupangResearchCandidate,
  type CoupangResearchResult,
} from '@/app/dashboard/sourcing/list/researchActions';
import { addSourcingComparisons } from '@/app/dashboard/sourcing/list/actions';
import { Badge, MarketBadgeRow } from '@/components/MarketBadge';
import { MARKET_SIZE_LABEL } from '@/components/ComparisonEntryEditor';

type Mismatch = { material: 'dict' | 'ai' | null; size: string | null; color: string | null };

function candidateKey(c: CoupangResearchCandidate, i: number): string {
  return c.url || String(i);
}

function parsePrice(p: string | null): number | null {
  if (!p) return null;
  const n = Number(p.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
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
  const [applied, setApplied] = useState({ size: '', color: '' });
  const [loading, setLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [result, setResult] = useState<CoupangResearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [priceRange, setPriceRange] = useState('');
  const [priceRangeTouched, setPriceRangeTouched] = useState(false);
  const [marketSize, setMarketSize] = useState<'high' | 'mid' | 'low' | ''>('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      map.set(candidateKey(c, i), {
        material: c.materialBadge ? (c.materialBadge.type === 'dictionary_different' ? 'dict' : 'ai') : null,
        size: applied.size ? sizeMismatch(applied.size, c.name) : null,
        color: applied.color ? colorMismatch(applied.color, c.name) : null,
      });
    });
    return map;
  }, [result, applied]);

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
  const anyMismatchKeys = keysWhere((m) => m.material === 'dict' || !!m.size || !!m.color);
  const visibleKeys = result
    ? result.candidates.map((c, i) => candidateKey(c, i)).filter((k) => !removed.has(k))
    : [];
  const uncheckedKeys = visibleKeys.filter((k) => !selected.has(k));

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

  async function handleResearch() {
    if (!keyword.trim() || loading) return;
    setLoading(true);
    setResearchError(null);
    setResult(null);
    setSelected(new Set());
    setRemoved(new Set());
    setSaveError(null);
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
      setApplied({ size: userSize.trim(), color: userColor.trim() });
      setResult(res);
      setPriceRange('');
      setPriceRangeTouched(false);
      setMarketSize(res.suggestedMarketSize);
    } finally {
      setLoading(false);
    }
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

          <div className="grid gap-1.5">
            {result.candidates
              .map((c, i) => ({ c, key: candidateKey(c, i) }))
              .filter(({ key }) => !removed.has(key))
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
                      <div className="flex flex-wrap gap-1 mt-0.5 empty:hidden">
                        {c.materialBadge && (
                          <Badge tier={c.materialBadge.type === 'ai_different' ? 'ok' : 'bad'}>
                            {c.materialBadge.type === 'dictionary_different'
                              ? `재질 다름: ${c.materialBadge.matchedKeyword}`
                              : 'AI 추정: 다른 방식일 수 있음'}
                          </Badge>
                        )}
                        {mismatches.get(key)?.size && (
                          <Badge tier="bad">사이즈 다름: {mismatches.get(key)?.size}</Badge>
                        )}
                        {mismatches.get(key)?.color && (
                          <Badge tier="bad">색상 다름: {mismatches.get(key)?.color}</Badge>
                        )}
                      </div>
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
