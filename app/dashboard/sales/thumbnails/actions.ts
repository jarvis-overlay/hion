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
  type ThumbnailPosition,
} from '@/lib/imageProcessing';

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
