'use client';

import { useState, useTransition } from 'react';
import {
  disconnectKakaoRecipient,
  sendTestKakaoNotification,
} from '@/app/dashboard/notifications/actions';

export default function KakaoConnectForm({
  recipients,
}: {
  recipients: { id: string; label: string; created_at: string }[];
}) {
  const [label, setLabel] = useState('');
  const [isPending, startTransition] = useTransition();
  const [testMessage, setTestMessage] = useState<string | null>(null);

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    window.location.href = `/api/kakao/start?label=${encodeURIComponent(label.trim())}`;
  }

  function handleTest() {
    setTestMessage(null);
    startTransition(async () => {
      const result = await sendTestKakaoNotification();
      setTestMessage(
        `전송 ${result.sent}건 성공, ${result.failed}건 실패${
          result.errors.length ? ` (${result.errors.join(', ')})` : ''
        }`
      );
    });
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold mb-3">카카오톡 알림 받을 사람 추가</h2>
      <form onSubmit={handleConnect} className="flex gap-2 mb-5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="이름 (예: 사장님, 매니저)"
          className="border border-paperLine bg-white px-3 py-2 text-sm flex-1"
        />
        <button
          type="submit"
          disabled={!label.trim()}
          className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          카카오로 연결하기
        </button>
      </form>

      <div className="grid gap-2 mb-5">
        {recipients.length ? (
          recipients.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between px-3 py-2 border border-paperLine rounded-lg text-sm"
            >
              <span>{r.label}</span>
              <button
                onClick={() => startTransition(() => disconnectKakaoRecipient(r.id))}
                disabled={isPending}
                className="text-xs text-inkSoft hover:text-red-700"
              >
                연결 해제
              </button>
            </div>
          ))
        ) : (
          <p className="text-sm text-inkSoft">
            아직 연결된 사람이 없어요. 위에서 이름 입력하고 카카오로 연결해주세요.
          </p>
        )}
      </div>

      {recipients.length > 0 && (
        <button
          onClick={handleTest}
          disabled={isPending}
          className="px-4 py-2 text-sm font-semibold rounded-lg border border-paperLine hover:bg-paper/60 disabled:opacity-50"
        >
          {isPending ? '전송 중...' : '테스트 알림 보내기'}
        </button>
      )}
      {testMessage && <p className="text-xs mt-2 text-inkSoft">{testMessage}</p>}
    </div>
  );
}
