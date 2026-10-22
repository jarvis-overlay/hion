'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const PATH = '/dashboard/sourcing/list';
// 새 버킷을 또 만들지 않고 detail-images 버킷을 재사용한다 (이미
// allowed_users 쓰기 정책이 걸려 있음 - supabase/schema.sql 참고).
const BUCKET = 'detail-images';

function extFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

export async function addItemNote(
  entityType: string,
  entityId: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  const body = String(formData.get('body') || '').trim();
  const file = formData.get('image') as File | null;
  if (!body && (!file || file.size === 0)) {
    return { error: '메모 내용이나 사진 중 하나는 입력해주세요.' };
  }

  let imageUrl: string | null = null;
  if (file && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/jpeg';
    const path = `memo-notes/${entityType}/${entityId}/${Date.now()}.${extFromContentType(mimeType)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    imageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const { error } = await supabase.from('item_notes').insert({
    entity_type: entityType,
    entity_id: entityId,
    author_email: user.email,
    body: body || null,
    image_url: imageUrl,
  });
  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: true };
}

export async function deleteItemNote(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('item_notes').delete().eq('id', id);
  if (error) console.error('[item notes] 삭제 실패:', error.message);
  revalidatePath(PATH);
}
