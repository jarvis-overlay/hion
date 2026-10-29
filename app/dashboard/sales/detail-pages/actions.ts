'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  generateDetailBackground,
  composeDetailSectionImage,
  detectAndTranslateText,
  composeSpecTableSection,
  type DetailSectionInput,
  type DetailSectionLayout,
  type DetailSectionTheme,
  type SpecRow,
} from '@/lib/imageProcessing';
import { recommendDetailSectionCopy, type DetailCopyRecommendation } from '@/lib/ai';

const BUCKET = 'detail-images';
const PATH = '/dashboard/sales/detail-pages';

function extFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

// 같은 경로에 upsert로 덮어쓰면 공개 URL이 그대로라 브라우저/CDN이 예전
// 이미지를 계속 보여줄 수 있다 - 수정 결과가 바로 보이도록 URL에 버전 값을
// 붙여서 저장한다.
function versioned(url: string): string {
  return `${url}?v=${Date.now()}`;
}

// 섹션 입력 폼(추가/수정 공용)을 읽는다.
interface SectionFields extends DetailSectionInput {
  keyword: string;
  mood: string;
  description: string;
}

function readSectionFields(formData: FormData): SectionFields {
  const get = (k: string) => String(formData.get(k) || '').trim();
  return {
    keyword: get('keyword'),
    mood: get('mood'),
    description: get('description'),
    eyebrow: get('eyebrow'),
    accentTitle: get('accentTitle'),
    accentSubtitle: get('accentSubtitle'),
    stat: get('stat'),
    statCaption: get('statCaption'),
    badge: get('badge'),
    bodyText: get('bodyText'),
    listItems: get('listItems'),
    colorPrompt: get('colorPrompt'),
    layoutStyle: (get('layoutStyle') || 'white') as DetailSectionLayout,
    theme: (get('theme') || 'dark') as DetailSectionTheme,
  };
}

function hasAnyCopy(f: SectionFields): boolean {
  return !!(
    f.keyword ||
    f.mood ||
    f.description ||
    f.eyebrow ||
    f.accentTitle ||
    f.stat ||
    f.badge ||
    f.bodyText ||
    f.listItems
  );
}

function buildPromptText(f: SectionFields): string {
  return [
    f.keyword && `키워드: ${f.keyword}`,
    f.mood && `분위기: ${f.mood}`,
    f.description && `설명: ${f.description}`,
    f.eyebrow && `작은 문구: ${f.eyebrow}`,
    f.accentTitle && `브랜드명: ${f.accentTitle}`,
    f.stat && `통계: ${f.stat}`,
    f.badge && `뱃지: ${f.badge}`,
    f.bodyText && `문단: ${f.bodyText}`,
    f.listItems && `리스트: ${f.listItems.split(/\r?\n/).filter(Boolean).length}개 항목`,
  ]
    .filter(Boolean)
    .join(' / ');
}

function bgPathOf(projectId: string, sectionId: string) {
  return `detail-pages/${projectId}/${sectionId}-bg.jpg`;
}

