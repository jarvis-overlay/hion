'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { notifyAllRecipients } from '@/lib/kakao';

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
