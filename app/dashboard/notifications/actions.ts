'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { notifyAllRecipients } from '@/lib/kakao';
import { sendPushToAll } from '@/lib/webpush';
import { joinOwners, parseOwners } from '@/lib/pushOwners';

export async function disconnectKakaoRecipient(id: string) {
  const supabase = createClient();
  await supabase.from('kakao_notification_recipients').delete().eq('id', id);
  revalidatePath('/dashboard/notifications');
}

export async function sendTestKakaoNotification() {
  const supabase = createClient();
  const result = await notifyAllRecipients(
    supabase,
    '🔔 테스트 알림이에요. 이 메시지가 보이면 주문 알림도 정상적으로 올 거예요.'
  );
  return result;
}

// 알림을 받을 이메일(기기 주인)을 정한다. 비워두면 내 로그인 이메일, 적으면 그 이메일
// (다른 사람 이메일도 가능 - 허용 계정이 아니어도 됨, 형식만 확인한다).
async function resolveOwnerEmail(
  _supabase: ReturnType<typeof createClient>,
  loginEmail: string,
  requested: string | undefined
): Promise<{ email: string } | { error: string }> {
  const mine = loginEmail.toLowerCase();
  const want = (requested ?? '').trim().toLowerCase();
  if (!want || want === mine) return { email: mine };
  if (want.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(want)) {
    return { error: '이메일 형식이 올바르지 않아요.' };
  }
  return { email: want };
}

// 기기 주인(user_email)을 같이 저장한다 - 업무수첩 공유 알림처럼 특정 사람에게만
// 보내려면 필요하다. 브라우저 한 개는 구독 주소(endpoint)가 하나뿐이라 같은 기기를 다시
// 등록하면 "새 줄"이 아니라 기존 줄이 된다. 예전엔 이때 이름·이메일을 통째로 덮어써서
// 내 이메일이 다른 사람 걸로 바뀌었다 → 이제는 이미 등록된 기기면 이메일을 "추가"한다.
// user_email 컬럼/UPDATE 정책이 아직 DB에 없으면 저장이 실패하는데, 그렇다고 기존 푸시
// 등록 자체가 안 되면 안 되므로 주인 없이 한 번 더 저장해본다.
export async function savePushSubscription(
  label: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ownerEmail?: string
): Promise<
  { ok: true; ownerLinked: boolean; ownerEmail: string; owners: string[]; merged: boolean } | { ok: false; error: string }
> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: '로그인이 필요해요.' };

  const owner = await resolveOwnerEmail(supabase, user.email, ownerEmail);
  if ('error' in owner) return { ok: false, error: owner.error };

  const base = {
    label,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  };

  // 이미 등록된 기기인지 확인 → 그렇다면 이름은 그대로 두고 이메일만 추가한다
  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('id, label, user_email')
    .eq('endpoint', subscription.endpoint)
    .maybeSingle();
  if (existing) {
    const owners = parseOwners(joinOwners([...parseOwners((existing as any).user_email), owner.email]));
    const { data: updated, error: updError } = await supabase
      .from('push_subscriptions')
      .update({ p256dh: base.p256dh, auth: base.auth, user_email: owners.join(',') })
      .eq('id', (existing as any).id)
      .select('id');
    if (!updError && updated && updated.length > 0) {
      revalidatePath('/dashboard/notifications');
      return { ok: true, ownerLinked: true, ownerEmail: owner.email, owners, merged: true };
    }
    console.error('[push] 기존 기기에 이메일 추가 실패:', updError?.message || '변경된 행 없음');
    return { ok: false, error: '이미 등록된 기기에 이메일을 추가하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ ...base, user_email: owner.email }, { onConflict: 'endpoint' });

  let ownerLinked = true;
  if (error) {
    console.error('[push] 기기 주인 포함 저장 실패, 주인 없이 재시도:', error.message);
    const { error: fallbackError } = await supabase
      .from('push_subscriptions')
      .upsert(base, { onConflict: 'endpoint' });
    if (fallbackError) {
      console.error('[push] 기기 등록 실패:', fallbackError.message);
      return { ok: false, error: '기기를 등록하지 못했어요. 잠시 후 다시 시도해주세요.' };
    }
    ownerLinked = false;
  }

  revalidatePath('/dashboard/notifications');
  return { ok: true, ownerLinked, ownerEmail: owner.email, owners: [owner.email], merged: false };
}

// 이미 등록된 기기에 알림 받을 이메일을 추가한다(기기를 다시 등록할 필요 없음).
export async function addPushOwner(
  id: string,
  ownerEmail: string
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: '로그인이 필요해요.' };
  if (typeof id !== 'string' || !id) return { ok: false, error: '기기를 찾지 못했어요.' };

  const owner = await resolveOwnerEmail(supabase, user.email, ownerEmail || undefined);
  if ('error' in owner) return { ok: false, error: owner.error };

  const { data: row, error: readError } = await supabase
    .from('push_subscriptions')
    .select('user_email')
    .eq('id', id)
    .maybeSingle();
  if (readError || !row) return { ok: false, error: '기기를 찾지 못했어요. 새로고침 후 다시 시도해주세요.' };

  const owners = parseOwners(joinOwners([...parseOwners((row as any).user_email), owner.email]));
  const { data: updated, error } = await supabase
    .from('push_subscriptions')
    .update({ user_email: owners.join(',') })
    .eq('id', id)
    .select('id');
  if (error || !updated || updated.length === 0) {
    console.error('[push] 기기 이메일 추가 실패:', error?.message || '변경된 행 없음');
    return { ok: false, error: '이메일을 추가하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  revalidatePath('/dashboard/notifications');
  return { ok: true, email: owner.email };
}

// 기기에서 이메일 하나만 뺀다. 마지막 이메일을 빼면 기기 등록 자체를 지운다.
export async function removePushOwner(
  id: string,
  email: string
): Promise<{ ok: true; deleted: boolean } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: '로그인이 필요해요.' };
  if (typeof id !== 'string' || !id) return { ok: false, error: '기기를 찾지 못했어요.' };

  const { data: row, error: readError } = await supabase
    .from('push_subscriptions')
    .select('user_email')
    .eq('id', id)
    .maybeSingle();
  if (readError || !row) return { ok: false, error: '기기를 찾지 못했어요. 새로고침 후 다시 시도해주세요.' };

  const target = String(email || '').trim().toLowerCase();
  const rest = parseOwners((row as any).user_email).filter((e) => e !== target);
  if (rest.length === 0) {
    const { error } = await supabase.from('push_subscriptions').delete().eq('id', id);
    if (error) return { ok: false, error: '기기를 지우지 못했어요. 잠시 후 다시 시도해주세요.' };
    revalidatePath('/dashboard/notifications');
    return { ok: true, deleted: true };
  }
  const { data: updated, error } = await supabase
    .from('push_subscriptions')
    .update({ user_email: rest.join(',') })
    .eq('id', id)
    .select('id');
  if (error || !updated || updated.length === 0) {
    console.error('[push] 기기 이메일 제거 실패:', error?.message || '변경된 행 없음');
    return { ok: false, error: '이메일을 빼지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  revalidatePath('/dashboard/notifications');
  return { ok: true, deleted: false };
}

export async function deletePushSubscription(id: string) {
  const supabase = createClient();
  await supabase.from('push_subscriptions').delete().eq('id', id);
  revalidatePath('/dashboard/notifications');
}

export async function sendTestPushNotification() {
  const supabase = createClient();
  const result = await sendPushToAll(supabase, {
    title: '🔔 테스트 알림',
    body: '이 알림이 보이면 주문 푸시 알림도 정상적으로 올 거예요.',
  });
  return result;
}
