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

type PushPayload = { title: string; body: string; url?: string };
type PushResult = { sent: number; failed: number; details: string[] };

// 구독 목록을 돌면서 실제로 보낸다. 구독이 만료/취소된 기기(410/404)는
// DB에서 자동으로 지운다. 한 기기 실패해도 나머지는 계속 보낸다.
// details에는 기기별로 실제 푸시 서비스(애플/구글)가 응답한 상태코드를
// 남긴다 - "성공"이어도 기기에 실제로 안 뜨는 경우를 진단하기 위함
// (web-push는 푸시 서비스가 메시지를 "접수"만 해도 성공 처리하므로,
// 상태코드 자체를 보는 게 유일한 단서다).
async function sendToSubscriptions(
  supabase: any,
  subs: any[],
  payload: PushPayload
): Promise<PushResult> {
  let sent = 0;
  let failed = 0;
  const details: string[] = [];

  for (const sub of subs) {
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

// 등록된 모든 기기로 푸시를 보낸다.
export async function sendPushToAll(supabase: any, payload: PushPayload): Promise<PushResult> {
  ensureConfigured();
  const { data: subs } = await supabase.from('push_subscriptions').select('*');
  return sendToSubscriptions(supabase, subs || [], payload);
}

// 특정 사람(이메일)이 등록한 기기로만 푸시를 보낸다(user_email은 소문자로
// 저장됨). 업무수첩 공유처럼 "그 사람에게만" 알려야 할 때 쓴다. 그 사람 이름으로 등록된 기기가 없으면
// sent/failed 모두 0이고 noDevice가 true다 - 호출한 쪽이 "상대가 아직 앱
// 알림을 등록 안 했다"고 안내할 수 있게 한다. 조회 자체가 실패하면(예: 마이그
// 레이션 전이라 user_email 컬럼이 없음) 던지지 않고 queryError에 담아 돌려준다.
export async function sendPushToEmail(
  supabase: any,
  email: string,
  payload: PushPayload
): Promise<PushResult & { noDevice: boolean; queryError: string | null }> {
  ensureConfigured();
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_email', email.toLowerCase());
  if (error) {
    return { sent: 0, failed: 0, details: [], noDevice: false, queryError: error.message };
  }
  if (!subs || subs.length === 0) {
    return { sent: 0, failed: 0, details: [], noDevice: true, queryError: null };
  }
  const result = await sendToSubscriptions(supabase, subs, payload);
  return { ...result, noDevice: false, queryError: null };
}
