'use server';

import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  composeTypographySection,
  composeOverlaySection,
  composeDetailSection,
  composeSpecTableSection,
  composeSizeTableSection,
  composeBrandHeader,
  composeBrandFooter,
  stitchVertical,
  finishDetailImage,
  type DetailSectionInput,
  type BrandPalette,
} from '@/lib/detailRender';
import { decodeSizeTableRows } from '@/lib/detailOptions';
import { DETAIL_IMAGE_WIDTH, DETAIL_STITCH_MAX_HEIGHT } from '@/lib/imageSpecs';
import {
  BUILT_IN_BRANDS,
  normalizeBrandInput,
  rowToBrand,
  type BrandTemplate,
  type ExportItem,
} from '@/lib/brandTemplate';

const BUCKET = 'detail-images';
const PATH = '/dashboard/sales/detail-pages';

const isMissingTable = (msg: string | undefined) => !!msg && /brand_templates/.test(msg) && /(schema cache|does not exist|Could not find)/i.test(msg);

// ---------------------------------------------------------------------------
// 템플릿 저장/목록/삭제
// ---------------------------------------------------------------------------
export async function listBrandTemplates(): Promise<{
  templates: BrandTemplate[];
  tableMissing: boolean;
  error: string | null;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.from('brand_templates').select('*').order('created_at', { ascending: false });
  if (error) {
    if (isMissingTable(error.message)) return { templates: [], tableMissing: true, error: null };
    return { templates: [], tableMissing: false, error: error.message };
  }
  return { templates: (data || []).map(rowToBrand), tableMissing: false, error: null };
}

// formData: id(수정할 때), name, brandName, tagline, primary, accent, applyColors('1'), headerEnabled('1'),
// footerEnabled('1'), footerTitle, footerNotice, logo(File, 선택), removeLogo('1')
export async function saveBrandTemplate(
  formData: FormData
): Promise<{ error: string } | { success: true; template: BrandTemplate }> {
  const get = (k: string) => String(formData.get(k) ?? '');
  const flag = (k: string) => get(k) === '1';
  const parsed = normalizeBrandInput({
    name: get('name'),
    brandName: get('brandName'),
    tagline: get('tagline'),
    primary: get('primary'),
    accent: get('accent'),
    applyColors: flag('applyColors'),
    headerEnabled: flag('headerEnabled'),
    footerEnabled: flag('footerEnabled'),
    footerTitle: get('footerTitle'),
    footerNotice: get('footerNotice'),
  });
  if (!parsed.value) return { error: parsed.error || '입력값을 확인해주세요.' };
  const v = parsed.value;

  const supabase = createClient();
  const id = get('id').trim() || randomUUID();
  const isUpdate = !!get('id').trim();

  let logoUrl: string | null | undefined; // undefined = 그대로 둠
  const file = formData.get('logo');
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith('image/')) return { error: '로고는 이미지 파일이어야 해요.' };
    if (file.size > 4 * 1024 * 1024) return { error: '로고 파일은 4MB 이하로 올려주세요.' };
    const buf = Buffer.from(await file.arrayBuffer());
    let png: Buffer;
    try {
      // 너무 큰 로고는 줄이고, 어떤 형식이든 PNG(투명 유지)로 저장한다
      png = await sharp(buf).resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    } catch {
      return { error: '로고 이미지를 읽지 못했어요. 다른 파일로 올려주세요.' };
    }
    const path = `brand/${id}-logo.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: true });
    if (upErr) return { error: `로고를 올리지 못했어요: ${upErr.message}` };
    logoUrl = `${supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  } else if (flag('removeLogo')) {
    logoUrl = null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const row: Record<string, unknown> = {
    name: v.name,
    brand_name: v.brandName,
    tagline: v.tagline,
    primary_color: v.primary,
    accent_color: v.accent,
    apply_colors: v.applyColors,
    header_enabled: v.headerEnabled,
    footer_enabled: v.footerEnabled,
    footer_title: v.footerTitle,
    footer_notice: v.footerNotice,
    updated_at: new Date().toISOString(),
  };
  if (logoUrl !== undefined) row.logo_url = logoUrl;

  const q = isUpdate
    ? supabase.from('brand_templates').update(row).eq('id', id).select('*').single()
    : supabase.from('brand_templates').insert({ id, ...row, author_email: user?.email ?? null }).select('*').single();
  const { data, error } = await q;
  if (error || !data) {
    if (isMissingTable(error?.message)) {
      return { error: '브랜드 템플릿 저장 테이블이 아직 없어요. supabase/brand_templates.sql을 Supabase SQL Editor에서 실행해주세요.' };
    }
    return { error: error?.message || '저장하지 못했어요.' };
  }
  revalidatePath(PATH);
  return { success: true, template: rowToBrand(data) };
}

