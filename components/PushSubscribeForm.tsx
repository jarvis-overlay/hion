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
  subscriptions: { id: string; label: string; created_at: string }[];
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
        await savePushSubscription(label.trim(), subscription.toJSON() as any);
        setStatus('✅ 이 기기에 등록됐어요.');
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
      setStatus(`전송 ${result.sent}건 성공, ${result.failed}건 실패`);
    });
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold mb-3">앱 푸시 알림 (이 기기 등록)</h2>
      <p className="text-xs text-inkSoft mb-3">
        안드로이드는 크롬에서, 아이폰은 Safari로 열어서 "홈 화면에 추가"로
        설치한 다음 여기서 등록하면 그 기기로 진짜 푸시 알림이 와요. 기기마다
        따로 등록해야 해요.
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
              <span>{s.label}</span>
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
      {status && <p className="text-xs mt-2 text-inkSoft">{status}</p>}
    </div>
  );
}
