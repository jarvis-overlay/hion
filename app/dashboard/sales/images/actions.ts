'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  detectAndTranslateText,
  compositeTranslatedImage,
  removeImageBackground,
  resizeForCoupang,
} from '@/lib/imageProcessing';

const BUCKET = 'detail-images';

function extFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

async function fetchImageBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지를 불러오지 못했어요 (HTTP ${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

async function uploadResult(
  supabase: ReturnType<typeof createClient>,
  sourcingItemId: string,
  imageId: string,
  suffix: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const path = `${sourcingItemId}/${imageId}-${suffix}.${extFromContentType(contentType)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// 원본 이미지를 등록 - 파일 업로드 또는 이미지 URL(1688 등) 둘 다 받는다.
export async function addSourceImage(
  sourcingItemId: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();

  const file = formData.get('file') as File | null;
  const url = String(formData.get('url') || '').trim();

  let buffer: Buffer;
  let contentType: string;

  try {
    if (file && file.size > 0) {
      buffer = Buffer.from(await file.arrayBuffer());
      contentType = file.type || 'image/jpeg';
    } else if (url) {
      const fetched = await fetchImageBuffer(url);
      buffer = fetched.buffer;
      contentType = fetched.contentType;
    } else {
      return { error: '파일을 선택하거나 이미지 URL을 입력해주세요.' };
    }
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  const id = randomUUID();
  let originalUrl: string;
  try {
    originalUrl = await uploadResult(supabase, sourcingItemId, id, 'original', buffer, contentType);
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  const { error } = await supabase
    .from('sourcing_item_images')
    .insert({ id, sourcing_item_id: sourcingItemId, original_url: originalUrl });
  if (error) return { error: error.message };

  revalidatePath('/dashboard/sales/images');
  return { success: true };
}

async function getImage(supabase: ReturnType<typeof createClient>, imageId: string) {
  const { data, error } = await supabase.from('sourcing_item_images').select('*').eq('id', imageId).single();
  if (error || !data) throw new Error(error?.message || '이미지를 찾을 수 없어요.');
  return data as { id: string; sourcing_item_id: string; original_url: string };
}

export async function runTranslate(imageId: string): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  try {
    const img = await getImage(supabase, imageId);
    const { buffer, contentType } = await fetchImageBuffer(img.original_url);
    const regions = await detectAndTranslateText(buffer, contentType);
    const composited = await compositeTranslatedImage(buffer, regions);
    const url = await uploadResult(supabase, img.sourcing_item_id, imageId, 'translated', composited, 'image/png');
    const { error } = await supabase.from('sourcing_item_images').update({ translated_url: url }).eq('id', imageId);
    if (error) return { error: error.message };
    revalidatePath('/dashboard/sales/images');
    return { success: true, url };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runRemoveBackground(
  imageId: string
): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  try {
    const img = await getImage(supabase, imageId);
    const cutout = await removeImageBackground(img.original_url);
    const url = await uploadResult(supabase, img.sourcing_item_id, imageId, 'cutout', cutout, 'image/png');
    const { error } = await supabase.from('sourcing_item_images').update({ cutout_url: url }).eq('id', imageId);
    if (error) return { error: error.message };
    revalidatePath('/dashboard/sales/images');
    return { success: true, url };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runResize(imageId: string): Promise<{ error: string } | { success: true; url: string }> {
  const supabase = createClient();
  try {
    const img = await getImage(supabase, imageId);
    const { buffer } = await fetchImageBuffer(img.original_url);
    const resized = await resizeForCoupang(buffer);
    const url = await uploadResult(supabase, img.sourcing_item_id, imageId, 'resized', resized, 'image/jpeg');
    const { error } = await supabase.from('sourcing_item_images').update({ resized_url: url }).eq('id', imageId);
    if (error) return { error: error.message };
    revalidatePath('/dashboard/sales/images');
    return { success: true, url };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function deleteSourcingImage(imageId: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_images').delete().eq('id', imageId);
  if (error) console.error('[images] deleteSourcingImage 실패:', error.message);
  revalidatePath('/dashboard/sales/images');
}
