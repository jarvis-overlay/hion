'use client';

import { useMemo, useRef, useState } from 'react';
import { shrinkImageForUpload } from '@/lib/clientImage';
import {
  uploadDetailSources,
  learnDetailFlowNow,
  planDetailPage,
  generatePlannedSections,
  recolorPhotos,
  addSizeTableSection,
  type PhotoReportItem,
} from '@/app/dashboard/sales/detail-pages/actions';
import {
  DEFAULT_SIZE_NOTE,
  mergeSellingOptions,
  parseSizeTableText,
  planRecolorJobs,
  type PlannedSection,
  type SellingOptions,
  type SourceAnalysis,
} from '@/lib/detailOptions';
import { DETAIL_SPEC_TEXT } from '@/lib/imageSpecs';
import type { DetailFlowBrief } from '@/lib/detailCompose';

// 여러 장의 중국 상품 사진을 한꺼번에 올리면 사진 속 중국어와 내용을 분석하고, 쿠팡 인기상품
// 상세페이지 흐름을 참고해서 장면 목록을 짠 뒤 장면을 차례로 생성한다. 핵심 규칙: 중국 사진에
// 색상/사이즈가 여러 개 나와도 "내가 실제로 판매하는 색상·사이즈"만 상세페이지에 들어간다.
//
// 서버 액션은 한 클라이언트에서 차례로 하나씩만 실행되므로, 사진 업로드/장면 생성은 3개씩
// 묶어서 호출한다 (한 호출 안에서 서버가 3개를 동시에 처리).

interface SourceItem {
  id: string;
  file: File;
  previewUrl: string;
  colorLabel: string;
  status: 'ready' | 'uploading' | 'done' | 'error';
  error?: string;
  analysisFailed?: boolean;
  overlaysRemoved?: number;
}

type Stage = 'idle' | 'upload' | 'recolor' | 'flow' | 'plan' | 'generate' | 'done';

// 올린 사진(또는 색상을 바꿔 만든 사진) 한 장 - 구성 기획에 넘기는 단위
interface UploadedPhoto {
  name: string;
  colorLabel: string;
  url: string;
  analysis: SourceAnalysis | null;
  converted?: boolean;
}
type GenStatus = 'pending' | 'running' | 'ok' | 'error';

const TEMPLATE_LABEL: Record<string, string> = {
  'white-simple': '화이트 심플',
  'overlay-lifestyle': '오버레이 라이프스타일',
  'overlay-bright': '오버레이 브라이트',
  'overlay-mood': '오버레이 퍼플 무드',
  'brand-mood': '브랜드 무드(퍼플)',
  'brand-mood-light': '브랜드 무드(라이트)',
  'quote-minimal': '미니멀 카피',
  'badge-list': '인증뱃지+리스트',
  'stat-highlight': '통계 강조',
  spec: '제품 사양 표',
  'size-table': '사이즈표',
};

