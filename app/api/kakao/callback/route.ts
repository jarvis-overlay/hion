import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { exchangeKakaoCode, fetchKakaoUserId } from '@/lib/kakao';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const label = searchParams.get('state') || '이름 미입력';
  const kakaoError = searchParams.get('error');

  const redirectBase = '/dashboard/notifications';

  if (kakaoError || !code) {
    return NextResponse.redirect(
      new URL(`${redirectBase}?error=${encodeURIComponent(kakaoError || '인증 코드 없음')}`, request.url)
    );
  }

  try {
    const tokens = await exchangeKakaoCode(code);
    const kakaoUserId = await fetchKakaoUserId(tokens.access_token);

    const supabase = createAdminClient();
    await supabase.from('kakao_notification_recipients').upsert(
      {
        label,
        kakao_user_id: kakaoUserId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        connected: true,
      },
      { onConflict: 'kakao_user_id' }
    );

    return NextResponse.redirect(new URL(`${redirectBase}?connected=1`, request.url));
  } catch (e: any) {
    return NextResponse.redirect(
      new URL(`${redirectBase}?error=${encodeURIComponent(e?.message || String(e))}`, request.url)
    );
  }
}
