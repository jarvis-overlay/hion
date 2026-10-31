'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  generateDetailBackground,
  composeDetailSectionImage,
  detectAndTranslateText,
  composeSpecTableSection,
  composeSizeTableSection,
  fetchImageFromUrl,
  fetchTopSellerReferenceImages,
  type DetailSectionInput,
  type DetailSectionLayout,
  type DetailSectionTheme,
  type SpecRow,
} from '@/lib/imageProcessing';
import { recommendDetailSectionCopy, planDetailSectionsRaw, type DetailCopyRecommendation } from '@/lib/ai';
import { removeOverlays } from '@/lib/overlayCleanup';
import {
  analyzeSourceImage,
  recolorWithVerification,
  learnDetailFlow,
  DEFAULT_DETAIL_FLOW,
  type DetailFlowBrief,
} from '@/lib/detailCompose';
import {
  DETAIL_TEMPLATES,
  MAX_PLANNED_SECTIONS,
  evaluatePhoto,
  finalizePlan,
  mergeSellingOptions,
  normalizeSizeTable,
  encodeSizeTableRows,
  decodeSizeTableRows,
  type SizeTableData,
  sanitizePlannedFields,
  sanitizeSpecRows,
  type PlannedFields,
  type PlannedSection,
  type SellingOptions,
  type SourceAnalysis,
} from '@/lib/detailOptions';

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
  const imageUrl = String(formData.get('imageUrl') || '').trim();
  if ((!file || file.size === 0) && !imageUrl) return { error: '이미지를 먼저 첨부하거나 이미지 URL을 입력해주세요.' };

  try {
    let buffer: Buffer;
    let mimeType: string;
    if (file && file.size > 0) {
      buffer = Buffer.from(await file.arrayBuffer());
      mimeType = file.type || 'image/jpeg';
    } else {
      const fetched = await fetchImageFromUrl(imageUrl);
      buffer = fetched.buffer;
      mimeType = fetched.mimeType;
    }
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
  title: string,
  category?: string
): Promise<{ error: string } | { success: true; id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('detail_page_projects')
    .insert({ title: title.trim() || null, category: category?.trim() || null, author_email: user?.email })
    .select('id')
    .single();

  if (error || !data) return { error: error?.message || '프로젝트 생성에 실패했어요.' };
  revalidatePath(PATH);
  return { success: true, id: (data as { id: string }).id };
}

