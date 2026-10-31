'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  generateThumbnailImage,
  applyThumbnailEffect,
  isImageVisuallyUnchanged,
  duplicateImageStrip,
  fetchImageFromUrl,
  fetchTopSellerReferenceImages,
  describeProductAppearance,
  type ThumbnailPosition,
} from '@/lib/imageProcessing';
import { generateThumbnailCopies, sanitizeThumbnailCopy } from '@/lib/ai';
import {
  learnStyleBrief,
  generateStyledAdditionalImage,
  STYLE_BRIEF_TTL_MS,
  type StyleBrief,
  type StyleShot,
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

// URL(또는 파일) 하나만 넣으면 메인 썸네일 1장 + 추가 이미지 3~7장을
// 한 번에 만들어달라는 요청 - 매번 "+ 행 추가"로 한 장씩 URL/효과를
// 입력하지 않아도 되게, 같은 원본 사진을 위치/효과 프리셋을 돌려가며
// 자동으로 여러 장 생성한다.
const BATCH_EFFECT_PRESETS = [
  '제품을 강조하는 깔끔한 그림자와 은은한 조명 효과를 추가해줘',
  '배경에 입체감 있는 반사광과 하이라이트를 추가해줘',
  '고급스러운 느낌의 은은한 그라데이션 포인트를 배경에 추가해줘',
  '제품 주변에 부드러운 반사광을 추가해서 프리미엄 느낌을 줘',
  '따뜻한 느낌의 조명과 약간의 입체 그림자를 추가해줘',
  '시원한 느낌의 블루톤 포인트 조명을 배경에 추가해줘',
  '제품이 돋보이도록 배경에 은은한 서클 조명 효과를 추가해줘',
];
const BATCH_POSITION_CYCLE: ThumbnailPosition[] = ['center', 'left', 'right', 'top', 'bottom'];

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
): Promise<{ error: string } | { success: true; sourceCount: number; warning: string | null }> {
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
    });
    const outPath = `thumbnails/${projectId}/${imageId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, generated, {
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

// 추가 이미지를 count장 만든다: 컷은 학습된 스타일의 컷 목록을 순서대로(모자라면
// 반복), 원본 사진은 여러 장이면 돌려가며 쓴다. 이미지 생성 호출은 3개씩 동시에.
async function generateStyledAdditionals(
  supabase: ReturnType<typeof createClient>,
  args: {
    projectId: string;
    productName: string;
    category: string;
    brief: StyleBrief;
    sources: { buffer: Buffer; mimeType: string }[];
    count: number;
    colorLabel: string | null;
    startIndex: number;
  }
): Promise<{ ok: number; total: number; copyMissing: boolean; firstError: string | null }> {
  const { brief, sources, count } = args;
  const shots: StyleShot[] = Array.from({ length: count }, (_, i) => brief.shots[i % brief.shots.length]);

  // 컷별 한국어 문구 (실패하면 문구 없이 이미지만 만든다)
  const copyByShot = new Map<string, ShotCopyText>();
  const uniqueShots = brief.shots.slice(0, Math.min(count, brief.shots.length));
  try {
    const copies = await generateThumbnailCopies({
      productName: args.productName,
      category: args.category,
      sellingPoints: brief.sellingPoints,
      shots: uniqueShots.map((s) => ({ id: s.id, title: s.title })),
    });
    for (const c of copies) {
      const shot = uniqueShots.find((s) => s.id === c.shotId);
      if (shot) copyByShot.set(shot.id, sanitizeThumbnailCopy(c, shot.title));
    }
  } catch (e) {
    console.error('[thumbnails] 컷 문구 생성 실패:', e);
  }

  // 원본 사진마다 외형 명세를 한 번만 뽑아서 같은 사진으로 만드는 컷들이 공유한다
  const appearanceSpecs = await Promise.all(sources.map((s) => describeProductAppearance(s)));

  const results = await mapLimit(shots, 3, async (shot, i) => {
    const srcIdx = i % sources.length;
    const spec: StyledSpec = {
      shot,
      copy: copyByShot.get(shot.id) ?? null,
      brief: { background: brief.background, props: brief.props, lighting: brief.lighting },
    };
    return insertAndGenerateStyled(
      supabase,
      args.projectId,
      args.startIndex + i,
      sources[srcIdx],
      spec,
      args.colorLabel,
      appearanceSpecs[srcIdx]
    );
  });

  const failed = results.find((r): r is { error: string } => 'error' in r);
  return {
    ok: results.filter((r) => !('error' in r)).length,
    total: count,
    copyMissing: copyByShot.size === 0,
    firstError: failed ? failed.error : null,
  };
}

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
      // 인기상품 스타일을 적용했는지, 그리고 화면에 같이 알려줄 안내 문구들
      styledApplied: boolean;
      styleSourceCount: number;
      notes: string[];
    }
> {
  const supabase = createClient();
  const rawFiles = formData.getAll('images');
  const rawLabels = formData.getAll('colorLabels');
  const filePairs = rawFiles
    .map((f, i) => ({ file: f, colorLabel: String(rawLabels[i] || '').trim() || null }))
    .filter((p): p is { file: File; colorLabel: string | null } => p.file instanceof File && p.file.size > 0);
  const imageUrl = String(formData.get('imageUrl') || '').trim();
  if (filePairs.length === 0 && !imageUrl) return { error: '이미지를 첨부하거나 이미지 URL을 입력해주세요.' };

  let additionalCount = Number(formData.get('additionalCount') || 5);
  if (!Number.isFinite(additionalCount)) additionalCount = 5;
  additionalCount = Math.max(3, Math.min(7, Math.round(additionalCount)));

  // 카테고리가 설정돼 있으면 쿠팡 인기상품 스타일을 학습(또는 저장된 것 재사용)해서
  // 추가 이미지에 적용한다. 학습이 실패해도 기존 방식으로 계속 만들어서 일괄생성
  // 자체가 막히지는 않게 하고, 왜 기본 방식이 됐는지 화면에 안내한다.
  const { data: projectRow } = await supabase
    .from('thumbnail_projects')
    .select('title, category')
    .eq('id', projectId)
    .maybeSingle();
  const category = (projectRow?.category || '').trim();
  const productName = (projectRow?.title || '').trim() || category;
  const notes: string[] = [];
  let style: { brief: StyleBrief; sourceCount: number } | null = null;
  if (category) {
    try {
      const learned = await getOrLearnBrief(supabase, category);
      style = { brief: learned.brief, sourceCount: learned.sourceCount };
      if (learned.saveWarning) {
        notes.push(
          `학습한 스타일을 저장하지 못했어요(${learned.saveWarning}). supabase/thumbnail_style_learning.sql을 실행하면 다음부터 재사용돼요.`
        );
      }
    } catch (e: any) {
      notes.push(`인기상품 스타일 학습에 실패해서 기본 방식(누끼)으로 만들었어요: ${e?.message || String(e)}`);
    }
  } else {
    notes.push('카테고리를 설정하면 쿠팡 인기상품 스타일로 추가 이미지를 만들어요. 이번에는 기본 방식(누끼)으로 만들었어요.');
  }

  const { count: existingCount } = await supabase
    .from('thumbnail_images')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('kind', 'additional');
  let baseIndex = existingCount || 0;

  // 1688 소싱 확장프로그램 등으로 실제 상품 사진을 여러 장 한 번에
  // 받아온 경우 - 사진마다 이미 서로 다른 실제 컷이라 효과를 합성해
  // "변형"을 만들 필요가 없다. 색상 라벨이 같은 사진끼리 그룹으로 묶어
  // 그룹별로 "첫 장 = 그 색상의 메인, 나머지 = 그 색상의 추가 이미지"로
  // 완전히 별도 세트를 만든다("색상마다 완전히 별도 세트로 생성해달라"는
  // 요청). 라벨을 안 붙이면 전체가 하나의 그룹으로 묶여 기존과 동일하게
  // 동작한다.
  if (filePairs.length > 1) {
    const sources = await Promise.all(
      filePairs.map(async (p) => ({
        buffer: Buffer.from(await p.file.arrayBuffer()),
        mimeType: p.file.type || 'image/jpeg',
        colorLabel: p.colorLabel,
      }))
    );

    const groups = new Map<string | null, typeof sources>();
    for (const s of sources) {
      if (!groups.has(s.colorLabel)) groups.set(s.colorLabel, []);
      groups.get(s.colorLabel)!.push(s);
    }

    let mainOk = 0;
    let additionalOk = 0;
    let additionalTotal = 0;
    for (const [colorLabel, groupSources] of groups) {
      // 이 색상의 기존 메인만 지우고 다른 색상의 메인은 그대로 둔다.
      let delQuery = supabase.from('thumbnail_images').delete().eq('project_id', projectId).eq('kind', 'main');
      delQuery = colorLabel ? delQuery.eq('color_label', colorLabel) : delQuery.is('color_label', null);
      await delQuery;

      const mainResult = await insertAndGenerateImage(
        supabase, projectId, 'main', 0, groupSources[0], 'center', '', colorLabel
      );
      if (!('error' in mainResult)) mainOk++;

      if (style) {
        // 그 색상의 사진들을 돌려가며 학습된 컷 구성으로 추가 이미지를 새로 만든다
        const styled = await generateStyledAdditionals(supabase, {
          projectId,
          productName,
          category,
          brief: style.brief,
          sources: groupSources,
          count: additionalCount,
          colorLabel,
          startIndex: baseIndex,
        });
        baseIndex += additionalCount;
        additionalTotal += styled.total;
        additionalOk += styled.ok;
        if (styled.copyMissing) notes.push('문구 생성에 실패해서 일부 이미지는 문구 없이 만들었어요.');
        if (styled.ok < styled.total && styled.firstError) notes.push(`일부 이미지 생성 실패: ${styled.firstError}`);
      } else {
        for (let i = 1; i < groupSources.length; i++) {
          additionalTotal++;
          const res = await insertAndGenerateImage(
            supabase, projectId, 'additional', baseIndex++, groupSources[i], 'center', '', colorLabel
          );
          if (!('error' in res)) additionalOk++;
        }
      }
    }
    revalidatePath(PATH);
    return {
      success: true,
      mainOk,
      mainTotal: groups.size,
      additionalOk,
      additionalTotal,
      colorGroups: groups.size,
      styledApplied: !!style,
      styleSourceCount: style?.sourceCount ?? 0,
      notes: Array.from(new Set(notes)),
    };
  }

  // 사진 1장 또는 URL 1개만 있는 경우 - 위치·효과 프리셋을 자동으로
  // 돌려가며 하나의 원본으로 추가 이미지 3~7장을 합성해서 만든다.
  await supabase.from('thumbnail_images').delete().eq('project_id', projectId).eq('kind', 'main').is('color_label', null);

  let buffer: Buffer;
  let mimeType: string;
  if (filePairs.length === 1) {
    buffer = Buffer.from(await filePairs[0].file.arrayBuffer());
    mimeType = filePairs[0].file.type || 'image/jpeg';
  } else {
    try {
      const fetched = await fetchImageFromUrl(imageUrl);
      buffer = fetched.buffer;
      mimeType = fetched.mimeType;
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  }

  const mainResult = await insertAndGenerateImage(supabase, projectId, 'main', 0, { buffer, mimeType }, 'center', '');
  const mainOk = !('error' in mainResult) ? 1 : 0;

  let additionalOk = 0;
  if (style) {
    const styled = await generateStyledAdditionals(supabase, {
      projectId,
      productName,
      category,
      brief: style.brief,
      sources: [{ buffer, mimeType }],
      count: additionalCount,
      colorLabel: null,
      startIndex: baseIndex,
    });
    additionalOk = styled.ok;
    if (styled.copyMissing) notes.push('문구 생성에 실패해서 일부 이미지는 문구 없이 만들었어요.');
    if (styled.ok < styled.total && styled.firstError) notes.push(`일부 이미지 생성 실패: ${styled.firstError}`);
  } else {
    for (let i = 0; i < additionalCount; i++) {
      const position = BATCH_POSITION_CYCLE[i % BATCH_POSITION_CYCLE.length];
      const effectPrompt = BATCH_EFFECT_PRESETS[i % BATCH_EFFECT_PRESETS.length];
      const res = await insertAndGenerateImage(supabase, projectId, 'additional', baseIndex + i, { buffer, mimeType }, position, effectPrompt);
      if (!('error' in res)) additionalOk++;
    }
  }

  revalidatePath(PATH);
  return {
    success: true,
    mainOk,
    mainTotal: 1,
    additionalOk,
    additionalTotal: additionalCount,
    colorGroups: 1,
    styledApplied: !!style,
    styleSourceCount: style?.sourceCount ?? 0,
    notes: Array.from(new Set(notes)),
  };
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
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, generated, {
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

    const edited = await applyThumbnailEffect(buffer, prompt, referenceImages);

    if (await isImageVisuallyUnchanged(buffer, edited)) {
      return {
        error:
          'AI가 요청한 수정을 반영하지 못했어요 (이미지가 거의 그대로예요). 프롬프트를 더 구체적으로 적어서 다시 시도해주세요.',
      };
    }

    const outPath = `thumbnails/${img.project_id}/${imageId}-output.jpg`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, edited, {
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
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(outPath, edited, {
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
