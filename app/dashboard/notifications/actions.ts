'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { notifyAllRecipients } from '@/lib/kakao';
import { sendPushToAll } from '@/lib/webpush';

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

// 기기 주인(user_email)을 같이 저장한다 - 업무수첩 공유 알림처럼 특정
// 사람에게만 보내려면 필요하다. user_email 컬럼/UPDATE 정책이 아직 DB에 없으면
// (마이그레이션 20261112120000 실행 전) 저장이 실패하는데, 그렇다고 기존 푸시
// 등록 자체가 안 되면 안 되므로 주인 없이 한 번 더 저장해본다.
export async function savePushSubscription(
  label: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<{ ok: true; ownerLinked: boolean } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: '로그인이 필요해요.' };

  const base = {
    label,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  };

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ ...base, user_email: user.email.toLowerCase() }, { onConflict: 'endpoint' });

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
  return { ok: true, ownerLinked };
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
