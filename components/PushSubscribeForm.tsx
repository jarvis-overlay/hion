'use client';

import { useState, useTransition } from 'react';
import {
  deletePushSubscription,
  savePushSubscription,
  sendTestPushNotification,
} from '@/app/dashboard/notifications/actions';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function PushSubscribeForm({
  subscriptions,
}: {
  subscriptions: { id: string; label: string; created_at: string; user_email?: string | null }[];
}) {
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setStatus(null);

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('⚠️ 이 브라우저는 푸시 알림을 지원 안 해요 (iOS는 Safari에서 홈 화면 추가 후 이용 가능).');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('⚠️ 알림 권한을 허용해주셔야 등록할 수 있어요.');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setStatus('⚠️ 서버에 VAPID 키 설정이 안 되어있어요.');
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      startTransition(async () => {
        const res = await savePushSubscription(label.trim(), subscription.toJSON() as any);
        if (!res || !res.ok) {
          setStatus(`⚠️ ${res?.error || '등록하지 못했어요. 잠시 후 다시 시도해주세요.'}`);
          return;
        }
        setStatus(
          res.ownerLinked
            ? '✅ 이 기기에 등록됐어요. 업무수첩 공유 알림도 이 기기로 와요.'
            : '✅ 이 기기에 등록됐어요. (다만 기기 주인 정보는 아직 저장하지 못해서, 업무수첩 공유 알림은 관리자가 DB 설정을 마친 뒤 다시 등록해야 와요.)'
        );
        setLabel('');
      });
    } catch (e: any) {
      setStatus(`⚠️ 등록 실패: ${e?.message || String(e)}`);
    }
  }

  function handleTest() {
    setStatus(null);
    startTransition(async () => {
      const result = await sendTestPushNotification();
      const lines = [`전송 ${result.sent}건 성공, ${result.failed}건 실패`, ...(result.details || [])];
      setStatus(lines.join('\n'));
    });
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold mb-3">앱 푸시 알림 (이 기기 등록)</h2>
      <p className="text-xs text-inkSoft mb-3">
        안드로이드는 크롬에서, 아이폰은 Safari로 열어서 "홈 화면에 추가"로
        설치한 다음 여기서 등록하면 그 기기로 진짜 푸시 알림이 와요. 기기마다
        따로 등록해야 해요. 업무수첩을 공유받으면 로그인한 계정으로 등록된
        기기에만 알림이 가요.
      </p>
      <form onSubmit={handleSubscribe} className="flex gap-2 mb-5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="이 기기 이름 (예: 사장님 폰)"
          className="border border-paperLine bg-white px-3 py-2 text-sm flex-1"
        />
        <button
          type="submit"
          disabled={!label.trim() || isPending}
          className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          이 기기 등록하기
        </button>
      </form>

      <div className="grid gap-2 mb-5">
        {subscriptions.length ? (
          subscriptions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between px-3 py-2 border border-paperLine rounded-lg text-sm"
            >
              <span className="min-w-0">
                {s.label}
                <span className="block text-[11px] text-inkSoft truncate">
                  {s.user_email
                    ? s.user_email
                    : '주인 미지정 - 이 기기에서 "이 기기 등록하기"를 다시 누르면 연결돼요'}
                </span>
              </span>
              <button
                onClick={() => startTransition(() => deletePushSubscription(s.id))}
                disabled={isPending}
                className="text-xs text-inkSoft hover:text-red-700"
              >
                등록 해제
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-inkSoft">아직 등록된 기기가 없어요.</p>
        )}
      </div>

      {subscriptions.length > 0 && (
        <button
          onClick={handleTest}
          disabled={isPending}
          className="px-4 py-2 text-sm font-semibold rounded-lg border border-paperLine hover:bg-paper/60 disabled:opacity-50"
        >
          {isPending ? '전송 중...' : '테스트 푸시 보내기'}
        </button>
      )}
      {status && <p className="text-xs mt-2 text-inkSoft whitespace-pre-wrap break-all">{status}</p>}
    </div>
  );
}
