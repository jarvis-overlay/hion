'use client';

import { useState, useTransition } from 'react';
import { syncCoupangInventory } from '@/app/dashboard/inventory/channels/actions';

export default function CoupangSyncButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSync() {
    setMessage(null);
    startTransition(async () => {
      const result: any = await syncCoupangInventory();
      if (result.error) {
        setMessage(`⚠️ ${result.error}`);
      } else {
        setMessage(
          `재고 변경 ${result.updated ?? 0}건 · 판매기록 ${result.logged ?? 0}건 반영`
        );
      }
    });
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleSync}
          disabled={isPending}
          className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
        >
          {isPending ? '동기화 중...' : '⟳ 쿠팡 동기화'}
        </button>
        {message && (
          <span className="text-xs text-inkSoft whitespace-nowrap">
            {message}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="font-display font-bold mb-2">재고·판매 동기화 (쿠팡)</h3>
      <p className="text-xs text-inkSoft mb-3">
        쿠팡 로켓창고의 실제 재고와, 오늘 판매된 상품 내역을 함께 가져와요.{' '}
        <b>상품 관리</b>에서 쿠팡 옵션ID(vendorItemId)를 등록해둔 상품만
        동기화돼요.
      </p>
      <button
        onClick={handleSync}
        disabled={isPending}
        className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '동기화 중...' : '지금 동기화'}
      </button>
      {message && <p className="text-xs mt-3 text-inkSoft">{message}</p>}
    </div>
  );
}
