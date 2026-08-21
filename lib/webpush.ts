import webpush from 'web-push';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error('VAPID 키 환경변수가 설정 안 되어있어요.');
  }
  webpush.setVapidDetails('mailto:admin@hion.vercel.app', publicKey, privateKey);
  configured = true;
}

// 등록된 모든 기기로 푸시를 보낸다. 구독이 만료/취소된 기기(410/404)는
// DB에서 자동으로 지운다. 한 기기 실패해도 나머지는 계속 보낸다.
export async function sendPushToAll(
  supabase: any,
  payload: { title: string; body: string; url?: string }
): Promise<{ sent: number; failed: number }> {
  ensureConfigured();

  const { data: subs } = await supabase.from('push_subscriptions').select('*');

  let sent = 0;
  let failed = 0;

  for (const sub of subs || []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e: any) {
      failed++;
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }

  return { sent, failed };
}
