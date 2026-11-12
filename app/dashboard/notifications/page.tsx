import { createClient } from '@/lib/supabase/server';
import KakaoConnectForm from '@/components/KakaoConnectForm';
import PushSubscribeForm from '@/components/PushSubscribeForm';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  const supabase = createClient();
  const { data: recipients } = await supabase
    .from('kakao_notification_recipients')
    .select('id, label, created_at')
    .eq('connected', true)
    .order('created_at');

  // user_email 컬럼(마이그레이션 20261112120000)이 아직 없으면 이 조회가
  // 실패하므로, 그 경우엔 예전처럼 컬럼 없이 다시 조회해서 목록이 사라지지 않게
  // 한다.
  let { data: subscriptions, error: subsError } = await supabase
    .from('push_subscriptions')
    .select('id, label, created_at, user_email')
    .order('created_at');
  if (subsError) {
    const fallback = await supabase
      .from('push_subscriptions')
      .select('id, label, created_at')
      .order('created_at');
    subscriptions = fallback.data as typeof subscriptions;
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">알림 설정</h1>
      <p className="text-sm text-inkSoft mb-5">
        새 주문이 들어오면 등록된 곳으로 알림을 보내드려요.
      </p>

      {searchParams.connected && (
        <p className="text-sm text-profit mb-4">✅ 카카오 연결 완료됐어요.</p>
      )}
      {searchParams.error && (
        <p className="text-sm text-red-700 mb-4">⚠️ {searchParams.error}</p>
      )}

      <div className="grid gap-5">
        <PushSubscribeForm subscriptions={subscriptions || []} />
        <KakaoConnectForm recipients={recipients || []} />
      </div>
    </div>
  );
}