// 프로젝트 생성 후에도 "요즘 잘 팔리는 상품 참고" 카테고리를 나중에
// 설정/수정할 수 있게 - 처음에 안 적었다고 다시 만들 필요 없게 한다.
export async function updateProjectCategory(id: string, category: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from('detail_page_projects')
    .update({ category: category.trim() || null })
    .eq('id', id);
  if (error) console.error('[detail-pages] updateProjectCategory 실패:', error.message);
  revalidatePath(PATH);
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
  const imageUrl = String(formData.get('imageUrl') || '').trim();
  let inputImageUrl: string | null = null;
  let productImage: { buffer: Buffer; mimeType: string } | null = null;
  const sectionId = randomUUID();

  if ((file && file.size > 0) || imageUrl) {
    let buffer: Buffer;
    let mimeType: string;
    if (file && file.size > 0) {
      buffer = Buffer.from(await file.arrayBuffer());
      mimeType = file.type || 'image/jpeg';
    } else {
      try {
        const fetched = await fetchImageFromUrl(imageUrl);
        buffer = fetched.buffer;
        mimeType = fetched.mimeType;
      } catch (e: any) {
        return { error: e?.message || String(e) };
      }
    }
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

  return runGeneration(supabase, sectionId, projectId, input, productImage, null, {
    skipReference: formData.get('skipReference') === '1',
  });
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

  // 표 장면(사양표/사이즈표)은 사진 없이 저장된 내용으로 다시 그린다
  if (section.layout_style === 'spec') {
    const sizeTable = decodeSizeTableRows(section.spec_rows, section.spec_title);
    if (sizeTable) return renderSizeTable(supabase, section.project_id, sectionId, sizeTable);
    const rows: SpecRow[] = (Array.isArray(section.spec_rows) ? section.spec_rows : [])
      .map((r: any) => ({ label: String(r?.label ?? ''), value: String(r?.value ?? '') }))
      .filter((r: SpecRow) => r.label.trim() || r.value.trim());
    if (rows.length === 0) return { error: '사양표에 항목이 없어요. 수정에서 항목을 입력해주세요.' };
    try {
      const generated = await composeSpecTableSection(rows, section.spec_title || undefined);
      const outPath = `detail-pages/${section.project_id}/${sectionId}-output.jpg`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, generated, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upErr) throw new Error(upErr.message);
      const outputUrl = versioned(supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl);
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
  reuseBackground: Buffer | null = null,
  options: { skipReference?: boolean } = {}
): Promise<{ error: string } | { success: true; url: string }> {
  try {
    let background = reuseBackground;
    if ((input.layoutStyle || 'white') !== 'typography' && !background) {
      // "요즘 잘 팔리는 상품" 참고 - 프로젝트에 카테고리를 입력해둔
      // 경우에만 쿠팡 경쟁 상품 사진을 같이 넣어서 스타일 참고를 시킨다.
      const { data: project } = await supabase
        .from('detail_page_projects')
        .select('category')
        .eq('id', projectId)
        .maybeSingle();
      // 한 번에 만들기는 구성을 짤 때 쿠팡 인기상품을 이미 분석했으므로, 섹션마다 쿠팡을
      // 다시 크롤링하지 않는다 (섹션 수만큼 반복되면 느리고 크롤링 한도에 걸림).
      const referenceImages =
        project?.category && !options.skipReference ? await fetchTopSellerReferenceImages(project.category) : [];
      background = await generateDetailBackground(input, productImage, referenceImages);
      // AI가 원본 사진 속 글자/아이콘(특히 중국어)을 다시 그려 넣는 일이 잦아서, 생성 결과를
      // 검사해 남은 글자/아이콘은 코드로 지운다. 실패해도 생성은 계속한다(원본 그대로 사용).
      background = (await removeOverlays(background, 'image/jpeg')).buffer;
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
  const imageUrl = String(formData.get('imageUrl') || '').trim();
  const hasNewFile = (!!file && file.size > 0) || !!imageUrl;

  // 1) 원본 사진 교체/제거
  let inputImageUrl: string | null = section.input_image_url;
  let productImage: { buffer: Buffer; mimeType: string } | null = null;
  if (hasNewFile) {
    let buffer: Buffer;
    let mimeType: string;
    if (file && file.size > 0) {
      buffer = Buffer.from(await file.arrayBuffer());
      mimeType = file.type || 'image/jpeg';
    } else {
      try {
        const fetched = await fetchImageFromUrl(imageUrl);
        buffer = fetched.buffer;
        mimeType = fetched.mimeType;
      } catch (e: any) {
        return { error: e?.message || String(e) };
      }
    }
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

// 사이즈표 섹션 - 사용자가 직접 입력한 한국 기준 표를 그대로 그린다 (AI를 쓰지 않음).
async function renderSizeTable(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  sectionId: string,
  table: SizeTableData
): Promise<{ error: string } | { success: true; url: string }> {
  try {
    const generated = await composeSizeTableSection(table);
    const outPath = `detail-pages/${projectId}/${sectionId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, generated, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    const outputUrl = versioned(supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl);
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

export async function addSizeTableSection(
  projectId: string,
  position: number,
  input: SizeTableData
): Promise<{ error: string } | { success: true; url: string }> {
  const table = normalizeSizeTable(input);
  if (!table) return { error: '사이즈표에 열 2개 이상, 행 1개 이상을 입력해주세요.' };
  const supabase = createClient();
  const sectionId = randomUUID();
  const { error: insertErr } = await supabase.from('detail_page_sections').insert({
    id: sectionId,
    project_id: projectId,
    position,
    prompt_text: `사이즈표 (${table.rows.length}개 사이즈)`,
    layout_style: 'spec',
    theme: 'light',
    spec_title: table.title || '사이즈표',
    spec_rows: encodeSizeTableRows(table),
  });
  if (insertErr) return { error: insertErr.message };
  return renderSizeTable(supabase, projectId, sectionId, table);
}

export async function updateSizeTableSection(
  sectionId: string,
  input: SizeTableData
): Promise<{ error: string } | { success: true; url: string }> {
  const table = normalizeSizeTable(input);
  if (!table) return { error: '사이즈표에 열 2개 이상, 행 1개 이상을 입력해주세요.' };
  const supabase = createClient();
  const { data: section, error } = await supabase
    .from('detail_page_sections')
    .select('id, project_id, layout_style, spec_rows, spec_title')
    .eq('id', sectionId)
    .single();
  if (error || !section) return { error: error?.message || '섹션을 찾을 수 없어요.' };
  if (!decodeSizeTableRows(section.spec_rows)) return { error: '사이즈표 섹션이 아니에요.' };
  const { error: updateErr } = await supabase
    .from('detail_page_sections')
    .update({
      prompt_text: `사이즈표 (${table.rows.length}개 사이즈)`,
      spec_title: table.title || '사이즈표',
      spec_rows: encodeSizeTableRows(table),
    })
    .eq('id', sectionId);
  if (updateErr) return { error: updateErr.message };
  return renderSizeTable(supabase, section.project_id, sectionId, table);
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


// ---------------------------------------------------------------------------
// 한 번에 만들기: 여러 장의 중국 상품 사진 + 쿠팡 인기상품 흐름 -> 상세페이지 전체
// ---------------------------------------------------------------------------
// 화면(클라이언트)이 단계를 하나씩 호출하는 구조다:
//   1) uploadDetailSources - 사진을 3장씩 묶어 올리고 분석 (서버에서 동시에 처리)
//   2) planDetailPage      - 쿠팡 인기상품 흐름 + 사진 분석 + 취급 옵션 -> 장면 목록
//   3) generatePlannedSections - 장면을 3개씩 묶어 생성 (서버에서 동시에 처리)
// 한 요청에 전부 몰아넣으면 서버 제한 시간/본문 크기에 걸려 일부만 만들어지고, 서버 액션을 따로
// 여러 번 부르면 클라이언트가 차례로 하나씩만 실행하기 때문에 3개씩 묶어서 부른다.

export type UploadedSource =
  | { error: string }
  | {
      success: true;
      url: string; // 글자/아이콘을 지운 사진 주소 (지울 게 없었으면 원본)
      analysis: SourceAnalysis | null;
      analysisError: string | null;
      overlaysRemoved: number; // 지운 글자/아이콘 영역 수
    };

async function uploadAndAnalyze(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  file: File | null
): Promise<UploadedSource> {
  if (!file || file.size === 0) return { error: '이미지를 첨부해주세요.' };
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'image/jpeg';
  const path = `detail-pages/${projectId}/src-${randomUUID()}.${extFromContentType(mimeType)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (upErr) return { error: upErr.message };
  const originalUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // 분석(원본으로 해야 중국어를 읽는다)과 글자/아이콘 지우기를 동시에 한다. 상세페이지 생성에는
  // 글자를 지운 사진을 쓴다 - AI에게 "글자를 지워라"라고 말로만 시키면 사진의 일부로 보고
  // 그대로 다시 그려 넣는 일이 잦아서, 생성에 넣기 전에 코드로 먼저 지워둔다.
  // 분석이나 지우기가 실패해도 사진 자체는 올라간 것으로 처리한다 (색상 라벨을 붙였다면 그걸 믿고 쓸 수 있음).
  const [analysisRes, cleanRes] = await Promise.allSettled([
    analyzeSourceImage({ buffer, mimeType }),
    removeOverlays(buffer, mimeType),
  ]);
  let analysis: SourceAnalysis | null = null;
  let analysisError: string | null = null;
  if (analysisRes.status === 'fulfilled') analysis = analysisRes.value;
  else analysisError = (analysisRes.reason as any)?.message || String(analysisRes.reason);

  let url = originalUrl;
  let overlaysRemoved = 0;
  if (cleanRes.status === 'fulfilled' && cleanRes.value.removed > 0) {
    const cleanPath = `detail-pages/${projectId}/src-clean-${randomUUID()}.jpg`;
    const { error: cleanUpErr } = await supabase.storage.from(BUCKET).upload(cleanPath, cleanRes.value.buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (!cleanUpErr) {
      url = supabase.storage.from(BUCKET).getPublicUrl(cleanPath).data.publicUrl;
      overlaysRemoved = cleanRes.value.removed;
    }
  }
  return { success: true, url, analysis, analysisError, overlaysRemoved };
}

// 한 번에 최대 3장 (서버에서 동시에 올리고 분석). 결과는 받은 순서와 같은 순서로 돌려준다.
export async function uploadDetailSources(projectId: string, formData: FormData): Promise<UploadedSource[]> {
  const files = formData.getAll('images').filter((f): f is File => f instanceof File);
  if (files.length === 0) return [{ error: '이미지를 첨부해주세요.' }];
  const supabase = createClient();
  return mapLimit(files.slice(0, 3), 3, (file) => uploadAndAnalyze(supabase, projectId, file));
}

// 쿠팡 상세페이지 흐름은 카테고리별로 저장해두고 14일 재사용한다 (크롤링이 느리고 한도가
// 있어서). 저장은 썸네일 스타일과 같은 테이블을 쓰되 키 앞에 "상세흐름:"을 붙여 구분한다.
const DETAIL_FLOW_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const flowKey = (category: string) => `상세흐름:${category.trim()}`;

async function getOrLearnDetailFlow(
  supabase: ReturnType<typeof createClient>,
  category: string,
  force = false
): Promise<{ flow: DetailFlowBrief; fromCache: boolean; saveWarning: string | null }> {
  const key = flowKey(category);
  if (!force) {
    const { data, error } = await supabase
      .from('category_style_briefs')
      .select('brief, learned_at')
      .eq('category', key)
      .maybeSingle();
    if (!error && data?.brief?.flow && Date.now() - new Date(data.learned_at).getTime() < DETAIL_FLOW_TTL_MS) {
      return { flow: data.brief as DetailFlowBrief, fromCache: true, saveWarning: null };
    }
  }
  const flow = await learnDetailFlow(category);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error: saveErr } = await supabase.from('category_style_briefs').upsert(
    {
      category: key,
      brief: flow,
      source_count: flow.analysis?.products ?? 0,
      learned_at: new Date().toISOString(),
      author_email: user?.email ?? null,
    },
    { onConflict: 'category' }
  );
  return { flow, fromCache: false, saveWarning: saveErr ? saveErr.message : null };
}

// 화면의 "쿠팡 흐름 학습/다시 학습" 버튼
export async function learnDetailFlowNow(
  category: string,
  force: boolean
): Promise<{ error: string } | { success: true; flow: DetailFlowBrief; fromCache: boolean; warning: string | null }> {
  if (!category.trim()) return { error: '카테고리(쿠팡 검색어)를 먼저 입력해주세요.' };
  const supabase = createClient();
  try {
    const r = await getOrLearnDetailFlow(supabase, category, force);
    return {
      success: true,
      flow: r.flow,
      fromCache: r.fromCache,
      warning: r.saveWarning
        ? `분석은 했지만 저장하지 못했어요(${r.saveWarning}). supabase/thumbnail_style_learning.sql을 실행하면 재사용돼요.`
        : null,
    };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export interface DetailPlanInput {
  productName: string;
  category: string;
  colorsText: string; // 취급 색상 (쉼표로 구분)
  sizesText: string; // 취급 사이즈 (쉼표로 구분)
  sizeTable?: SizeTableData | null; // 직접 입력한 한국 기준 사이즈표 (없으면 사이즈표 장면 없음)
  sources: { url: string; colorLabel: string; analysis: SourceAnalysis | null }[];
  // 화면이 구성 기획 전에 먼저 학습해서 넘겨주는 쿠팡 흐름 (학습은 오래 걸릴 수 있어 요청을 나눔).
  // 학습에 실패했으면 flowError만 넘어오고, 둘 다 없으면 서버가 직접 학습/재사용한다.
  flow?: DetailFlowBrief | null;
  flowError?: string | null;
}

export interface PhotoReportItem {
  index: number;
  usable: boolean;
  color: string | null;
  reason: string | null;
  role: string;
}

export async function planDetailPage(
  projectId: string,
  input: DetailPlanInput
): Promise<
  | { error: string }
  | {
      success: true;
      sections: PlannedSection[];
      notes: string[];
      photoReport: PhotoReportItem[];
      selling: SellingOptions;
      forbiddenWords: string[];
      flow: DetailFlowBrief;
      flowKind: 'learned' | 'default';
    }
> {
  if (!input.sources || input.sources.length === 0) return { error: '사진을 먼저 올려주세요.' };
  const supabase = createClient();
  const category = (input.category || '').trim();
  const productName = (input.productName || '').trim() || category;

  // 입력한 카테고리/상품명을 프로젝트에 저장 (다음에 열었을 때 그대로 보이게)
  if (category) {
    const { error: catErr } = await supabase
      .from('detail_page_projects')
      .update({ category })
      .eq('id', projectId);
    if (catErr) console.error('[detail-pages] 카테고리 저장 실패:', catErr.message);
  }

  // 취급 옵션: 입력한 색상 + 사진에 붙인 색상 라벨
  const labels = input.sources.map((s) => (s.colorLabel || '').trim());
  const selling = mergeSellingOptions(input.colorsText || '', input.sizesText || '', labels);
  const analyses = input.sources.map((s) => s.analysis ?? null);
  const verdicts = analyses.map((a, i) => evaluatePhoto(a, selling, labels[i] || null));

  const notes: string[] = [];

  // 쿠팡 인기상품 상세페이지 흐름 (학습/재사용, 실패하거나 카테고리가 없으면 일반 흐름 + 경고)
  let flow: DetailFlowBrief = DEFAULT_DETAIL_FLOW;
  let flowKind: 'learned' | 'default' = 'default';
  const passed = input.flow && Array.isArray(input.flow.flow) && input.flow.flow.length >= 4 ? input.flow : null;
  if (passed) {
    flow = passed;
    flowKind = 'learned';
  } else if (input.flowError) {
    notes.push(
      `⚠ 쿠팡 인기상품을 참고하지 못했어요 - 흐름 학습에 실패해서 일반적인 구성으로 기획했어요: ${input.flowError}`
    );
  } else if (category) {
    try {
      const r = await getOrLearnDetailFlow(supabase, category);
      flow = r.flow;
      flowKind = 'learned';
      if (r.saveWarning) {
        notes.push(
          `학습한 흐름을 저장하지 못했어요(${r.saveWarning}). supabase/thumbnail_style_learning.sql을 실행하면 다음부터 재사용돼요.`
        );
      }
    } catch (e: any) {
      notes.push(
        `⚠ 쿠팡 인기상품을 참고하지 못했어요 - 흐름 학습에 실패해서 일반적인 구성으로 기획했어요: ${e?.message || String(e)}`
      );
    }
  } else {
    notes.push('⚠ 쿠팡 인기상품을 참고하지 않았어요 - 카테고리(쿠팡 검색어)가 비어 있어서 일반적인 구성으로 기획했어요. 카테고리를 입력하면 인기상품 상세페이지 흐름을 분석해서 만들어요.');
  }
  if (flowKind === 'learned' && flow.analysis && flow.analysis.detailImages === 0) {
    notes.push('쿠팡 인기상품의 상세 설명 이미지는 읽지 못해서 대표 이미지와 상품 정보 기준으로 흐름을 추정했어요. 참고 수준이 낮을 수 있어요.');
  }

  if (selling.colors.length === 0) {
    notes.push('취급 색상을 입력하지 않아서 상세페이지에 색상 정보는 넣지 않았어요 (색상이 보이는 사진도 쓰지 않았어요).');
  }
  if (selling.sizes.length === 0) {
    notes.push('취급 사이즈를 입력하지 않아서 상세페이지 문구·사양표에는 사이즈 정보를 넣지 않았어요.');
  }
  if (input.sizeTable && !normalizeSizeTable(input.sizeTable)) {
    notes.push('⚠ 입력한 사이즈표를 표로 읽지 못해서 사이즈표 장면은 만들지 않았어요.');
  }
  analyses.forEach((a, i) => {
    if (!a && !labels[i]) notes.push(`사진 ${i + 1}번은 분석에 실패해서 참고하지 못했어요.`);
  });

  // 구성안 (AI) -> 규칙 검사 (코드)
  let raw: any[];
  try {
    raw = await planDetailSectionsRaw({
      productName,
      category,
      flow,
      selling,
      photos: analyses.map((a, i) => ({
        index: i,
        role: a?.role ?? 'other',
        description: a?.description ?? '',
        koreanTexts: a?.koreanTexts ?? [],
        facts: a?.facts ?? [],
        colorLabel: labels[i] || null,
        colorsShown: a?.colorsShown ?? [],
        usable: verdicts[i].usable,
        reason: verdicts[i].reason,
      })),
      templates: DETAIL_TEMPLATES.map((t) => ({ id: t.id, use: t.use, needsPhoto: t.needsPhoto })),
      maxSections: MAX_PLANNED_SECTIONS - 1, // 마지막 한 칸은 사이즈표 장면용
    });
  } catch (e: any) {
    return { error: `구성 기획에 실패했어요: ${e?.message || String(e)}` };
  }

  const finalized = finalizePlan(raw, { verdicts, analyses, selling, sizeTable: normalizeSizeTable(input.sizeTable) });
  verdicts.forEach((v, i) => {
    if (!v.usable) notes.push(`사진 ${i + 1}번은 상품 사진으로 쓰지 않았어요: ${v.reason}`);
  });
  notes.push(...finalized.notes);

  if (finalized.sections.length === 0) {
    return { error: '만들 수 있는 장면이 없어요. 사진/취급 옵션을 확인하고 다시 시도해주세요.' };
  }

  const forbiddenWords = Array.from(
    new Set(
      analyses
        .flatMap((a) => a?.colorsShown || [])
        .filter((c) => !selling.colors.some((s) => s.trim().toLowerCase() === c.trim().toLowerCase()))
    )
  );

  return {
    success: true,
    sections: finalized.sections,
    notes: Array.from(new Set(notes)),
    photoReport: verdicts.map((v, i) => ({
      index: i,
      usable: v.usable,
      color: v.color,
      reason: v.reason,
      role: analyses[i]?.role ?? 'other',
    })),
    selling,
    forbiddenWords,
    flow,
    flowKind,
  };
}

// 구성안의 장면 하나를 실제 이미지로 만든다. 클라이언트가 보낸 값이라 마지막으로 한 번 더
// 취급 옵션 검사를 한다 (구성안을 받은 뒤 값이 바뀌었더라도 규칙이 지켜지게).
async function generatePlannedSectionOne(
  projectId: string,
  position: number,
  planned: PlannedSection,
  sourceUrl: string | null,
  selling: SellingOptions,
  forbiddenWords: string[]
): Promise<{ error: string } | { success: true; url: string }> {
  if (planned.kind === 'sizechart') {
    const table = normalizeSizeTable(planned.sizeTable);
    if (!table) return { error: '사이즈표 내용이 없어요.' };
    return addSizeTableSection(projectId, position, table);
  }
  if (planned.kind === 'spec') {
    const cleaned = sanitizeSpecRows(planned.specRows || [], selling, forbiddenWords || []);
    if (cleaned.rows.length === 0) return { error: '사양표에 넣을 항목이 없어요.' };
    return addSpecSection(projectId, position, { title: planned.specTitle || '제품 사양', rows: cleaned.rows });
  }

  const cleaned = sanitizePlannedFields(planned.fields as PlannedFields, selling, forbiddenWords || []);
  const f = cleaned.fields;
  const template = DETAIL_TEMPLATES.find((t) => t.id === planned.templateId) || DETAIL_TEMPLATES[0];
  const fd = new FormData();
  fd.set('keyword', f.keyword);
  fd.set('mood', f.mood);
  fd.set('description', f.description);
  fd.set('eyebrow', f.eyebrow);
  fd.set('accentTitle', f.accentTitle);
  fd.set('accentSubtitle', f.accentSubtitle);
  fd.set('stat', f.stat);
  fd.set('statCaption', f.statCaption);
  fd.set('badge', f.badge);
  fd.set('bodyText', f.bodyText);
  fd.set('listItems', f.listItems);
  fd.set('colorPrompt', ''); // 색상 변경 지시는 쓰지 않는다 (취급하지 않는 색이 나올 수 있음)
  fd.set('layoutStyle', template.layoutStyle);
  fd.set('theme', template.theme);
  if (template.needsPhoto && sourceUrl) fd.set('imageUrl', sourceUrl);
  fd.set('skipReference', '1');
  return addSection(projectId, position, fd);
}

// 색상 변환: 내가 파는 색상의 사진이 없을 때 다른 색 사진을 그 색으로 바꾼다. 한 번에 최대 2장
// (이미지 생성 + 검사를 최대 2번씩 해서 오래 걸림). 검사를 통과한 결과만 새 사진으로 올린다.
export type RecolorResult = { error: string } | { success: true; url: string };

export async function recolorPhotos(
  projectId: string,
  jobs: { url: string; from: string | null; to: string }[]
): Promise<RecolorResult[]> {
  if (!Array.isArray(jobs) || jobs.length === 0) return [{ error: '변환할 사진이 없어요.' }];
  const supabase = createClient();
  return mapLimit(jobs.slice(0, 2), 2, async (job): Promise<RecolorResult> => {
    try {
      const to = String(job.to || '').trim().slice(0, 20);
      if (!to) return { error: '바꿀 색상이 없어요.' };
      const img = await fetchImageFromUrl(job.url);
      const r = await recolorWithVerification(img, job.from, to);
      if (!r.success) return { error: r.error };
      const path = `detail-pages/${projectId}/src-recolor-${randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, r.buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upErr) return { error: upErr.message };
      return { success: true, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  });
}

// 한 번에 최대 3장면 (서버에서 동시에 생성). 결과는 받은 순서와 같은 순서로 돌려준다.
export async function generatePlannedSections(
  projectId: string,
  items: { position: number; planned: PlannedSection; sourceUrl: string | null }[],
  selling: SellingOptions,
  forbiddenWords: string[]
): Promise<({ error: string } | { success: true; url: string })[]> {
  if (!Array.isArray(items) || items.length === 0) return [{ error: '만들 장면이 없어요.' }];
  return mapLimit(items.slice(0, 3), 3, (it) =>
    generatePlannedSectionOne(projectId, it.position, it.planned, it.sourceUrl, selling, forbiddenWords)
  );
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}
