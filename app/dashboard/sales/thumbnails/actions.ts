'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  generateThumbnailImage,
  applyThumbnailEffect,
  isImageVisuallyUnchanged,
  duplicateImageStrip,
  enforceThumbnailSize,
  fetchImageFromUrl,
  fetchTopSellerReferenceImages,
  describeProductAppearance,
  generatePackageThumbnail,
  type ThumbnailPosition,
} from '@/lib/imageProcessing';
import { parsePackages, packageLabel, sameColor } from '@/lib/thumbnailPackage';
import { generateThumbnailCopies, sanitizeThumbnailCopy } from '@/lib/ai';
import {
  learnStyleBrief,
  generateStyledAdditionalImage,
  STYLE_BRIEF_TTL_MS,
  DEFAULT_STYLE_BRIEF,
  type StyleBrief,
  type StyleShot,
  type StyleAnalysisInfo,
  type ShotCopyText,
} from '@/lib/styledThumbnail';

// 상세페이지 제작과 같은 storage 버킷(detail-images)을 재사용한다 -
// 새 버킷을 새로 만들 필요 없음.
const BUCKET = 'detail-images';
const PATH = '/dashboard/sales/thumbnails';

function extFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
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
    .from('thumbnail_projects')
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
    .from('thumbnail_projects')
    .update({ category: category.trim() || null })
    .eq('id', id);
  if (error) console.error('[thumbnails] updateProjectCategory 실패:', error.message);
  revalidatePath(PATH);
}

export async function deleteProject(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('thumbnail_projects').delete().eq('id', id);
  if (error) console.error('[thumbnails] deleteProject 실패:', error.message);
  revalidatePath(PATH);
}

// 이미지 하나(메인 또는 추가) 추가 - 누끼+흰배경 배치+(선택)효과까지
// 즉시 실행한다. 메인 썸네일은 슬롯이 하나뿐이라, 새로 추가하면 기존
// 메인은 교체(삭제 후 새로 추가)한다.
export async function addThumbnailImage(
  projectId: string,
  kind: 'main' | 'additional',
  position: number,
  formData: FormData
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const file = formData.get('image') as File | null;
  const imageUrl = String(formData.get('imageUrl') || '').trim();
  if ((!file || file.size === 0) && !imageUrl) return { error: '이미지를 첨부하거나 이미지 URL을 입력해주세요.' };

  const productPosition = (String(formData.get('productPosition') || 'center') as ThumbnailPosition) || 'center';
  const effectPrompt = String(formData.get('effectPrompt') || '').trim();

  if (kind === 'main') {
    await supabase.from('thumbnail_images').delete().eq('project_id', projectId).eq('kind', 'main');
  }

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
  const imageId = randomUUID();
  const inputPath = `thumbnails/${projectId}/${imageId}-input.${extFromContentType(mimeType)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(inputPath, buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (upErr) return { error: upErr.message };
  const inputImageUrl = supabase.storage.from(BUCKET).getPublicUrl(inputPath).data.publicUrl;

  const { error: insertErr } = await supabase.from('thumbnail_images').insert({
    id: imageId,
    project_id: projectId,
    kind,
    position,
    input_image_url: inputImageUrl,
    product_position: productPosition,
    effect_prompt: effectPrompt || null,
  });
  if (insertErr) return { error: insertErr.message };

  return runGeneration(supabase, imageId, projectId, { buffer, mimeType }, productPosition, effectPrompt);
}

// 메인/추가 이미지 하나를 업로드→DB 등록→생성까지 묶어서 처리 - 일괄
// 생성에서 사진마다(합성 변형이든, 실제 서로 다른 사진이든) 반복되는
// 동일한 절차라 공용으로 뺐다.
async function insertAndGenerateImage(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  kind: 'main' | 'additional',
  position: number,
  source: { buffer: Buffer; mimeType: string },
  productPosition: ThumbnailPosition,
  effectPrompt: string,
  colorLabel: string | null = null
): Promise<{ error: string } | { success: true; url: string }> {
  const imageId = randomUUID();
  const inputPath = `thumbnails/${projectId}/${imageId}-input.${extFromContentType(source.mimeType)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(inputPath, source.buffer, {
    contentType: source.mimeType,
    upsert: true,
  });
  if (upErr) return { error: upErr.message };
  const inputImageUrl = supabase.storage.from(BUCKET).getPublicUrl(inputPath).data.publicUrl;

  const { error: insertErr } = await supabase.from('thumbnail_images').insert({
    id: imageId,
    project_id: projectId,
    kind,
    position,
    input_image_url: inputImageUrl,
    product_position: productPosition,
    effect_prompt: effectPrompt || null,
    color_label: colorLabel,
  });
  if (insertErr) return { error: insertErr.message };

  return runGeneration(supabase, imageId, projectId, source, productPosition, effectPrompt);
}

// ---------------------------------------------------------------------------
// 인기상품 스타일 학습 기반 추가 이미지
// ---------------------------------------------------------------------------
// 카테고리의 쿠팡 인기상품을 분석한 "스타일"을 카테고리별로 저장해두고(14일
// 재사용) 추가 이미지를 만들 때 쓴다. 저장 테이블이 아직 없어도 학습/생성은
// 그대로 되고(저장만 못 함), 저장 실패 사유는 호출한 쪽에 알려준다.
interface StyledSpec {
  shot: StyleShot;
  copy: ShotCopyText | null;
  brief: Pick<StyleBrief, 'background' | 'props' | 'lighting'>;
  note?: string; // 상품 특징 메모/수정 요청 (다시 만들 때도 같이 적용)
}

async function getOrLearnBrief(
  supabase: ReturnType<typeof createClient>,
  category: string,
  force = false
): Promise<{ brief: StyleBrief; sourceCount: number; fromCache: boolean; saveWarning: string | null }> {
  const key = category.trim();
  if (!force) {
    const { data, error } = await supabase
      .from('category_style_briefs')
      .select('brief, source_count, learned_at')
      .eq('category', key)
      .maybeSingle();
    if (!error && data?.brief && Date.now() - new Date(data.learned_at).getTime() < STYLE_BRIEF_TTL_MS) {
      return { brief: data.brief as StyleBrief, sourceCount: data.source_count || 0, fromCache: true, saveWarning: null };
    }
  }

  const learned = await learnStyleBrief(key);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error: saveErr } = await supabase.from('category_style_briefs').upsert(
    {
      category: key,
      brief: learned.brief,
      source_count: learned.sourceCount,
      learned_at: new Date().toISOString(),
      author_email: user?.email ?? null,
    },
    { onConflict: 'category' }
  );
  return { ...learned, fromCache: false, saveWarning: saveErr ? saveErr.message : null };
}

