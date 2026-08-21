// 카카오 "나에게 보내기" API로 새 주문 발생 시 등록된 사람들에게 각자
// 카카오톡(나와의 채팅)으로 알림을 보내기 위한 클라이언트.
// - 카카오 로그인(OAuth)으로 각 사람의 access/refresh 토큰을 한 번 받아서
//   DB(kakao_notification_recipients)에 저장해두고, 이후 알림 보낼 때마다
//   그 토큰으로 memo API를 호출한다.
// - 비즈 앱 검수를 안 받은 앱이라 카카오 개발자센터에 "팀원"으로 등록된
//   계정만 로그인/메시지 전송이 가능하다.

const APP_URL = 'https://hion.vercel.app';
export const KAKAO_REDIRECT_URI = `${APP_URL}/api/kakao/callback`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 환경변수가 설정 안 되어있어요.`);
  return v;
}

export function buildKakaoAuthUrl(label: string): string {
  const clientId = requireEnv('KAKAO_REST_API_KEY');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: KAKAO_REDIRECT_URI,
    response_type: 'code',
    scope: 'talk_message',
    state: label,
  });
  return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeKakaoCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: requireEnv('KAKAO_REST_API_KEY'),
    client_secret: requireEnv('KAKAO_CLIENT_SECRET'),
    redirect_uri: KAKAO_REDIRECT_URI,
    code,
  });

  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error_description || '카카오 토큰 발급 실패');
  }
  return json;
}

async function refreshKakaoToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: requireEnv('KAKAO_REST_API_KEY'),
    client_secret: requireEnv('KAKAO_CLIENT_SECRET'),
    refresh_token: refreshToken,
  });

  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error_description || '카카오 토큰 갱신 실패');
  }
  return json;
}

export async function fetchKakaoUserId(accessToken: string): Promise<string> {
  const res = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.msg || '카카오 사용자 정보 조회 실패');
  }
  return String(json.id);
}

async function sendKakaoMemoToSelf(accessToken: string, text: string) {
  const templateObject = {
    object_type: 'text',
    text,
    link: {
      web_url: APP_URL,
      mobile_web_url: APP_URL,
    },
  };

  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    }).toString(),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.msg || `카카오 메시지 전송 실패 (HTTP ${res.status})`);
  }
}

// 등록된 모든 수신자에게 알림을 보낸다. 토큰이 곧 만료되거나 이미
// 만료됐으면 먼저 갱신하고 DB에 반영한다. 한 명 실패해도 나머지는 계속
// 시도한다.
export async function notifyAllRecipients(
  supabase: any,
  text: string
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const { data: recipients } = await supabase
    .from('kakao_notification_recipients')
    .select('*')
    .eq('connected', true);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const r of recipients || []) {
    try {
      let accessToken = r.access_token;
      const expiresAt = new Date(r.token_expires_at).getTime();
      // 5분 이내 만료 예정이면 미리 갱신
      if (expiresAt - Date.now() < 5 * 60 * 1000) {
        const refreshed = await refreshKakaoToken(r.refresh_token);
        accessToken = refreshed.access_token;
        await supabase
          .from('kakao_notification_recipients')
          .update({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token || r.refresh_token,
            token_expires_at: new Date(
              Date.now() + refreshed.expires_in * 1000
            ).toISOString(),
          })
          .eq('id', r.id);
      }

      await sendKakaoMemoToSelf(accessToken, text);
      sent++;
    } catch (e: any) {
      failed++;
      errors.push(`${r.label}: ${e?.message || String(e)}`);
    }
  }

  return { sent, failed, errors };
}
