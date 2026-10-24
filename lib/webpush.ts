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
// details에는 기기별로 실제 푸시 서비스(애플/구글)가 응답한 상태코드를
// 남긴다 - "성공"이어도 기기에 실제로 안 뜨는 경우를 진단하기 위함
// (web-push는 푸시 서비스가 메시지를 "접수"만 해도 성공 처리하므로,
// 상태코드 자체를 보는 게 유일한 단서다).
export async function sendPushToAll(
  supabase: any,
  payload: { title: string; body: string; url?: string }
): Promise<{ sent: number; failed: number; details: string[] }> {
  ensureConfigured();

  const { data: subs } = await supabase.from('push_subscriptions').select('*');

  let sent = 0;
  let failed = 0;
  const details: string[] = [];

  for (const sub of subs || []) {
    const label = sub.label || '(이름 없음)';
    let host = '';
    try {
      host = new URL(sub.endpoint).host;
    } catch {
      host = '(endpoint 파싱 실패)';
    }

    try {
      const res = await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      );
      sent++;
      details.push(`${label} (${host}): 성공 - status ${res.statusCode}`);
    } catch (e: any) {
      failed++;
      details.push(
        `${label} (${host}): 실패 - status ${e?.statusCode ?? '?'} ${e?.body ? `- ${e.body}` : e?.message || ''}`
      );
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }

  return { sent, failed, details };
}