// 화면의 "스타일 다시 학습" 버튼 - 저장된 걸 무시하고 지금 인기상품으로 새로 학습한다.
export async function relearnStyle(
  projectId: string
): Promise<
  | { error: string }
  | { success: true; sourceCount: number; analysis: StyleAnalysisInfo | null; warning: string | null }
> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from('thumbnail_projects')
    .select('category')
    .eq('id', projectId)
    .maybeSingle();
  if (!project?.category) return { error: '카테고리를 먼저 설정해주세요.' };
  try {
    const r = await getOrLearnBrief(supabase, project.category, true);
    revalidatePath(PATH);
    return {
      success: true,
      sourceCount: r.sourceCount,
      analysis: r.brief.analysis ?? null,
      warning: r.saveWarning
        ? `스타일은 분석했지만 저장하지 못했어요(${r.saveWarning}). supabase/thumbnail_style_learning.sql을 실행해주세요.`
        : null,
    };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
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

async function runStyledGeneration(
  supabase: ReturnType<typeof createClient>,
  imageId: string,
  projectId: string,
  productImage: { buffer: Buffer; mimeType: string },
  spec: StyledSpec,
  appearanceSpec?: string | null
): Promise<{ error: string } | { success: true; url: string }> {
  try {
    const generated = await generateStyledAdditionalImage({
      productImage,
      brief: spec.brief,
      shot: spec.shot,
      copy: spec.copy,
      appearanceSpec,
      note: spec.note,
    });
    const outPath = `thumbnails/${projectId}/${imageId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, await enforceThumbnailSize(generated), {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    const outputUrl = supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl;

    const { error: updateErr } = await supabase
      .from('thumbnail_images')
      .update({ output_image_url: outputUrl, error: null })
      .eq('id', imageId);
    if (updateErr) return { error: updateErr.message };
    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    const message = e?.message || String(e);
    await supabase.from('thumbnail_images').update({ error: message }).eq('id', imageId);
    revalidatePath(PATH);
    return { error: message };
  }
}

async function insertAndGenerateStyled(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  position: number,
  source: { buffer: Buffer; mimeType: string },
  spec: StyledSpec,
  colorLabel: string | null,
  appearanceSpec: string | null
): Promise<{ error: string } | { success: true; url: string }> {
  const imageId = randomUUID();
  const inputPath = `thumbnails/${projectId}/${imageId}-input.${extFromContentType(source.mimeType)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(inputPath, source.buffer, {
    contentType: source.mimeType,
    upsert: true,
  });
  if (upErr) return { error: upErr.message };
  const inputImageUrl = supabase.storage.from(BUCKET).getPublicUrl(inputPath).data.publicUrl;

  const row = {
    id: imageId,
    project_id: projectId,
    kind: 'additional',
    position,
    input_image_url: inputImageUrl,
    product_position: 'center',
    effect_prompt: null,
    color_label: colorLabel,
    style_spec: spec,
  };
  let { error: insertErr } = await supabase.from('thumbnail_images').insert(row);
  if (insertErr && /style_spec|schema cache|column/i.test(insertErr.message)) {
    // style_spec 컬럼 마이그레이션 전이면 그 컬럼만 빼고 저장한다 (이미지는 생성되지만
    // 실패했을 때 같은 컷으로 "다시 생성"은 못 함)
    const { style_spec: _omit, ...legacyRow } = row;
    ({ error: insertErr } = await supabase.from('thumbnail_images').insert(legacyRow));
  }
  if (insertErr) return { error: insertErr.message };

  return runStyledGeneration(supabase, imageId, projectId, source, spec, appearanceSpec);
}

// ---------------------------------------------------------------------------
// 일괄 생성: 색상(묶음)마다 메인 1장 + 추가 이미지 N장
// ---------------------------------------------------------------------------
interface BatchSource {
  buffer: Buffer;
  mimeType: string;
}

interface StyledJob {
  label: string | null;
  position: number;
  source: BatchSource;
  appearanceSpec: string | null;
  spec: StyledSpec;
}

const MAX_ADDITIONAL = 8;
// 서버 실행 제한(280초) 안에 응답이 끝나도록, 이 시간이 지나면 아직 시작하지 않은 추가
// 이미지는 건너뛴다. 건너뛴 만큼은 화면에 안내하고(행도 만들지 않음) 다시 시도하게 한다.
const BATCH_DEADLINE_MS = 235_000;

// 한 색상 묶음의 컷별 한국어 문구와 원본 사진별 외형 명세를 준비해서, 만들 이미지
// 작업 목록을 돌려준다. 컷은 스타일의 컷 목록을 순서대로(모자라면 반복), 원본
// 사진은 그 색상의 사진이 여러 장이면 돌려가며 쓴다.
async function prepareStyledGroup(args: {
  productName: string;
  category: string;
  brief: StyleBrief;
  sources: BatchSource[];
  count: number;
  label: string | null;
  startIndex: number;
  note?: string;
}): Promise<{ jobs: StyledJob[]; copyMissing: boolean }> {
  const { brief, sources, count } = args;
  if (count <= 0) return { jobs: [], copyMissing: false };
  const shots: StyleShot[] = Array.from({ length: count }, (_, i) => brief.shots[i % brief.shots.length]);

  // 컷별 한국어 문구 (실패하면 문구 없이 이미지만 만든다)
  const copyByShot = new Map<string, ShotCopyText>();
  const uniqueShots = brief.shots.slice(0, Math.min(count, brief.shots.length));
  try {
    const copies = await generateThumbnailCopies({
      productName: args.productName,
      category: args.category,
      sellingPoints: brief.sellingPoints,
      shots: uniqueShots.map((s) => ({ id: s.id, title: s.title, layout: s.layout || 'caption' })),
    });
    for (const c of copies) {
      const shot = uniqueShots.find((s) => s.id === c.shotId);
      // 헤드라인이 비었거나 금지어면 문구 없는 이미지로 둔다. 컷 이름(내부용)을 대신 쓰면
      // "위에서 내려다본 컷" 같은 말이 고객용 이미지에 그대로 찍힌다.
      if (shot) copyByShot.set(shot.id, sanitizeThumbnailCopy(c, ''));
    }
  } catch (e) {
    console.error('[thumbnails] 컷 문구 생성 실패:', e);
  }

  // 원본 사진마다 외형 명세를 한 번만 뽑아서 같은 사진으로 만드는 컷들이 공유한다
  const appearanceSpecs = await Promise.all(sources.map((s) => describeProductAppearance(s)));

  const jobs: StyledJob[] = shots.map((shot, i) => ({
    label: args.label,
    position: args.startIndex + i,
    source: sources[i % sources.length],
    appearanceSpec: appearanceSpecs[i % sources.length],
    spec: {
      shot,
      copy: copyByShot.get(shot.id) ?? null,
      brief: { background: brief.background, props: brief.props, lighting: brief.lighting },
      ...(args.note ? { note: args.note } : {}),
    },
  }));
  return { jobs, copyMissing: copyByShot.size === 0 };
}

// 색상마다 작업을 하나씩 번갈아 세워서, 시간 예산이 모자라 일부를 건너뛰게 되더라도
// 특정 색상만 통째로 빠지지 않게 한다.
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

const clampCount = (v: unknown, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(MAX_ADDITIONAL, Math.round(n)));
};

export async function generateThumbnailBatch(
  projectId: string,
  formData: FormData
): Promise<
  | { error: string }
  | {
      success: true;
      mainOk: number;
      mainTotal: number;
      additionalOk: number;
      additionalTotal: number;
      colorGroups: number;
      // 'learned' = 쿠팡 인기상품 분석 스타일, 'default' = 범용 기본 구성(쿠팡 참고 없음)
      styleKind: 'learned' | 'default';
      styleSourceCount: number;
      styleAnalysis: StyleAnalysisInfo | null;
      packageOk: number;
      packageTotal: number;
      notes: string[];
    }
> {
  const startedAt = Date.now();
  const supabase = createClient();

  // 1) 입력 -> 색상 묶음. 사진을 여러 장 올렸으면 색상 라벨이 같은 사진끼리 한 묶음(라벨
  //    없는 사진은 "기본" 묶음), URL이면 묶음 하나. 묶음마다 첫 사진이 메인이 되고,
  //    추가 이미지는 그 묶음의 사진들로 만든다.
  const rawFiles = formData.getAll('images');
  const rawLabels = formData.getAll('colorLabels');
  const filePairs = rawFiles
    .map((f, i) => ({ file: f, colorLabel: String(rawLabels[i] || '').trim() || null }))
    .filter((p): p is { file: File; colorLabel: string | null } => p.file instanceof File && p.file.size > 0);
  const imageUrl = String(formData.get('imageUrl') || '').trim();
  if (filePairs.length === 0 && !imageUrl) return { error: '이미지를 첨부하거나 이미지 URL을 입력해주세요.' };

  const groups = new Map<string | null, BatchSource[]>();
  if (filePairs.length > 0) {
    for (const p of filePairs) {
      const src: BatchSource = {
        buffer: Buffer.from(await p.file.arrayBuffer()),
        mimeType: p.file.type || 'image/jpeg',
      };
      if (!groups.has(p.colorLabel)) groups.set(p.colorLabel, []);
      groups.get(p.colorLabel)!.push(src);
    }
  } else {
    try {
      groups.set(null, [await fetchImageFromUrl(imageUrl)]);
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  }

  // 2) 색상별 추가 이미지 개수 (화면에서 색상마다 지정, 없으면 기본값)
  const defaultCount = clampCount(formData.get('additionalCount'), 5);
  let countsByLabel: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(formData.get('additionalCounts') || '{}'));
    if (parsed && typeof parsed === 'object') countsByLabel = parsed;
  } catch {
    // 잘못된 값이면 전부 기본 개수를 쓴다
  }
  const countFor = (label: string | null) => clampCount(countsByLabel[label ?? ''], defaultCount);

  // 3) 스타일: 카테고리가 있으면 쿠팡 인기상품 학습 스타일(저장된 것 재사용), 없거나
  //    학습에 실패하면 범용 기본 구성. 어느 쪽이든 추가 이미지는 항상 만들고, 기본
  //    구성이 된 이유는 화면에 안내한다.
  const { data: projectRow } = await supabase
    .from('thumbnail_projects')
    .select('title, category')
    .eq('id', projectId)
    .maybeSingle();
  // 화면의 일괄 생성 박스에서 카테고리를 같이 보내면 그 값을 쓰고 프로젝트에도 저장한다
  // (예전엔 화면 위쪽의 작은 링크로만 설정할 수 있어서 비워둔 채 만드는 일이 많았음).
  const submittedCategory = formData.has('category') ? String(formData.get('category') || '').trim() : null;
  const category = (submittedCategory ?? projectRow?.category ?? '').trim();
  if (submittedCategory !== null && submittedCategory !== (projectRow?.category || '').trim()) {
    await supabase.from('thumbnail_projects').update({ category: submittedCategory || null }).eq('id', projectId);
  }
  const productName = (projectRow?.title || '').trim() || category;
  const productNote = String(formData.get('productNote') || '').trim().slice(0, 400);
  const notes: string[] = [];
  // 패키지(세트) 구성: 예) 검정 1 + 회색 1. 색상별 개별 이미지 대신(또는 함께) 그 구성 그대로 담은 이미지를 만든다.
  const parsedPackages = parsePackages(String(formData.get('packages') || '[]'));
  const packages = parsedPackages.packages;
  const packageOnly = formData.get('packageOnly') === '1' && packages.length > 0;
  notes.push(...parsedPackages.warnings);
  let brief: StyleBrief = DEFAULT_STYLE_BRIEF;
  let styleKind: 'learned' | 'default' = 'default';
  let styleSourceCount = 0;
  let styleAnalysis: StyleAnalysisInfo | null = null;
  if (category) {
    try {
      const learned = await getOrLearnBrief(supabase, category);
      brief = learned.brief;
      styleKind = 'learned';
      styleSourceCount = learned.sourceCount;
      styleAnalysis = learned.brief.analysis ?? null;
      if (learned.saveWarning) {
        notes.push(
          `학습한 스타일을 저장하지 못했어요(${learned.saveWarning}). supabase/thumbnail_style_learning.sql을 실행하면 다음부터 재사용돼요.`
        );
      }
    } catch (e: any) {
      notes.push(
        `⚠ 쿠팡 인기상품을 참고하지 못했어요 - 인기상품 스타일 학습에 실패해서 범용 기본 구성으로 만들었어요: ${e?.message || String(e)}`
      );
    }
  } else {
    notes.push(
      '⚠ 쿠팡 인기상품을 참고하지 않았어요 - 카테고리(쿠팡 검색어)가 비어 있어서 범용 기본 구성으로 만들었어요. 카테고리를 입력하면 인기상품을 분석해서 만들어요.'
    );
  }
  if (styleKind === 'learned' && styleAnalysis && styleAnalysis.galleryImages === 0) {
    notes.push(
      '인기상품의 추가 이미지(상품 페이지 갤러리)는 읽지 못해서 검색결과 대표 이미지 기준으로 분석했어요. 참고 수준이 낮을 수 있어요.'
    );
  }

  // 4) 메인: 묶음(색상)마다 1장, 같은 색상의 기존 메인은 교체. 색상끼리는 2개씩 동시에.
  const allGroups = Array.from(groups.entries());
  const entries = packageOnly ? [] : allGroups;
  const mainResults = await mapLimit(entries, 2, async ([label, sources]) => {
    let del = supabase.from('thumbnail_images').delete().eq('project_id', projectId).eq('kind', 'main');
    del = label ? del.eq('color_label', label) : del.is('color_label', null);
    await del;
    return insertAndGenerateImage(supabase, projectId, 'main', 0, sources[0], 'center', '', label);
  });
  const mainOk = mainResults.filter((r) => !('error' in r)).length;
  const mainErr = mainResults.find((r): r is { error: string } => 'error' in r);
  if (mainErr) notes.push(`메인 이미지 생성 실패: ${mainErr.error}`);

  // 4-2) 패키지 메인: 색상별 사진을 누끼로 따서 정확한 수량만큼 한 장에 배치 (패키지 2개씩 동시에)
  const packageResults = await mapLimit(packages, 2, async (p) => {
    // 색상 이름은 올린 사진의 라벨 표기로 통일한다 (공백/대소문자만 다른 입력도 같은 색으로 봄)
    const resolved = p.items.map((it) => ({ color: allGroups.find(([l]) => l && sameColor(l, it.color))?.[0] ?? it.color, qty: it.qty }));
    const label = packageLabel({ items: resolved, additional: p.additional });
    const items: { productImage: BatchSource; quantity: number }[] = [];
    for (const it of p.items) {
      const g = allGroups.find(([l]) => l && sameColor(l, it.color));
      if (!g) return { label, p, error: `"${it.color}" 색상으로 표시한 사진이 없어요. 사진마다 색상을 적어주세요.` };
      items.push({ productImage: g[1][0], quantity: it.qty });
    }
    try {
      const composite = await generatePackageThumbnail(items);
      const saved = await savePackageMain(supabase, projectId, label, composite);
      if ('error' in saved) return { label, p, error: saved.error };
      return { label, p, composite };
    } catch (e: any) {
      return { label, p, error: e?.message || String(e) };
    }
  });
  const packagesOk = packageResults.filter((r): r is typeof r & { composite: Buffer } => 'composite' in r);
  for (const r of packageResults) if ('error' in r) notes.push(`"${r.label}" 생성 실패: ${r.error}`);
  if (packages.length > 0 && allGroups.every(([l]) => !l)) {
    notes.push('⚠ 패키지는 사진마다 색상 라벨이 있어야 만들 수 있어요.');
  }

  // 5) 추가 이미지: 색상마다 준비(문구·외형 명세)해서 한 줄로 세우고 3개씩 동시에 생성
  const { count: existingCount } = await supabase
    .from('thumbnail_images')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('kind', 'additional');
  let nextIndex = existingCount || 0;
  const startIndexes = entries.map(([label]) => {
    const start = nextIndex;
    nextIndex += countFor(label);
    return start;
  });
  const preparedEntries = await Promise.all(
    entries.map(([label, sources], i) =>
      prepareStyledGroup({
        productName,
        category,
        brief,
        sources,
        count: countFor(label),
        label,
        startIndex: startIndexes[i],
        note: productNote,
      })
    )
  );
  // 패키지 추가 이미지: 패키지 메인(수량이 정확히 맞는 합성 이미지)을 상품 사진으로 써서 컷을 만든다
  const packageStarts = packagesOk.map((r) => {
    const start = nextIndex;
    nextIndex += r.p.additional;
    return start;
  });
  const preparedPackages = await Promise.all(
    packagesOk.map((r, i) =>
      prepareStyledGroup({
        productName,
        category,
        brief,
        sources: [{ buffer: r.composite, mimeType: 'image/jpeg' }],
        count: r.p.additional,
        label: r.label,
        startIndex: packageStarts[i],
        note: productNote,
      })
    )
  );
  const prepared = [...preparedEntries, ...preparedPackages];
  if (prepared.some((p) => p.copyMissing)) notes.push('문구 생성에 실패해서 일부 이미지는 문구 없이 만들었어요.');

  const jobs = interleave(prepared.map((p) => p.jobs));
  const results = await mapLimit(jobs, 3, async (job) => {
    if (Date.now() - startedAt > BATCH_DEADLINE_MS) return { skipped: true as const };
    return insertAndGenerateStyled(
      supabase,
      projectId,
      job.position,
      job.source,
      job.spec,
      job.label,
      job.appearanceSpec
    );
  });
  const skipped = results.filter((r) => 'skipped' in r).length;
  const failed = results.filter((r): r is { error: string } => 'error' in r);
  const additionalOk = results.filter((r) => 'success' in r).length;
  if (skipped > 0) {
    notes.push(
      `시간 제한 때문에 추가 이미지 ${skipped}장은 만들지 못했어요. 개수를 줄이거나 색상을 나눠서 다시 생성해주세요.`
    );
  }
  if (failed.length > 0) {
    notes.push(
      `추가 이미지 ${failed.length}장 생성 실패: ${failed[0].error} (실패한 카드의 '다시 생성'으로 다시 시도할 수 있어요)`
    );
  }

  revalidatePath(PATH);
  return {
    success: true,
    mainOk,
    mainTotal: entries.length,
    additionalOk,
    additionalTotal: jobs.length,
    colorGroups: entries.length,
    styleKind,
    styleSourceCount,
    styleAnalysis,
    packageOk: packagesOk.length,
    packageTotal: packages.length,
    notes: Array.from(new Set(notes)),
  };
}

// 패키지 메인: 이미 완성된 합성 이미지를 그대로 저장한다 (누끼 파이프라인을 다시 타지 않음).
// 같은 패키지 구성의 기존 메인은 교체한다.
async function savePackageMain(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  label: string,
  composite: Buffer
): Promise<{ error: string } | { success: true; url: string }> {
  await supabase.from('thumbnail_images').delete().eq('project_id', projectId).eq('kind', 'main').eq('color_label', label);
  const imageId = randomUUID();
  const body = await enforceThumbnailSize(composite);
  const outPath = `thumbnails/${projectId}/${imageId}-output.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, body, { contentType: 'image/jpeg', upsert: true });
  if (upErr) return { error: upErr.message };
  const url = supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl;
  const { error: insertErr } = await supabase.from('thumbnail_images').insert({
    id: imageId,
    project_id: projectId,
    kind: 'main',
    position: 0,
    input_image_url: url,
    output_image_url: url,
    product_position: 'center',
    effect_prompt: null,
    color_label: label,
  });
  if (insertErr) return { error: insertErr.message };
  return { success: true, url };
}

export async function retryThumbnailImage(
  imageId: string
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const { data: img, error } = await supabase.from('thumbnail_images').select('*').eq('id', imageId).single();
  if (error || !img) return { error: error?.message || '이미지를 찾을 수 없어요.' };

  const res = await fetch(img.input_image_url);
  if (!res.ok) return { error: `원본 이미지를 다시 불러오지 못했어요 (HTTP ${res.status})` };
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') || 'image/jpeg';

  // 스타일 적용으로 만들었던 이미지는 같은 컷/문구로 다시 만든다 (누끼 방식으로
  // 돌아가면 결과가 완전히 달라져 버리므로)
  if (img.style_spec?.shot) {
    return runStyledGeneration(
      supabase,
      imageId,
      img.project_id,
      { buffer, mimeType },
      img.style_spec as StyledSpec
    );
  }

  return runGeneration(
    supabase,
    imageId,
    img.project_id,
    { buffer, mimeType },
    (img.product_position as ThumbnailPosition) || 'center',
    img.effect_prompt || ''
  );
}

async function runGeneration(
  supabase: ReturnType<typeof createClient>,
  imageId: string,
  projectId: string,
  productImage: { buffer: Buffer; mimeType: string },
  position: ThumbnailPosition,
  effectPrompt: string
): Promise<{ error: string } | { success: true; url: string }> {
  try {
    // 효과(소품/연출 추가) 요청이 있을 때만 "요즘 잘 팔리는 상품" 참고
    // 이미지를 같이 넣는다 - 기본 흰 배경 패키샷 자체는 쿠팡 규격상
    // 항상 동일해야 해서 스타일 참고가 끼어들 자리가 없다.
    let referenceImages: { buffer: Buffer; mimeType: string }[] = [];
    if (effectPrompt.trim()) {
      const { data: project } = await supabase
        .from('thumbnail_projects')
        .select('category')
        .eq('id', projectId)
        .maybeSingle();
      if (project?.category) {
        referenceImages = await fetchTopSellerReferenceImages(project.category);
      }
    }

    const generated = await generateThumbnailImage({
      productImage,
      position,
      effectPrompt: effectPrompt || undefined,
      referenceImages,
    });
    const outPath = `thumbnails/${projectId}/${imageId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, await enforceThumbnailSize(generated), {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) throw new Error(upErr.message);
    const outputUrl = supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl;

    const { error: updateErr } = await supabase
      .from('thumbnail_images')
      .update({ output_image_url: outputUrl, error: null })
      .eq('id', imageId);
    if (updateErr) return { error: updateErr.message };

    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    const message = e?.message || String(e);
    await supabase.from('thumbnail_images').update({ error: message }).eq('id', imageId);
    revalidatePath(PATH);
    return { error: message };
  }
}

// 이미 생성된 썸네일을 처음부터 다시 만드는 게 아니라, 지금 결과
// 이미지에 프롬프트로 부분 수정을 한 번 더 입힌다 - applyThumbnailEffect가
// "이미지+텍스트 지시 -> 수정된 이미지"를 그대로 해주는 함수라 생성
// 단계의 효과 적용과 동일한 걸 재사용한다.
export async function editThumbnailImage(
  imageId: string,
  promptText: string
): Promise<{ error: string } | { success: true; url: string }> {
  const prompt = promptText.trim();
  if (!prompt) return { error: '수정할 내용을 입력해주세요.' };

  const supabase = createClient();
  const { data: img, error } = await supabase.from('thumbnail_images').select('*').eq('id', imageId).single();
  if (error || !img) return { error: error?.message || '이미지를 찾을 수 없어요.' };
  if (!img.output_image_url) return { error: '먼저 썸네일이 생성된 후에 수정할 수 있어요.' };

  // 스타일 적용 이미지(문구 합성 포함)는 완성본을 AI로 고치지 않고, 요청을 반영해 배경 사진부터 같은 컷/문구로 다시 만든다
  // (완성본 편집은 AI가 문구를 건드리거나 결과를 못 돌려주는 일이 잦고, 상품 외형 보존 규칙도 안 탄다).
  if (img.style_spec?.shot && img.input_image_url) {
    try {
      const src = await fetchImageFromUrl(img.input_image_url);
      const spec = img.style_spec as StyledSpec;
      const nextSpec: StyledSpec = { ...spec, note: [spec.note, prompt].filter(Boolean).join('\n') };
      await supabase.from('thumbnail_images').update({ style_spec: nextSpec }).eq('id', imageId);
      const r = await runStyledGeneration(supabase, imageId, img.project_id, src, nextSpec);
      if ('error' in r) return r;
      return { success: true, url: r.url };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  }

  try {
    const res = await fetch(img.output_image_url);
    if (!res.ok) return { error: `현재 이미지를 불러오지 못했어요 (HTTP ${res.status})` };
    const buffer = Buffer.from(await res.arrayBuffer());

    const { data: project } = await supabase
      .from('thumbnail_projects')
      .select('category')
      .eq('id', img.project_id)
      .maybeSingle();
    const referenceImages = project?.category ? await fetchTopSellerReferenceImages(project.category) : [];

    // 스타일 적용 이미지는 이미 한국어 문구가 들어 있어서 문구를 지우지 않게 하고, 원본 상품 사진을 같이 보여줘서
    // "롱양말로" 같은 외형 요청을 실제 상품 모습에 맞추게 한다.
    let productPhoto: { buffer: Buffer; mimeType: string } | null = null;
    if (img.input_image_url) {
      try {
        productPhoto = await fetchImageFromUrl(img.input_image_url);
      } catch {
        productPhoto = null;
      }
    }
    const opts = { preserveText: !!img.style_spec?.shot, productPhoto };
    let edited = await applyThumbnailEffect(buffer, prompt, referenceImages, opts);
    // 변화가 거의 없으면 한 번 더 분명하게 시도한다
    if (await isImageVisuallyUnchanged(buffer, edited)) {
      edited = await applyThumbnailEffect(buffer, prompt, referenceImages, { ...opts, insist: true });
    }

    if (await isImageVisuallyUnchanged(buffer, edited)) {
      return {
        error:
          'AI가 요청한 수정을 반영하지 못했어요 (이미지가 거의 그대로예요). 프롬프트를 더 구체적으로 적어서 다시 시도해주세요.',
      };
    }

    const outPath = `thumbnails/${img.project_id}/${imageId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, await enforceThumbnailSize(edited), {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    // 같은 경로에 덮어써서 URL 문자열은 그대로라, 캐시 때문에 수정된
    // 이미지가 화면에 바로 안 보일 수 있다 - 캐시 무효화용 쿼리를 붙인다.
    const outputUrl = `${supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl}?v=${Date.now()}`;

    const { error: updateErr } = await supabase
      .from('thumbnail_images')
      .update({ output_image_url: outputUrl, effect_prompt: prompt, error: null })
      .eq('id', imageId);
    if (updateErr) return { error: updateErr.message };

    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

// AI 효과 프롬프트로는 "상품 개수를 늘려달라" 같은 반복 패턴 연장
// 요청이 잘 안 먹혀서, 이미지 안의 한 구간(띠)을 그대로 복사해
// 다른 위치에 붙여넣는 결정적인 방법을 따로 둔다. AI를 안 거치고
// 픽셀을 그대로 복사하므로 스타일이 항상 100% 일치한다.
export async function duplicateThumbnailStrip(
  imageId: string,
  params: { sourceTopPct: number; sourceBottomPct: number; destTopPct: number }
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  const { data: img, error } = await supabase.from('thumbnail_images').select('*').eq('id', imageId).single();
  if (error || !img) return { error: error?.message || '이미지를 찾을 수 없어요.' };
  if (!img.output_image_url) return { error: '먼저 썸네일이 생성된 후에 복제할 수 있어요.' };

  try {
    const res = await fetch(img.output_image_url);
    if (!res.ok) return { error: `현재 이미지를 불러오지 못했어요 (HTTP ${res.status})` };
    const buffer = Buffer.from(await res.arrayBuffer());

    const edited = await duplicateImageStrip(buffer, params);

    const outPath = `thumbnails/${img.project_id}/${imageId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, await enforceThumbnailSize(edited), {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    const outputUrl = `${supabase.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl}?v=${Date.now()}`;

    const { error: updateErr } = await supabase
      .from('thumbnail_images')
      .update({ output_image_url: outputUrl, error: null })
      .eq('id', imageId);
    if (updateErr) return { error: updateErr.message };

    revalidatePath(PATH);
    return { success: true, url: outputUrl };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function deleteThumbnailImage(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('thumbnail_images').delete().eq('id', id);
  if (error) console.error('[thumbnails] deleteThumbnailImage 실패:', error.message);
  revalidatePath(PATH);
}

// 선택한 이미지를 한 번에 삭제 (화면에서 체크한 카드들). 한 번에 많이 지워도 되지만
// 실수로 다른 프로젝트 이미지가 섞여 들어오는 걸 막기 위해 projectId를 같이 받아
// 그 프로젝트 안의 이미지만 지운다.
export async function deleteThumbnailImages(
  projectId: string,
  ids: string[]
): Promise<{ error: string } | { success: true; deleted: number }> {
  const clean = Array.from(new Set((ids || []).filter((x) => typeof x === 'string' && x)));
  if (clean.length === 0) return { error: '삭제할 이미지를 선택해주세요.' };
  const supabase = createClient();
  const { data, error } = await supabase
    .from('thumbnail_images')
    .delete()
    .eq('project_id', projectId)
    .in('id', clean)
    .select('id');
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { success: true, deleted: (data || []).length };
}