export async function deleteBrandTemplate(id: string): Promise<{ error: string } | { success: true }> {
  if (!id || id.startsWith('builtin:')) return { error: '기본 제공 템플릿은 삭제할 수 없어요.' };
  const supabase = createClient();
  const { error } = await supabase.from('brand_templates').delete().eq('id', id);
  if (error) return { error: error.message };
  await supabase.storage.from(BUCKET).remove([`brand/${id}-logo.png`]); // 로고 정리 (실패해도 무시)
  revalidatePath(PATH);
  return { success: true };
}

// ---------------------------------------------------------------------------
// 내보내기: 브랜드 템플릿을 적용해 최종 이미지들을 만든다
// ---------------------------------------------------------------------------
const stripVersion = (url: string) => url.split('?')[0];

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지를 불러오지 못했어요 (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// 저장된 장면 이미지가 규격(가로 860px)이 아니면 맞춘다 (옛 버전으로 만든 장면 대비)
async function ensureDetailWidth(buf: Buffer): Promise<{ buf: Buffer; fixed: boolean }> {
  const meta = await sharp(buf).metadata();
  if (meta.width === DETAIL_IMAGE_WIDTH && meta.format === 'jpeg') return { buf, fixed: false };
  return { buf: await finishDetailImage(buf), fixed: true };
}

function inputFromRow(section: any, palette: BrandPalette | null): DetailSectionInput {
  return {
    keyword: section.keyword || '',
    mood: section.mood || '',
    description: section.description || '',
    eyebrow: section.eyebrow || '',
    accentTitle: section.accent_title || '',
    accentSubtitle: section.accent_subtitle || '',
    stat: section.stat || '',
    statCaption: section.stat_caption || '',
    badge: section.badge || '',
    bodyText: section.body_text || '',
    listItems: section.list_items || '',
    layoutStyle: section.layout_style || 'white',
    theme: section.theme || 'dark',
    palette,
  };
}

export async function exportDetailPage(
  projectId: string,
  brandId: string | null
): Promise<
  | { error: string }
  | { success: true; items: ExportItem[]; stitched: ExportItem[]; notes: string[]; brandName: string | null }
> {
  const supabase = createClient();
  const notes: string[] = [];

  // 템플릿 찾기
  let brand: BrandTemplate | null = null;
  if (brandId) {
    brand = BUILT_IN_BRANDS.find((b) => b.id === brandId) ?? null;
    if (!brand) {
      const { data, error } = await supabase.from('brand_templates').select('*').eq('id', brandId).maybeSingle();
      if (error) return { error: `브랜드 템플릿을 불러오지 못했어요: ${error.message}` };
      if (!data) return { error: '선택한 브랜드 템플릿을 찾을 수 없어요. 삭제됐을 수 있어요.' };
      brand = rowToBrand(data);
    }
  }
  const palette: BrandPalette | null = brand && brand.applyColors ? { primary: brand.primary, accent: brand.accent } : null;

  const { data: sections, error: secErr } = await supabase
    .from('detail_page_sections')
    .select('*')
    .eq('project_id', projectId)
    .order('position', { ascending: true });
  if (secErr) return { error: secErr.message };
  const withImage = (sections || []).filter((s) => s.output_image_url);
  if (withImage.length === 0) return { error: '내보낼 이미지가 없어요. 먼저 상세페이지 장면을 만들어주세요.' };
  const skipped = (sections || []).length - withImage.length;
  if (skipped > 0) notes.push(`아직 생성되지 않았거나 실패한 장면 ${skipped}개는 빼고 내보냈어요.`);

  // 로고 (실패해도 머리글/바닥글은 로고 없이 만든다)
  let logo: Buffer | null = null;
  if (brand?.logoUrl) {
    try {
      logo = await fetchBuffer(stripVersion(brand.logoUrl));
    } catch {
      notes.push('로고를 불러오지 못해서 로고 없이 만들었어요.');
    }
  }

  const finals: { name: string; buf: Buffer }[] = [];
  if (brand && brand.headerEnabled && (brand.brandName || logo || brand.tagline)) {
    try {
      const spec = { brandName: brand.brandName, tagline: brand.tagline, footerTitle: brand.footerTitle, footerNotice: brand.footerNotice, palette: { primary: brand.primary, accent: brand.accent } };
      finals.push({ name: '브랜드머리글', buf: await composeBrandHeader(spec, logo) });
    } catch (e: any) {
      notes.push(`브랜드 머리글을 만들지 못했어요: ${e?.message || e}`);
    }
  }

  let recolored = 0;
  let fixedWidth = 0;
  for (const [i, s] of withImage.entries()) {
    let buf: Buffer | null = null;
    if (palette) {
      try {
        buf = await rerenderWithPalette(supabase, s, palette);
        if (buf) recolored++;
      } catch (e: any) {
        notes.push(`${i + 1}번째 장면은 브랜드 색으로 다시 그리지 못해서 원래 이미지를 썼어요 (${e?.message || e}).`);
      }
    }
    if (!buf) {
      try {
        buf = await fetchBuffer(stripVersion(s.output_image_url));
      } catch (e: any) {
        notes.push(`${i + 1}번째 장면 이미지를 불러오지 못해 뺐어요 (${e?.message || e}).`);
        continue;
      }
    }
    const fixed = await ensureDetailWidth(buf);
    if (fixed.fixed) fixedWidth++;
    finals.push({ name: `장면${String(i + 1).padStart(2, '0')}`, buf: fixed.buf });
  }
  if (palette && recolored < withImage.length) {
    notes.push('사진이 필요한 장면 중 사진 배경이 저장돼 있지 않은 장면은 원래 이미지 그대로예요 (브랜드 색이 문구에 반영되지 않았어요).');
  }
  if (fixedWidth > 0) notes.push(`가로 규격(${DETAIL_IMAGE_WIDTH}px)이 아니던 장면 ${fixedWidth}개를 규격에 맞췄어요.`);

  if (brand && brand.footerEnabled && (brand.footerNotice || brand.brandName || logo)) {
    try {
      const spec = { brandName: brand.brandName, tagline: brand.tagline, footerTitle: brand.footerTitle, footerNotice: brand.footerNotice, palette: { primary: brand.primary, accent: brand.accent } };
      finals.push({ name: '브랜드바닥글', buf: await composeBrandFooter(spec, logo) });
    } catch (e: any) {
      notes.push(`브랜드 바닥글을 만들지 못했어요: ${e?.message || e}`);
    }
  }
  if (finals.length === 0) return { error: '내보낼 이미지를 만들지 못했어요.' };

  // 업로드: 개별 이미지 + 이어붙인 긴 이미지
  const stamp = Date.now();
  const items: ExportItem[] = [];
  for (const [i, f] of finals.entries()) {
    const meta = await sharp(f.buf).metadata();
    const path = `detail-pages/${projectId}/export/${String(i + 1).padStart(2, '0')}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f.buf, { contentType: 'image/jpeg', upsert: true });
    if (error) return { error: `내보낸 이미지를 저장하지 못했어요: ${error.message}` };
    items.push({
      name: `${String(i + 1).padStart(2, '0')}_${f.name}.jpg`,
      url: `${supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${stamp}`,
      width: meta.width || DETAIL_IMAGE_WIDTH,
      height: meta.height || 0,
    });
  }

  const stitched: ExportItem[] = [];
  try {
    const parts = await stitchVertical(finals.map((f) => f.buf), DETAIL_STITCH_MAX_HEIGHT);
    for (const [i, buf] of parts.entries()) {
      const meta = await sharp(buf).metadata();
      const path = `detail-pages/${projectId}/export/long-${i + 1}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      stitched.push({
        name: `상세페이지_긴이미지_${i + 1}.jpg`,
        url: `${supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${stamp}`,
        width: meta.width || DETAIL_IMAGE_WIDTH,
        height: meta.height || 0,
      });
    }
  } catch (e: any) {
    notes.push(`이어붙인 긴 이미지는 만들지 못했어요 (${e?.message || e}). 개별 이미지는 받을 수 있어요.`);
  }

  return { success: true, items, stitched, notes, brandName: brand?.name ?? null };
}

// 저장된 문구/표/사진 배경으로 브랜드 색을 입혀서 장면을 다시 그린다. 다시 그릴 재료가 없으면 null.
async function rerenderWithPalette(
  supabase: ReturnType<typeof createClient>,
  section: any,
  palette: BrandPalette
): Promise<Buffer | null> {
  const layout = section.layout_style || 'white';
  if (layout === 'spec') {
    const table = decodeSizeTableRows(section.spec_rows, section.spec_title);
    if (table) return composeSizeTableSection(table, palette);
    const rows = (Array.isArray(section.spec_rows) ? section.spec_rows : [])
      .map((r: any) => ({ label: String(r?.label ?? ''), value: String(r?.value ?? '') }))
      .filter((r: any) => r.label.trim() || r.value.trim());
    if (rows.length === 0) return null;
    return composeSpecTableSection(rows, section.spec_title || undefined, palette);
  }
  const input = inputFromRow(section, palette);
  if (layout === 'typography') return composeTypographySection(input);

  const { data: bg } = await supabase.storage.from(BUCKET).download(`detail-pages/${section.project_id}/${section.id}-bg.jpg`);
  if (!bg) return null;
  const bgBuf = Buffer.from(await bg.arrayBuffer());
  return layout === 'overlay' ? composeOverlaySection(bgBuf, input) : composeDetailSection(bgBuf, input);
}
