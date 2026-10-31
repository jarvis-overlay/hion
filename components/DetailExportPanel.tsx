'use client';

import { useEffect, useState } from 'react';
import {
  listBrandTemplates,
  saveBrandTemplate,
  deleteBrandTemplate,
  exportDetailPage,
} from '@/app/dashboard/sales/detail-pages/brand-actions';
import { BUILT_IN_BRANDS, type BrandTemplate, type ExportItem } from '@/lib/brandTemplate';
import { createZip } from '@/lib/zip';
import { DETAIL_IMAGE_WIDTH } from '@/lib/imageSpecs';

// 상세페이지 마지막 단계: 브랜드 템플릿을 고르고(또는 새로 저장하고) 최종 이미지를 만들어 내려받는다.
// 템플릿은 프로젝트와 상관없이 저장돼서 어떤 새 상세페이지든 같은 걸 고를 수 있다.
//  - 색상: 문구/표 장면을 브랜드 색으로 다시 그린다
//  - 머리글/바닥글: 로고+브랜드명+소개 / 안내사항 이미지를 맨 위/아래에 붙인다
// 내려받기: 개별 이미지(번호 순서) ZIP, 이어붙인 긴 이미지 ZIP, 이미지 한 장씩

interface Form {
  id: string;
  name: string;
  brandName: string;
  tagline: string;
  primary: string;
  accent: string;
  applyColors: boolean;
  headerEnabled: boolean;
  footerEnabled: boolean;
  footerTitle: string;
  footerNotice: string;
  logoUrl: string | null;
  logoFile: File | null;
  removeLogo: boolean;
}