// 원본(1688) 사진에 박혀있는 중국어 문구가 뭐라고 써있는지 미리 보여주는
// 용도 - 사용자가 이걸 보고 원하는 한국어 문구를 직접 입력할 수 있게
// 한다. 번역 기능에 이미 있는 OCR+번역 로직을 그대로 재사용.
export async function extractImageText(
  formData: FormData
): Promise<{ error: string } | { success: true; texts: { original: string; translated: string }[] }> {
  const file = formData.get('image') as File | null;
  if (!file || file.size === 0) return { error: '이미지를 먼저 첨부해주세요.' };

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/jpeg';
    const regions = await detectAndTranslateText(buffer, mimeType);
    if (regions.length === 0) {
      return { success: true, texts: [] };
    }
    return {
      success: true,
      texts: regions.map((r) => ({ original: r.originalText, translated: r.translatedText })),
    };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function createProject(
  title: string
): Promise<{ error: string } | { success: true; id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('detail_page_projects')
    .insert({ title: title.trim() || null, author_email: user?.email })
    .select('id')
    .single();

  if (error || !data) return { error: error?.message || '프로젝트 생성에 실패했어요.' };
  revalidatePath(PATH);
  return { success: true, id: (data as { id: string }).id };
}

export async function deleteProject(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('detail_page_projects').delete().eq('id', id);
  if (error) console.error('[detail-pages] deleteProject 실패:', error.message);
  revalidatePath(PATH);
}

// 섹션 하나 추가 - 이미지(선택)+문구를 받아서 즉시 AI 생성까지 실행한다.
// 실패해도 행은 남겨서(error 컬럼에 메시지 저장) 나중에 재시도할 수
// 있게 한다.
export async function addSection(
  projectId: string,
  position: number,
  formData: FormData
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const input = readSectionFields(formData);
  if (!hasAnyCopy(input)) {
    return { error: '문구 항목 중 하나는 입력해주세요.' };
  }
  const promptText = buildPromptText(input);

  const file = formData.get('image') as File | null;
  let inputImageUrl: string | null = null;
  let productImage: { buffer: Buffer; mimeType: string } | null = null;
  const sectionId = randomUUID();

  if (file && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/jpeg';
    productImage = { buffer, mimeType };
    const path = `detail-pages/${projectId}/${sectionId}-input.${extFromContentType(mimeType)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    inputImageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const { error: insertErr } = await supabase.from('detail_page_sections').insert({
    id: sectionId,
    project_id: projectId,
    position,
    input_image_url: inputImageUrl,
    prompt_text: promptText,
    ...sectionColumns(input),
  });
  if (insertErr) return { error: insertErr.message };

  return runGeneration(supabase, sectionId, projectId, input, productImage);
}

// DB 컬럼 이름으로 바꾼 섹션 입력값 (추가/수정 공용)
function sectionColumns(f: SectionFields) {
  return {
    keyword: f.keyword || null,
    mood: f.mood || null,
    description: f.description || null,
    eyebrow: f.eyebrow || null,
    accent_title: f.accentTitle || null,
    accent_subtitle: f.accentSubtitle || null,
    stat: f.stat || null,
    stat_caption: f.statCaption || null,
    badge: f.badge || null,
    body_text: f.bodyText || null,
    list_items: f.listItems || null,
    color_prompt: f.colorPrompt || null,
    layout_style: f.layoutStyle || 'white',
    theme: f.theme || 'dark',
  };
}

export async function retrySection(
  sectionId: string
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const { data: section, error } = await supabase
    .from('detail_page_sections')
    .select('*')
    .eq('id', sectionId)
    .single();
  if (error || !section) return { error: error?.message || '섹션을 찾을 수 없어요.' };

  let productImage: { buffer: Buffer; mimeType: string } | null = null;
  if (section.input_image_url) {
    const res = await fetch(section.input_image_url);
    if (!res.ok) return { error: `원본 이미지를 다시 불러오지 못했어요 (HTTP ${res.status})` };
    const buffer = Buffer.from(await res.arrayBuffer());
    productImage = { buffer, mimeType: res.headers.get('content-type') || 'image/jpeg' };
  }

  const input: DetailSectionInput = {
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
    colorPrompt: section.color_prompt || '',
    layoutStyle: (section.layout_style as DetailSectionLayout) || 'white',
    theme: (section.theme as DetailSectionTheme) || 'dark',
  };
  return runGeneration(supabase, sectionId, section.project_id, input, productImage);
}

// reuseBackground가 있으면 AI 배경 생성을 건너뛰고 그 사진 위에 문구만 다시
// 합성한다 (생성된 섹션 수정 - 문구/디자인만 바꾸는 경우). 없으면 배경을
// 새로 만들고, 나중에 수정할 때 재사용할 수 있게 따로 저장해둔다.
async function runGeneration(
  supabase: ReturnType<typeof createClient>,
  sectionId: string,
  projectId: string,
  input: DetailSectionInput,
  productImage: { buffer: Buffer; mimeType: string } | null,
  reuseBackground: Buffer | null = null
): Promise<{ error: string } | { success: true; url: string }> {
  try {
    let background = reuseBackground;
    if ((input.layoutStyle || 'white') !== 'typography' && !background) {
      background = await generateDetailBackground(input, productImage);
      // 배경 보관은 편의 기능이라 실패해도 생성 자체는 계속한다
      // (못 남기면 나중에 수정할 때 배경을 새로 만들게 될 뿐).
      const { error: bgErr } = await supabase.storage
        .from(BUCKET)
        .upload(bgPathOf(projectId, sectionId), background, { contentType: 'image/jpeg', upsert: true });
      if (bgErr) console.error('[detail-pages] 배경 보관 실패:', bgErr.message);
    }
    const generated = await composeDetailSectionImage(input, background);
    const outPath = `detail-pages/${projectId}/${sectionId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, generated, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    const outputUrl = versioned(supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl);

    const { error: updateErr } = await supabase
      .from('detail_page_sections')
      .update({ output_image_url: outputUrl, error: null })
      .eq('id', sectionId);
    if (updateErr) return { error: updateErr.message };

    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    const message = e?.message || String(e);
    await supabase.from('detail_page_sections').update({ error: message }).eq('id', sectionId);
    revalidatePath(PATH);
    return { error: message };
  }
}

// 이미 생성된 섹션 수정 - 문구/디자인을 바꾸고 다시 합성한다.
//   - 키워드/분위기/색상 지시를 바꾸거나, 사진을 교체/제거했거나, 레이아웃이
//     사진 없는 타입에서 사진 있는 타입으로 바뀌었거나, 사용자가 "배경 새로
//     생성"을 켰으면 AI 배경을 새로 만든다.
//   - 그 외(문구·레이아웃·테마만 변경)에는 생성 때 보관해둔 배경 사진을
//     그대로 쓰고 문구만 다시 합성한다 (AI 호출 없음, 사진 안 바뀜).
//   - 보관된 배경이 없는 옛 섹션은 어쩔 수 없이 새로 만들고, 그 사실을
//     backgroundReused=false로 알려준다.
export async function updateSection(
  sectionId: string,
  formData: FormData
): Promise<{ error: string } | { success: true; url: string; backgroundReused: boolean }> {
  const supabase = createClient();
  const input = readSectionFields(formData);
  if (!hasAnyCopy(input)) return { error: '문구 항목 중 하나는 입력해주세요.' };

  const { data: section, error } = await supabase
    .from('detail_page_sections')
    .select('*')
    .eq('id', sectionId)
    .single();
  if (error || !section) return { error: error?.message || '섹션을 찾을 수 없어요.' };
  if (section.layout_style === 'spec') return { error: '제품 사양 표는 표 수정으로 고쳐주세요.' };

  const projectId: string = section.project_id;
  const forceBackground = formData.get('forceBackground') === '1';
  const removeImage = formData.get('removeImage') === '1';
  const file = formData.get('image') as File | null;
  const hasNewFile = !!file && file.size > 0;

  // 1) 원본 사진 교체/제거
  let inputImageUrl: string | null = section.input_image_url;
  let productImage: { buffer: Buffer; mimeType: string } | null = null;
  if (hasNewFile) {
    const buffer = Buffer.from(await file!.arrayBuffer());
    const mimeType = file!.type || 'image/jpeg';
    productImage = { buffer, mimeType };
    const path = `detail-pages/${projectId}/${sectionId}-input.${extFromContentType(mimeType)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    inputImageUrl = versioned(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  } else if (removeImage) {
    inputImageUrl = null;
  }

  // 2) 배경을 새로 만들어야 하는지 판단
  const wasTypography = (section.layout_style || 'white') === 'typography';
  const needsPhoto = (input.layoutStyle || 'white') !== 'typography';
  const photoInputsChanged =
    (section.keyword || '') !== input.keyword ||
    (section.mood || '') !== input.mood ||
    (section.color_prompt || '') !== input.colorPrompt ||
    hasNewFile ||
    removeImage;

  let reuseBackground: Buffer | null = null;
  if (needsPhoto && !forceBackground && !photoInputsChanged && !wasTypography) {
    try {
      const { data: bg } = await supabase.storage.from(BUCKET).download(bgPathOf(projectId, sectionId));
      if (bg) reuseBackground = Buffer.from(await bg.arrayBuffer());
    } catch {
      reuseBackground = null; // 보관된 배경이 없음 - 아래에서 새로 생성
    }
  }

  // 새로 만들 때 쓸 원본 사진: 방금 올린 것 > 기존 첨부 (제거했으면 없음)
  if (needsPhoto && !reuseBackground && !productImage && inputImageUrl && !removeImage) {
    const res = await fetch(inputImageUrl);
    if (!res.ok) return { error: `원본 이미지를 다시 불러오지 못했어요 (HTTP ${res.status})` };
    productImage = {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg',
    };
  }

  // 3) 입력값 저장 (생성이 실패해도 입력은 남겨서 재시도할 수 있게)
  const { error: updateErr } = await supabase
    .from('detail_page_sections')
    .update({
      input_image_url: inputImageUrl,
      prompt_text: buildPromptText(input),
      ...sectionColumns(input),
    })
    .eq('id', sectionId);
  if (updateErr) return { error: updateErr.message };

  // 4) 합성/생성
  const result = await runGeneration(supabase, sectionId, projectId, input, productImage, reuseBackground);
  if ('error' in result) return result;
  return { success: true, url: result.url, backgroundReused: !!reuseBackground || !needsPhoto };
}

// 제품 사양 표 수정 - 제목/항목을 바꾸고 표를 다시 그린다.
export async function updateSpecSection(
  sectionId: string,
  input: { title: string; rows: SpecRow[] }
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const rows = input.rows.filter((r) => r.label.trim() || r.value.trim());
  if (rows.length === 0) return { error: '표에 항목을 하나 이상 입력해주세요.' };

  const { data: section, error } = await supabase
    .from('detail_page_sections')
    .select('id, project_id, layout_style')
    .eq('id', sectionId)
    .single();
  if (error || !section) return { error: error?.message || '섹션을 찾을 수 없어요.' };
  if (section.layout_style !== 'spec') return { error: '제품 사양 표 섹션이 아니에요.' };

  const { error: updateErr } = await supabase
    .from('detail_page_sections')
    .update({
      prompt_text: `제품 사양 표 (${rows.length}개 항목)`,
      spec_title: input.title || null,
      spec_rows: rows,
    })
    .eq('id', sectionId);
  if (updateErr) return { error: updateErr.message };

  try {
    const generated = await composeSpecTableSection(rows, input.title);
    const outPath = `detail-pages/${section.project_id}/${sectionId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, generated, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    const outputUrl = versioned(supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl);
    await supabase
      .from('detail_page_sections')
      .update({ output_image_url: outputUrl, error: null })
      .eq('id', sectionId);
    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    const message = e?.message || String(e);
    await supabase.from('detail_page_sections').update({ error: message }).eq('id', sectionId);
    revalidatePath(PATH);
    return { error: message };
  }
}

// 섹션 순서 변경 - 위/아래 버튼으로 이웃 섹션과 position을 맞바꾼다.
export async function moveSection(sectionId: string, direction: 'up' | 'down') {
  const supabase = createClient();
  const { data: section, error } = await supabase
    .from('detail_page_sections')
    .select('id, project_id, position')
    .eq('id', sectionId)
    .single();
  if (error || !section) return { error: error?.message || '섹션을 찾을 수 없어요.' };

  const { data: siblings, error: listErr } = await supabase
    .from('detail_page_sections')
    .select('id, position')
    .eq('project_id', section.project_id)
    .order('position', { ascending: true });
  if (listErr || !siblings) return { error: listErr?.message || '섹션 목록을 불러오지 못했어요.' };

  const idx = siblings.findIndex((s) => s.id === sectionId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || targetIdx < 0 || targetIdx >= siblings.length) {
    return { error: null }; // 맨 위/아래라 이동 불가 - 조용히 무시
  }
  const target = siblings[targetIdx];

  const [r1, r2] = await Promise.all([
    supabase.from('detail_page_sections').update({ position: target.position }).eq('id', sectionId),
    supabase.from('detail_page_sections').update({ position: section.position }).eq('id', target.id),
  ]);
  if (r1.error || r2.error) return { error: r1.error?.message || r2.error?.message };

  revalidatePath(PATH);
  return { error: null };
}

// "제품 사양" 표 섹션 - 마케팅 카피 섹션과 달리 AI 사진 생성이 필요
// 없어서 별도 액션으로 분리한다 (라벨/값 배열을 그대로 렌더링).
export async function addSpecSection(
  projectId: string,
  position: number,
  input: { title: string; rows: SpecRow[] }
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const rows = input.rows.filter((r) => r.label.trim() || r.value.trim());
  if (rows.length === 0) {
    return { error: '표에 항목을 하나 이상 입력해주세요.' };
  }
  const sectionId = randomUUID();
  const promptText = `제품 사양 표 (${rows.length}개 항목)`;

  const { error: insertErr } = await supabase.from('detail_page_sections').insert({
    id: sectionId,
    project_id: projectId,
    position,
    prompt_text: promptText,
    layout_style: 'spec',
    theme: 'light',
    spec_title: input.title || null,
    spec_rows: rows,
  });
  if (insertErr) return { error: insertErr.message };

  try {
    const generated = await composeSpecTableSection(rows, input.title);
    const outPath = `detail-pages/${projectId}/${sectionId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, generated, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    const outputUrl = supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl;

    await supabase.from('detail_page_sections').update({ output_image_url: outputUrl, error: null }).eq('id', sectionId);
    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    const message = e?.message || String(e);
    await supabase.from('detail_page_sections').update({ error: message }).eq('id', sectionId);
    revalidatePath(PATH);
    return { error: message };
  }
}

// 사용자가 칸을 하나씩 채우는 대신 AI에게 초안을 맡긴다 - 원본 사진
// OCR 결과(추출해뒀다면)와 프로젝트명, 이미 입력해둔 내용을 참고자료로
// 넘긴다.
export async function recommendSectionCopy(input: {
  productName: string;
  extractedText: string;
  existingHints: string;
}): Promise<{ error: string } | { success: true; data: DetailCopyRecommendation }> {
  try {
    const data = await recommendDetailSectionCopy(input);
    return { success: true, data };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function deleteSection(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('detail_page_sections').delete().eq('id', id);
  if (error) console.error('[detail-pages] deleteSection 실패:', error.message);
  revalidatePath(PATH);
}
