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

export async function savePushSubscription(
  label: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
  const supabase = createClient();
  await supabase.from('push_subscriptions').upsert(
    {
      label,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: 'endpoint' }
  );
  revalidatePath('/dashboard/notifications');
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