const EMPTY_FORM: Form = {
  id: '',
  name: '',
  brandName: '',
  tagline: '',
  primary: '#1c1c1c',
  accent: '#7c4fd1',
  applyColors: true,
  headerEnabled: true,
  footerEnabled: true,
  footerTitle: '안내사항',
  footerNotice: '모니터 설정에 따라 실제 색상과 차이가 있을 수 있습니다.\n교환·반품 안내는 상품 상세 정보를 확인해주세요.',
  logoUrl: null,
  logoFile: null,
  removeLogo: false,
};

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export default function DetailExportPanel({ projectId, readyCount }: { projectId: string; readyCount: number }) {
  const [saved, setSaved] = useState<BrandTemplate[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // null = 템플릿 없이
  const [form, setForm] = useState<Form | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ items: ExportItem[]; stitched: ExportItem[]; notes: string[]; brandName: string | null } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function reload() {
    try {
      const r = await listBrandTemplates();
      setSaved(r.templates);
      setTableMissing(r.tableMissing);
      setLoadError(r.error);
    } catch (e: any) {
      setLoadError(e?.message || '템플릿 목록을 불러오지 못했어요.');
    }
  }
  useEffect(() => {
    reload();
  }, []);

  function patchForm(p: Partial<Form>) {
    setForm((prev) => (prev ? { ...prev, ...p } : prev));
  }

  function editTemplate(t: BrandTemplate) {
    setFormError(null);
    setForm({
      id: t.id,
      name: t.name,
      brandName: t.brandName,
      tagline: t.tagline,
      primary: t.primary,
      accent: t.accent,
      applyColors: t.applyColors,
      headerEnabled: t.headerEnabled,
      footerEnabled: t.footerEnabled,
      footerTitle: t.footerTitle,
      footerNotice: t.footerNotice,
      logoUrl: t.logoUrl,
      logoFile: null,
      removeLogo: false,
    });
  }

  async function handleSave() {
    if (!form) return;
    setFormBusy(true);
    setFormError(null);
    const fd = new FormData();
    if (form.id) fd.set('id', form.id);
    fd.set('name', form.name);
    fd.set('brandName', form.brandName);
    fd.set('tagline', form.tagline);
    fd.set('primary', form.primary);
    fd.set('accent', form.accent);
    fd.set('applyColors', form.applyColors ? '1' : '0');
    fd.set('headerEnabled', form.headerEnabled ? '1' : '0');
    fd.set('footerEnabled', form.footerEnabled ? '1' : '0');
    fd.set('footerTitle', form.footerTitle);
    fd.set('footerNotice', form.footerNotice);
    if (form.logoFile) fd.set('logo', form.logoFile);
    if (form.removeLogo) fd.set('removeLogo', '1');
    try {
      const res = await saveBrandTemplate(fd);
      if (!res || 'error' in res) {
        setFormError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
      } else {
        await reload();
        setSelected(res.template.id);
        setForm(null);
      }
    } catch (e: any) {
      setFormError(e?.message || '요청이 실패했어요. 다시 시도해주세요.');
    }
    setFormBusy(false);
  }

  async function handleDelete(t: BrandTemplate) {
    if (!window.confirm(`"${t.name}" 템플릿을 삭제할까요?`)) return;
    const res = await deleteBrandTemplate(t.id);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    if (selected === t.id) setSelected(null);
    await reload();
  }

  async function handleBuild() {
    setBuilding(true);
    setError(null);
    setResult(null);
    try {
      const res = await exportDetailPage(projectId, selected);
      if (!res || 'error' in res) setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
      else setResult(res);
    } catch (e: any) {
      setError(e?.message || '요청이 실패했어요. 다시 시도해주세요.');
    }
    setBuilding(false);
  }

  async function downloadZip(files: ExportItem[], zipName: string) {
    setDownloading(zipName);
    setError(null);
    try {
      const entries: { name: string; data: Uint8Array }[] = [];
      for (const f of files) entries.push({ name: f.name, data: await fetchBytes(f.url) });
      triggerDownload(new Blob([createZip(entries) as BlobPart], { type: 'application/zip' }), zipName);
    } catch (e: any) {
      setError(`ZIP으로 묶지 못했어요 (${e?.message || e}). 아래 이미지 목록에서 한 장씩 받아주세요.`);
    }
    setDownloading(null);
  }

  async function downloadOne(f: ExportItem) {
    setDownloading(f.name);
    setError(null);
    try {
      triggerDownload(new Blob([(await fetchBytes(f.url)) as BlobPart], { type: 'image/jpeg' }), f.name);
    } catch {
      window.open(f.url, '_blank'); // 저장 못 하면 새 탭에서 열어 직접 저장
    }
    setDownloading(null);
  }

  const all: BrandTemplate[] = [...BUILT_IN_BRANDS, ...saved];
  const current = all.find((t) => t.id === selected) || null;

  return (
    <section className="card p-4 grid gap-3 border-2 border-accent/30">
      <div>
        <h3 className="text-sm font-semibold">마지막 단계: 브랜드 템플릿 적용 + 다운로드</h3>
        <p className="text-[11px] text-inkSoft leading-relaxed">
          우리 브랜드 템플릿을 고르면 문구·표 장면이 브랜드 색으로 다시 그려지고, 맨 위에 브랜드 머리글, 맨 아래에
          안내사항 바닥글이 붙어요. 이미지는 가로 {DETAIL_IMAGE_WIDTH}px로 정확히 맞춰서 내려받아요. 템플릿은 저장해두면
          다른 상세페이지에서도 그대로 고를 수 있어요.
        </p>
      </div>

      <div className="grid gap-1.5 max-w-3xl">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className={`text-left text-xs rounded border px-3 py-2 ${selected === null ? 'border-accent bg-accent/5' : 'border-paperLine bg-white'}`}
        >
          <span className="font-semibold">템플릿 없이 (만든 그대로)</span>
          <span className="text-inkSoft"> · 색 변경/머리글/바닥글 없이 이미지만 내려받기</span>
        </button>
        {all.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded border px-3 py-2 ${selected === t.id ? 'border-accent bg-accent/5' : 'border-paperLine bg-white'}`}
          >
            <button type="button" onClick={() => setSelected(t.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left text-xs">
              <span className="w-4 h-4 rounded-full border border-paperLine shrink-0" style={{ background: t.primary }} />
              <span className="w-4 h-4 rounded-full border border-paperLine shrink-0 -ml-1.5" style={{ background: t.accent }} />
              <span className="font-semibold truncate">{t.name}</span>
              <span className="text-inkSoft truncate">
                {t.builtIn
                  ? '기본 제공 · 색상만'
                  : `${t.headerEnabled ? '머리글' : ''}${t.headerEnabled && t.footerEnabled ? '+' : ''}${t.footerEnabled ? '바닥글' : ''}${t.applyColors ? ' · 색상 적용' : ''}`}
              </span>
            </button>
            {!t.builtIn && (
              <>
                <button type="button" onClick={() => editTemplate(t)} className="text-[11px] text-accent font-semibold shrink-0">
                  수정
                </button>
                <button type="button" onClick={() => handleDelete(t)} className="text-[11px] text-inkSoft hover:text-red-700 shrink-0">
                  삭제
                </button>
              </>
            )}
          </div>
        ))}
        {tableMissing && (
          <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1.5">
            내 브랜드 템플릿을 저장하려면 supabase/brand_templates.sql을 Supabase SQL Editor에서 한 번 실행해야 해요. 그 전에는 위의
            기본 제공 색상 템플릿만 쓸 수 있어요.
          </p>
        )}
        {loadError && <p className="text-[11px] text-warn">{loadError}</p>}
        {!form && (
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setForm({ ...EMPTY_FORM });
            }}
            disabled={tableMissing}
            className="text-xs text-accent font-semibold justify-self-start disabled:opacity-40"
          >
            + 내 브랜드 템플릿 만들기
          </button>
        )}
      </div>

      {form && (
        <div className="bg-paper rounded-lg p-3 grid gap-2 max-w-3xl text-xs">
          <p className="font-semibold">{form.id ? '브랜드 템플릿 수정' : '새 브랜드 템플릿'}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
              템플릿 이름
              <input value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder="예: 히온 기본" className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink" />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-inkSoft">
              브랜드명 (머리글/바닥글에 표시)
              <input value={form.brandName} onChange={(e) => patchForm({ brandName: e.target.value })} placeholder="예: HION" className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink" />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-inkSoft sm:col-span-2">
              브랜드 한 줄 소개 (머리글)
              <input value={form.tagline} onChange={(e) => patchForm({ tagline: e.target.value })} placeholder="예: 매일 쓰는 물건을 더 편안하게" className="border border-paperLine bg-white px-2 py-1.5 text-xs font-normal text-ink" />
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold text-inkSoft">
              대표 색
              <input type="color" value={form.primary} onChange={(e) => patchForm({ primary: e.target.value })} />
              <span className="font-normal">{form.primary}</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-semibold text-inkSoft">
              포인트 색
              <input type="color" value={form.accent} onChange={(e) => patchForm({ accent: e.target.value })} />
              <span className="font-normal">{form.accent}</span>
            </label>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {form.logoUrl && !form.removeLogo && !form.logoFile && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logoUrl} alt="로고" className="h-10 w-auto bg-white border border-paperLine rounded" />
            )}
            <label className="text-[11px] text-accent font-semibold underline cursor-pointer">
              {form.logoFile ? form.logoFile.name : form.logoUrl && !form.removeLogo ? '로고 교체' : '로고 올리기 (PNG 권장, 4MB 이하)'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => patchForm({ logoFile: e.target.files?.[0] || null, removeLogo: false })} />
            </label>
            {form.logoUrl && !form.removeLogo && (
              <button type="button" onClick={() => patchForm({ removeLogo: true, logoFile: null })} className="text-[11px] text-inkSoft hover:text-red-700">
                로고 제거
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-[11px]">
            <input type="checkbox" checked={form.applyColors} onChange={(e) => patchForm({ applyColors: e.target.checked })} />
            문구·표 장면을 브랜드 색으로 다시 그리기
          </label>
          <label className="flex items-center gap-2 text-[11px]">
            <input type="checkbox" checked={form.headerEnabled} onChange={(e) => patchForm({ headerEnabled: e.target.checked })} />
            맨 위에 브랜드 머리글 붙이기 (로고 + 브랜드명 + 한 줄 소개)
          </label>
          <label className="flex items-center gap-2 text-[11px]">
            <input type="checkbox" checked={form.footerEnabled} onChange={(e) => patchForm({ footerEnabled: e.target.checked })} />
            맨 아래에 안내사항 바닥글 붙이기
          </label>
          {form.footerEnabled && (
            <>
              <input value={form.footerTitle} onChange={(e) => patchForm({ footerTitle: e.target.value })} placeholder="바닥글 제목 (예: 구매 전 확인해주세요)" className="border border-paperLine bg-white px-2 py-1.5 text-xs" />
              <textarea value={form.footerNotice} onChange={(e) => patchForm({ footerNotice: e.target.value })} rows={4} placeholder="안내 문구 (한 줄에 하나씩)" className="border border-paperLine bg-white px-2 py-1.5 text-xs" />
            </>
          )}
          {formError && <p className="text-warn">{formError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={handleSave} disabled={formBusy} className="btn-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-50">
              {formBusy ? '저장 중...' : '저장'}
            </button>
            <button type="button" onClick={() => setForm(null)} disabled={formBusy} className="text-xs text-inkSoft">
              취소
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleBuild}
          disabled={building || readyCount === 0}
          className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"
        >
          {building ? '만드는 중... (장면 수만큼 시간이 걸려요)' : `${current ? `"${current.name}" 적용해서 ` : ''}최종 이미지 만들기 (장면 ${readyCount}개)`}
        </button>
        {readyCount === 0 && <span className="text-[11px] text-inkSoft">먼저 위에서 상세페이지 장면을 만들어주세요.</span>}
      </div>

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2 max-w-3xl">{error}</p>}

      {result && (
        <div className="grid gap-2 max-w-3xl">
          <p className="text-xs text-profit bg-profitBg rounded-md px-3 py-2">
            최종 이미지 {result.items.length}장을 만들었어요{result.brandName ? ` (템플릿: ${result.brandName})` : ''}. 모두 가로 {DETAIL_IMAGE_WIDTH}px예요.
          </p>
          {result.notes.map((n, i) => (
            <p key={i} className="text-[11px] rounded px-2 py-1.5 bg-paper text-inkSoft">{n}</p>
          ))}
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => downloadZip(result.items, '상세페이지_개별이미지.zip')} disabled={!!downloading} className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              {downloading === '상세페이지_개별이미지.zip' ? '묶는 중...' : `개별 이미지 ZIP (${result.items.length}장, 순서 번호 포함)`}
            </button>
            {result.stitched.length > 0 && (
              <button type="button" onClick={() => downloadZip(result.stitched, '상세페이지_긴이미지.zip')} disabled={!!downloading} className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                {downloading === '상세페이지_긴이미지.zip' ? '묶는 중...' : `이어붙인 긴 이미지 ZIP (${result.stitched.length}장)`}
              </button>
            )}
          </div>
          <div className="grid gap-1.5 grid-cols-2 sm:grid-cols-4">
            {result.items.map((f) => (
              <div key={f.url} className="bg-paper rounded p-1.5 grid gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={f.name} className="w-full h-32 object-contain bg-white rounded" />
                <p className="text-[10px] text-inkSoft truncate">{f.name} · {f.width}×{f.height}</p>
                <button type="button" onClick={() => downloadOne(f)} disabled={!!downloading} className="text-[11px] text-accent font-semibold text-left disabled:opacity-50">
                  {downloading === f.name ? '받는 중...' : '이 이미지 받기'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
