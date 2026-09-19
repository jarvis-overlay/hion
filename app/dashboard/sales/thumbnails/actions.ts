'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { generateThumbnailImage, type ThumbnailPosition } from '@/lib/imageProcessing';

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
  title: string
): Promise<{ error: string } | { success: true; id: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('thumbnail_projects')
    .insert({ title: title.trim() || null, author_email: user?.email })
    .select('id')
    .single();

  if (error || !data) return { error: error?.message || '프로젝트 생성에 실패했어요.' };
  revalidatePath(PATH);
  return { success: true, id: (data as { id: string }).id };
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
  if (!file || file.size === 0) return { error: '이미지를 첨부해주세요.' };

  const productPosition = (String(formData.get('productPosition') || 'center') as ThumbnailPosition) || 'center';
  const effectPrompt = String(formData.get('effectPrompt') || '').trim();

  if (kind === 'main') {
    await supabase.from('thumbnail_images').delete().eq('project_id', projectId).eq('kind', 'main');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'image/jpeg';
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
    const generated = await generateThumbnailImage({
      productImage,
      position,
      effectPrompt: effectPrompt || undefined,
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

export async function deleteThumbnailImage(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('thumbnail_images').delete().eq('id', id);
  if (error) console.error('[thumbnails] deleteThumbnailImage 실패:', error.message);
  revalidatePath(PATH);
}
