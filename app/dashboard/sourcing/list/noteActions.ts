'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { sendPushToAll } from '@/lib/webpush';

const PATH = '/dashboard/sourcing/list';
// 새 버킷을 또 만들지 않고 detail-images 버킷을 재사용한다 (이미
// allowed_users 쓰기 정책이 걸려 있음 - supabase/schema.sql 참고).
const BUCKET = 'detail-images';

function extFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}

// 알림 메시지에 "어느 소싱 아이템/공급처에 남긴 메모인지"를 보여주기
// 위한 라벨. entity_type이 폴리모픽이라 각각 다른 테이블을 조회한다.
async function describeNoteEntity(
  supabase: ReturnType<typeof createClient>,
  entityType: string,
  entityId: string
): Promise<string> {
  if (entityType === 'sourcing_item') {
    const { data } = await supabase
      .from('sourcing_items')
      .select('title')
      .eq('id', entityId)
      .maybeSingle();
    return data?.title || '(이름 없는 소싱 아이템)';
  }
  if (entityType === 'supplier') {
    const { data } = await supabase
      .from('sourcing_item_suppliers')
      .select('title, sourcing_items(title)')
      .eq('id', entityId)
      .maybeSingle();
    const itemTitle = (data as any)?.sourcing_items?.title || '(상품 정보 없음)';
    const supplierTitle = (data as any)?.title || '(이름 없는 공급처)';
    return `${itemTitle} - 공급처 ${supplierTitle}`;
  }
  return entityType;
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

  const category = String(formData.get('category') || '').trim() || null;
  const pinned = formData.get('pinned') === 'true';

  const { error } = await supabase.from('item_notes').insert({
    entity_type: entityType,
    entity_id: entityId,
    author_email: user.email,
    body: body || null,
    image_url: imageUrl,
    category,
    pinned,
  });
  if (error) return { error: error.message };

  // 동업자와 같이 보는 메모라 새로 남기면 앱 푸시로 알려준다. 알림
  // 전송에 실패해도 메모 저장 자체는 이미 끝났으니 별도로 감싸서 영향
  // 안 주게 한다.
  try {
    const entityLabel = await describeNoteEntity(supabase, entityType, entityId);
    const preview = body ? (body.length > 200 ? body.slice(0, 200) + '...' : body) : '(사진만 첨부됨)';
    const prefix = `${pinned ? '📌 ' : ''}${category ? `[${category}] ` : ''}`;

    try {
      await sendPushToAll(supabase, {
        title: `📝 메모 추가: ${entityLabel}`,
        body: `${prefix}${preview}`,
        url: '/dashboard/sourcing/list',
      });
    } catch (e) {
      console.error('[item notes] 푸시 알림 전송 실패:', e);
    }
  } catch (e) {
    console.error('[item notes] 알림 준비 실패:', e);
  }

  revalidatePath(PATH);
  return { success: true };
}

// 기존 메모의 내용/카테고리/고정 여부/사진을 고친다. 사진은 1) 새
// 파일을 올리면 교체, 2) removeImage만 true면 제거, 3) 둘 다 없으면
// 기존 사진 그대로 유지 (update 페이로드에 image_url 키 자체를 안 넣어서
// Supabase가 건드리지 않게 함).
export async function updateItemNote(
  id: string,
  entityType: string,
  entityId: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();

  const body = String(formData.get('body') || '').trim();
  const file = formData.get('image') as File | null;
  const removeImage = formData.get('removeImage') === 'true';
  const category = String(formData.get('category') || '').trim() || null;
  const pinned = formData.get('pinned') === 'true';

  if (!body && removeImage && (!file || file.size === 0)) {
    return { error: '메모 내용이나 사진 중 하나는 남아있어야 해요.' };
  }

  const patch: Record<string, unknown> = { body: body || null, category, pinned };

  if (file && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/jpeg';
    const path = `memo-notes/${entityType}/${entityId}/${Date.now()}.${extFromContentType(mimeType)}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    patch.image_url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } else if (removeImage) {
    patch.image_url = null;
  }

  const { error } = await supabase.from('item_notes').update(patch).eq('id', id);
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

// 작성할 땐 평범한 메모였는데 나중에 "이게 결론이었구나" 싶을 때도
// 고정할 수 있도록 - 작성 시점의 고정 체크와 별개로 토글 가능해야 함.
export async function setItemNotePinned(id: string, pinned: boolean) {
  const supabase = createClient();
  const { error } = await supabase.from('item_notes').update({ pinned }).eq('id', id);
  if (error) console.error('[item notes] 고정 변경 실패:', error.message);
  revalidatePath(PATH);
}

// 메모 카테고리(가격/재고/품질 등)를 코드에 고정하지 않고 체크리스트
// 기본 항목처럼 화면에서 직접 추가/삭제할 수 있게 함 - 소싱마다 메모
// 내용 성격이 달라서(이 사용자는 발주 진행 위주) 고정된 분류가 안 맞을
// 수 있기 때문.
export async function addNoteCategory(label: string) {
  if (!label.trim()) return;
  const supabase = createClient();
  const { data: maxRow } = await supabase
    .from('item_note_categories')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? -1) + 1;
  const { error } = await supabase.from('item_note_categories').insert({
    label: label.trim(),
    position: nextPosition,
  });
  if (error) console.error('[item notes] 카테고리 추가 실패:', error.message);
  revalidatePath(PATH);
}

export async function deleteNoteCategory(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('item_note_categories').delete().eq('id', id);
  if (error) console.error('[item notes] 카테고리 삭제 실패:', error.message);
  revalidatePath(PATH);
}