const CHUNK = 3;

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export default function DetailAutoComposer({ project, sectionCount }: { project: any; sectionCount: number }) {
  const [productName, setProductName] = useState<string>(project.title || '');
  const [category, setCategory] = useState<string>(project.category || '');
  const [colorsText, setColorsText] = useState('');
  const [sizesText, setSizesText] = useState('');
  const [sizeText, setSizeText] = useState('');
  const [sizeNote, setSizeNote] = useState(DEFAULT_SIZE_NOTE);
  const [sizeBusy, setSizeBusy] = useState(false);
  const [sizeMsg, setSizeMsg] = useState<string | null>(null);
  const [recolorOn, setRecolorOn] = useState(true);
  const [recolorProgress, setRecolorProgress] = useState({ done: 0, total: 0 });
  const parsedSize = useMemo(() => parseSizeTableText(sizeText), [sizeText]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // 결과
  const [flow, setFlow] = useState<DetailFlowBrief | null>(null);
  const [flowMsg, setFlowMsg] = useState<string | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlannedSection[]>([]);
  const [genStatus, setGenStatus] = useState<{ status: GenStatus; error?: string }[]>([]);
  const [photoReport, setPhotoReport] = useState<(PhotoReportItem & { name: string })[]>([]);
  const [selling, setSelling] = useState<SellingOptions | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const busy = stage !== 'idle' && stage !== 'done';

  async function addFiles(list: FileList | null) {
    const raws = Array.from(list || []);
    if (raws.length === 0) return;
    const shrunk = await Promise.all(raws.map((r) => shrinkImageForUpload(r)));
    setSources((prev) => [
      ...prev,
      ...shrunk.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: URL.createObjectURL(f),
        colorLabel: '',
        status: 'ready' as const,
      })),
    ]);
  }

  function patchSource(id: string, patch: Partial<SourceItem>) {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // 쿠팡 인기상품 상세페이지 흐름만 먼저 학습/확인 (결과를 화면에 보여준다)
  async function handleLearnFlow(force: boolean) {
    if (!category.trim()) {
      setFlowMsg('카테고리(쿠팡 검색어)를 먼저 입력해주세요.');
      return;
    }
    setFlowBusy(true);
    setFlowMsg(null);
    const res = await learnDetailFlowNow(category.trim(), force);
    setFlowBusy(false);
    if (!res || 'error' in res) {
      setFlowMsg(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
      return;
    }
    setFlow(res.flow);
    setFlowMsg(
      (res.fromCache ? '저장된 흐름을 불러왔어요.' : '쿠팡 인기상품을 분석해서 흐름을 새로 학습했어요.') +
        (res.warning ? ` ${res.warning}` : '')
    );
  }

  async function run() {
    if (busy || sources.length === 0) return;
    if (sizeText.trim() && !parsedSize.table) {
      setError(parsedSize.error || '사이즈표를 확인해주세요.');
      return;
    }
    setError(null);
    setSummary(null);
    setNotes([]);
    setPlan([]);
    setGenStatus([]);
    setPhotoReport([]);
    setRecolorProgress({ done: 0, total: 0 });

    // 1) 사진 올리기 + 분석 (3장씩)
    setStage('upload');
    const items = sources.slice();
    setUploadProgress({ done: 0, total: items.length });
    const uploaded: UploadedPhoto[] = [];
    let doneCount = 0;
    for (const group of chunks(items, CHUNK)) {
      group.forEach((it) => patchSource(it.id, { status: 'uploading', error: undefined }));
      const fd = new FormData();
      group.forEach((it) => fd.append('images', it.file));
      let results: Awaited<ReturnType<typeof uploadDetailSources>> = [];
      try {
        results = await uploadDetailSources(project.id, fd);
      } catch (e: any) {
        results = group.map(() => ({ error: e?.message || '업로드 요청이 실패했어요.' }));
      }
      group.forEach((it, k) => {
        const r = results[k];
        if (!r || 'error' in r) {
          patchSource(it.id, { status: 'error', error: r?.error ?? '업로드 실패' });
        } else {
          patchSource(it.id, { status: 'done', analysisFailed: !r.analysis, overlaysRemoved: r.overlaysRemoved });
          uploaded.push({ name: it.file.name, colorLabel: it.colorLabel, url: r.url, analysis: r.analysis });
        }
      });
      doneCount += group.length;
      setUploadProgress({ done: doneCount, total: items.length });
    }
    if (uploaded.length === 0) {
      setError('사진을 하나도 올리지 못했어요. 잠시 후 다시 시도해주세요.');
      setStage('idle');
      return;
    }

    // 1-2) 색상 변환: 내가 파는 색상의 사진이 없으면 다른 색 사진을 그 색으로 바꾼다 (검사를 통과한 것만 사용)
    const recolorNotes: string[] = [];
    if (recolorOn && (colorsText.trim() || uploaded.some((u) => u.colorLabel.trim()))) {
      const sellingNow = mergeSellingOptions(colorsText, sizesText, uploaded.map((u) => u.colorLabel));
      const jobs = planRecolorJobs(
        uploaded.map((u) => ({ analysis: u.analysis, label: u.colorLabel.trim() || null })),
        sellingNow
      );
      if (jobs.length > 0) {
        setStage('recolor');
        setRecolorProgress({ done: 0, total: jobs.length });
        const base = uploaded.slice(); // 변환 대상 번호는 이 목록 기준
        let done = 0;
        for (const group of chunks(jobs, 2)) {
          let results: Awaited<ReturnType<typeof recolorPhotos>>;
          try {
            results = await recolorPhotos(
              project.id,
              group.map((j) => ({ url: base[j.sourceIndex].url, from: j.from, to: j.to }))
            );
          } catch (e: any) {
            results = group.map(() => ({ error: e?.message || '변환 요청이 실패했어요.' }));
          }
          group.forEach((j, k) => {
            const r = results[k];
            const src = base[j.sourceIndex];
            if (r && 'success' in r) {
              uploaded.push({
                name: `${src.name} → ${j.to}`,
                colorLabel: j.to,
                url: r.url,
                converted: true,
                analysis: src.analysis
                  ? { ...src.analysis, colorsShown: [j.to], koreanTexts: [], sizeChart: null, sizesMentioned: [] }
                  : null,
              });
            } else {
              recolorNotes.push(
                `⚠ 사진 ${j.sourceIndex + 1}번을 "${j.to}" 색으로 바꾸지 못해서 쓰지 않았어요: ${r && 'error' in r ? r.error : '실패'}`
              );
            }
          });
          done += group.length;
          setRecolorProgress({ done, total: jobs.length });
        }
      }
    }

    // 2) 쿠팡 인기상품 상세페이지 흐름 (저장된 게 있으면 바로, 없으면 학습 - 오래 걸릴 수 있음)
    setStage('flow');
    let learnedFlow: DetailFlowBrief | null = flow;
    let flowError: string | null = null;
    if (category.trim() && !learnedFlow) {
      const fr = await learnDetailFlowNow(category.trim(), false);
      if (fr && 'success' in fr) {
        learnedFlow = fr.flow;
        setFlow(fr.flow);
      } else {
        flowError = fr?.error ?? '흐름 학습에 실패했어요.';
      }
    }

    // 3) 구성 기획 (사진 분석 + 쿠팡 흐름 + 취급 옵션)
    setStage('plan');
    let planRes: Awaited<ReturnType<typeof planDetailPage>>;
    try {
      planRes = await planDetailPage(project.id, {
        productName,
        category,
        colorsText,
        sizesText,
        sizeTable: parsedSize.table ? { ...parsedSize.table, note: sizeNote } : null,
        flow: learnedFlow,
        flowError: learnedFlow ? null : flowError,
        sources: uploaded.map((u) => ({ url: u.url, colorLabel: u.colorLabel, analysis: u.analysis })),
      });
    } catch (e: any) {
      planRes = { error: e?.message || '구성 기획 요청이 실패했어요.' };
    }
    if (!planRes || 'error' in planRes) {
      setError(planRes?.error ?? '구성 기획에 실패했어요.');
      setStage('idle');
      return;
    }
    setNotes([...recolorNotes, ...planRes.notes]);
    setPlan(planRes.sections);
    setSelling(planRes.selling);
    setPhotoReport(planRes.photoReport.map((p) => ({ ...p, name: uploaded[p.index]?.name ?? `사진 ${p.index + 1}` })));
    setFlow(planRes.flow);

    // 4) 장면 생성 (3개씩)
    setStage('generate');
    const total = planRes.sections.length;
    setGenProgress({ done: 0, total });
    const status: { status: GenStatus; error?: string }[] = planRes.sections.map(() => ({ status: 'pending' }));
    setGenStatus(status.slice());
    let okCount = 0;
    let finished = 0;
    const indexed = planRes.sections.map((planned, i) => ({
      i,
      position: sectionCount + i,
      planned,
      sourceUrl: planned.sourceIndex !== null ? uploaded[planned.sourceIndex]?.url ?? null : null,
    }));
    for (const group of chunks(indexed, CHUNK)) {
      group.forEach((g) => (status[g.i] = { status: 'running' }));
      setGenStatus(status.slice());
      let results: Awaited<ReturnType<typeof generatePlannedSections>>;
      try {
        results = await generatePlannedSections(
          project.id,
          group.map((g) => ({ position: g.position, planned: g.planned, sourceUrl: g.sourceUrl })),
          planRes.selling,
          planRes.forbiddenWords
        );
      } catch (e: any) {
        results = group.map(() => ({ error: e?.message || '생성 요청이 실패했어요.' }));
      }
      group.forEach((g, k) => {
        const r = results[k];
        if (r && 'success' in r) {
          status[g.i] = { status: 'ok' };
          okCount++;
        } else {
          status[g.i] = { status: 'error', error: r && 'error' in r ? r.error : '생성 실패' };
        }
      });
      finished += group.length;
      setGenStatus(status.slice());
      setGenProgress({ done: finished, total });
    }

    setSummary(
      `상세페이지 장면 ${okCount}/${total}개를 만들어서 아래 목록에 추가했어요.` +
        (okCount < total ? ' 실패한 장면은 아래 목록에서 "다시 생성"할 수 있어요.' : '')
    );
    setSources([]); // 같은 사진으로 실수로 또 만들어 장면이 중복되는 걸 막는다
    setStage('done');
  }

  async function addSizeOnly() {
    if (!parsedSize.table) {
      setSizeMsg(parsedSize.error || '사이즈표를 먼저 입력해주세요.');
      return;
    }
    setSizeBusy(true);
    setSizeMsg(null);
    try {
      const res = await addSizeTableSection(project.id, sectionCount, { ...parsedSize.table, note: sizeNote });
      setSizeMsg('error' in res ? res.error : '사이즈표를 장면으로 추가했어요. 아래 목록에서 확인하세요.');
    } catch (e: any) {
      setSizeMsg(e?.message || '요청이 실패했어요. 다시 시도해주세요.');
    }
    setSizeBusy(false);
  }

  const warnNoCategory = !category.trim();

  return (
    <section className="card p-4 grid gap-3 border-2 border-accent/30">
      <div>
        <h3 className="text-sm font-semibold">한 번에 만들기 (사진 여러 장 → 상세페이지 전체)</h3>
        <p className="text-[11px] text-inkSoft leading-relaxed">
          중국 상품 사진을 <strong>여러 장 한꺼번에</strong> 올리면, 사진 속 중국어와 내용을 분석하고{' '}
          <strong>쿠팡 인기상품 상세페이지의 흐름</strong>을 참고해서 장면을 순서대로 한 번에 만들어요. 이미지 규격은{' '}
          <strong>{DETAIL_SPEC_TEXT}</strong>로 정확히 맞춰요. 중국 사진에 색상이 5가지 나와도{' '}
          <strong>아래에 적은 색상·사이즈만</strong> 상세페이지에 들어가고, 사이즈 <strong>치수 숫자는 중국 사진에서 읽지 않고</strong>{' '}
          아래에 직접 입력한 사이즈표로만 만들어요.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 max-w-3xl">
        <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
          상품명
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="예: 남성 드로즈 팬티"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
          쿠팡 검색어(카테고리) - 인기상품 상세페이지를 참고할 기준
          <input
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setFlow(null);
              setFlowMsg(null);
            }}
            placeholder="예: 남성 팬티"
            className={`border bg-white px-2 py-1.5 text-xs font-normal text-ink ${
              warnNoCategory ? 'border-warn' : 'border-paperLine'
            }`}
          />
        </label>
        <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
          내가 판매하는 색상 (쉼표로 구분)
          <input
            value={colorsText}
            onChange={(e) => setColorsText(e.target.value)}
            placeholder="예: 검정, 회색"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
          내가 판매하는 사이즈 (쉼표로 구분)
          <input
            value={sizesText}
            onChange={(e) => setSizesText(e.target.value)}
            placeholder="예: M, L, XL"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink"
          />
        </label>
      </div>
      {warnNoCategory && (
        <p className="text-[11px] text-warn max-w-3xl">
          카테고리를 비우면 쿠팡 인기상품을 참고하지 않고 일반적인 구성으로 만들어요.
        </p>
      )}
      {!colorsText.trim() && !sources.some((s) => s.colorLabel.trim()) && (
        <p className="text-[11px] text-warn max-w-3xl">
          색상을 입력하지 않으면 상세페이지에 색상 정보를 넣지 않고, 색상이 보이는 사진도 쓰지 않아요. 사진마다 색상을
          적어도 돼요.
        </p>
      )}
      {!sizesText.trim() && (
        <p className="text-[11px] text-inkSoft max-w-3xl">
          사이즈를 입력하지 않으면 상세페이지 문구·사양표에 사이즈 정보를 넣지 않아요.
        </p>
      )}

      {/* 사이즈표 (한국 기준 실제 치수 - 직접 입력) */}
      <div className="bg-paper rounded-lg p-3 grid gap-2 max-w-3xl text-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-semibold">사이즈표 (한국 기준 실제 치수 · 직접 입력)</span>
          <button
            type="button"
            onClick={addSizeOnly}
            disabled={sizeBusy || busy || !parsedSize.table}
            className="text-accent font-semibold disabled:opacity-40"
          >
            {sizeBusy ? '만드는 중...' : '사이즈표만 장면으로 추가'}
          </button>
        </div>
        <textarea
          value={sizeText}
          onChange={(e) => {
            setSizeText(e.target.value);
            setSizeMsg(null);
          }}
          rows={5}
          spellCheck={false}
          placeholder={'첫 줄이 열 제목, 아래 줄이 사이즈별 값이에요 (엑셀에서 복사해 붙여넣어도 돼요)\n사이즈\t허리단면\t총길이\t허벅지단면\nM\t34\t24\t28\nL\t36\t25\t29'}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
        />
        {sizeText.trim() && !parsedSize.table && parsedSize.error && <p className="text-warn">{parsedSize.error}</p>}
        {parsedSize.table && (
          <>
            <div className="overflow-x-auto">
              <table className="text-[11px] border border-paperLine bg-white">
                <thead>
                  <tr>
                    {parsedSize.table.headers.map((h, i) => (
                      <th key={i} className="border border-paperLine px-2 py-1 bg-ink text-white font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedSize.table.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci} className={`border border-paperLine px-2 py-1 text-center ${ci === 0 ? 'font-semibold' : ''}`}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <input
              value={sizeNote}
              onChange={(e) => setSizeNote(e.target.value)}
              placeholder="표 아래 안내 문구"
              className="border border-paperLine bg-white px-2 py-1.5 text-xs"
            />
          </>
        )}
        {sizeMsg && <p className="text-profit">{sizeMsg}</p>}
        <p className="text-inkSoft">
          중국 사진의 사이즈표 숫자는 한국으로 들여오면서 달라지므로 사진에서 읽지 않아요. 비워두면 사이즈표 장면은 만들지
          않아요. 취급 사이즈를 입력했다면 그 사이즈 외의 행/열은 표에서 빼요.
        </p>
      </div>

      <label className="flex items-start gap-2 text-[11px] text-inkSoft max-w-3xl">
        <input type="checkbox" checked={recolorOn} onChange={(e) => setRecolorOn(e.target.checked)} className="mt-0.5" />
        <span>
          <strong className="text-ink">색상 자동 변환</strong> - 내가 파는 색상의 사진이 없으면, 다른 색 사진을 그 색으로 바꿔서
          써요 (색상별 최대 2장). 바꾼 결과를 한 번 더 검사해서 색이 안 맞거나 모양이 달라진 사진은 쓰지 않아요.
        </span>
      </label>

      {/* 쿠팡 흐름 미리 확인 */}
      <div className="bg-paper rounded-lg p-3 grid gap-2 max-w-3xl text-xs">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-semibold">
            쿠팡 인기상품 상세페이지 흐름
            {flow
              ? flow.analysis
                ? ` · 상품 ${flow.analysis.products}개의 상세 이미지 ${flow.analysis.detailImages}장 분석`
                : ''
              : ' · 아직 확인 전'}
          </span>
          <button
            type="button"
            onClick={() => handleLearnFlow(!!flow)}
            disabled={flowBusy || busy}
            className="text-accent font-semibold disabled:opacity-50"
          >
            {flowBusy ? '분석 중... (1~2분 걸려요)' : flow ? '다시 학습' : '미리 확인하기'}
          </button>
        </div>
        {flow ? (
          <>
            {flow.analysis && (
              <p className={flow.analysis.detailImages > 0 ? 'text-profit' : 'text-warn'}>
                {flow.analysis.detailImages > 0
                  ? `분석 범위: 대표 이미지 ${flow.analysis.mainImages}장 + 상세 설명 이미지 ${flow.analysis.detailImages}장`
                  : `분석 범위: 대표 이미지 ${flow.analysis.mainImages}장만 (상세 설명 이미지는 읽지 못했어요 - 흐름은 추정이에요)`}
              </p>
            )}
            <p className="text-inkSoft leading-relaxed">{flow.summary}</p>
            <ol className="list-decimal pl-4 grid gap-0.5 text-inkSoft">
              {flow.flow.map((s, i) => (
                <li key={i}>
                  <span className="text-ink font-semibold">{s.title}</span> - {s.purpose}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-inkSoft">
            만들기를 누르면 자동으로 확인해요. 미리 눌러서 어떤 흐름으로 만들어질지 먼저 볼 수도 있어요.
          </p>
        )}
        {flowMsg && <p className="text-profit">{flowMsg}</p>}
      </div>

      {/* 사진 올리기 */}
      <div className="grid gap-2 max-w-3xl">
        {sources.length === 0 ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full sm:w-72 h-28 rounded bg-paper flex items-center justify-center text-[11px] text-inkSoft text-center px-3 hover:bg-paperLine transition"
          >
            클릭해서 중국 상품 사진 첨부
            <br />
            (여러 장 선택 가능 · 상세 이미지, 사이즈표, 색상별 사진 모두 OK)
          </button>
        ) : (
          <div className="grid gap-1.5">
            {sources.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2 bg-paper rounded px-2 py-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.previewUrl} alt="" className="w-12 h-12 object-cover rounded shrink-0" />
                <span className="text-[11px] text-inkSoft w-6 shrink-0">{i + 1}</span>
                <input
                  value={s.colorLabel}
                  onChange={(e) => patchSource(s.id, { colorLabel: e.target.value })}
                  disabled={busy}
                  placeholder="이 사진의 색상 (선택, 예: 검정)"
                  className="border border-paperLine bg-white px-2 py-1 text-xs flex-1 min-w-0"
                />
                <span className="text-[11px] shrink-0">
                  {s.status === 'uploading' && <span className="text-inkSoft">분석 중...</span>}
                  {s.status === 'done' && !s.analysisFailed && (
                    <span className="text-profit">
                      분석 완료{s.overlaysRemoved ? ` · 글자/아이콘 ${s.overlaysRemoved}곳 제거` : ''}
                    </span>
                  )}
                  {s.status === 'done' && s.analysisFailed && <span className="text-warn">분석 실패</span>}
                  {s.status === 'error' && <span className="text-warn">{s.error}</span>}
                </span>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setSources((prev) => prev.filter((x) => x.id !== s.id))}
                    className="text-[11px] text-inkSoft hover:text-red-700 shrink-0"
                  >
                    삭제
                  </button>
                )}
              </div>
            ))}
            {!busy && (
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-accent font-semibold"
                >
                  + 사진 추가
                </button>
                <span className="text-[11px] text-inkSoft">{sources.length}장 선택됨</span>
              </div>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            await addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {sources.length > 0 && (
          <p className="text-[11px] text-inkSoft">
            사진 한 장에 색상이 여러 개 나오는 경우(색상 라인업 등)는, 내가 판매하는 색상 외의 색이 같이 보이면 상품
            사진으로는 쓰지 않아요(중국어 정보만 참고). 색상별 사진에는 위에 색상을 적어두면 정확해져요.
          </p>
        )}

        <button
          type="button"
          onClick={run}
          disabled={busy || sources.length === 0}
          className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50 justify-self-start"
        >
          {busy ? '만드는 중... (시간이 좀 걸려요, 창을 닫지 마세요)' : `분석하고 상세페이지 한 번에 만들기 (사진 ${sources.length}장)`}
        </button>
      </div>

      {/* 진행 상황 */}
      {stage !== 'idle' && (
        <div className="bg-paper rounded-lg p-3 grid gap-1.5 max-w-3xl text-xs">
          <p className={stage === 'upload' ? 'font-semibold text-accent' : 'text-inkSoft'}>
            1. 사진 올리고 분석 ({uploadProgress.done}/{uploadProgress.total})
            {stage !== 'upload' && ' ✓'}
          </p>
          {recolorProgress.total > 0 && (
            <p className={stage === 'recolor' ? 'font-semibold text-accent' : stage === 'upload' ? 'text-inkSoft/60' : 'text-inkSoft'}>
              1-2. 내 색상 사진 만들기 - 색상 변환 ({recolorProgress.done}/{recolorProgress.total}){stage !== 'recolor' && stage !== 'upload' && ' ✓'}
            </p>
          )}
          <p
            className={
              stage === 'flow' ? 'font-semibold text-accent' : ['upload', 'recolor'].includes(stage) ? 'text-inkSoft/60' : 'text-inkSoft'
            }
          >
            2. 쿠팡 인기상품 상세페이지 흐름 확인{['plan', 'generate', 'done'].includes(stage) && ' ✓'}
          </p>
          <p
            className={
              stage === 'plan'
                ? 'font-semibold text-accent'
                : ['upload', 'recolor', 'flow'].includes(stage)
                  ? 'text-inkSoft/60'
                  : 'text-inkSoft'
            }
          >
            3. 사진 내용 + 쿠팡 흐름으로 장면 구성 기획{['generate', 'done'].includes(stage) && ' ✓'}
          </p>
          <p
            className={
              stage === 'generate'
                ? 'font-semibold text-accent'
                : stage === 'done'
                  ? 'text-inkSoft'
                  : 'text-inkSoft/60'
            }
          >
            4. 장면 이미지 생성 ({genProgress.done}/{genProgress.total}){stage === 'done' && ' ✓'}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2 max-w-3xl">{error}</p>}
      {summary && <p className="text-xs text-profit bg-profitBg rounded-md px-3 py-2 max-w-3xl">{summary}</p>}

      {/* 안내/경고 */}
      {notes.length > 0 && (
        <div className="grid gap-1 max-w-3xl">
          {notes.map((n, i) => (
            <p
              key={i}
              className={`text-[11px] rounded px-2 py-1.5 ${
                n.startsWith('⚠') ? 'bg-warnBg text-warn font-semibold' : 'bg-paper text-inkSoft'
              }`}
            >
              {n}
            </p>
          ))}
        </div>
      )}

      {/* 사진 사용 내역: 어떤 사진이 쓰였고 어떤 사진이 왜 제외됐는지 */}
      {photoReport.length > 0 && (
        <div className="grid gap-1 max-w-3xl">
          <p className="text-[11px] font-semibold text-inkSoft">
            사진 사용 내역{selling && selling.colors.length > 0 ? ` (취급 색상: ${selling.colors.join(', ')})` : ''}
          </p>
          {photoReport.map((p) => (
            <p key={p.index} className="text-[11px] flex gap-2">
              <span className={p.usable ? 'text-profit shrink-0' : 'text-warn shrink-0'}>{p.usable ? '사용' : '제외'}</span>
              <span className="text-inkSoft truncate">
                {p.index + 1}번 {p.name}
                {p.color ? ` · ${p.color}` : ''}
                {!p.usable && p.reason ? ` - ${p.reason}` : ''}
              </span>
            </p>
          ))}
        </div>
      )}

      {/* 만든 장면 목록 */}
      {plan.length > 0 && (
        <div className="grid gap-1 max-w-3xl">
          <p className="text-[11px] font-semibold text-inkSoft">구성한 장면 (위에서 아래 순서)</p>
          {plan.map((p, i) => {
            const g = genStatus[i];
            return (
              <div key={i} className="flex items-start gap-2 text-[11px] bg-paper rounded px-2 py-1.5">
                <span className="shrink-0 w-5 text-inkSoft">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-ink">{p.purpose}</span>
                  <span className="text-inkSoft">
                    {' '}
                    · {TEMPLATE_LABEL[p.templateId] || p.templateId}
                    {p.sourceIndex !== null ? ` · 사진 ${p.sourceIndex + 1}번` : ''}
                  </span>
                  {p.kind === 'section' && p.fields.description && (
                    <span className="block text-inkSoft truncate">“{p.fields.description.replace(/\*\*/g, '')}”</span>
                  )}
                  {p.kind === 'sizechart' && p.sizeTable && (
                    <span className="block text-inkSoft truncate">
                      {p.sizeTable.headers.join(' / ')} · {p.sizeTable.rows.length}개 사이즈 (직접 입력한 표)
                    </span>
                  )}
                  {p.kind === 'spec' && (
                    <span className="block text-inkSoft truncate">
                      {p.specRows.map((r) => `${r.label}: ${r.value}`).join(' / ')}
                    </span>
                  )}
                  {g?.status === 'error' && g.error && <span className="block text-warn">{g.error}</span>}
                </span>
                <span className="shrink-0">
                  {g?.status === 'ok' && <span className="text-profit">완료</span>}
                  {g?.status === 'running' && <span className="text-accent">생성 중...</span>}
                  {g?.status === 'pending' && <span className="text-inkSoft">대기</span>}
                  {g?.status === 'error' && <span className="text-warn">실패</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
