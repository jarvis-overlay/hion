'use client';

import { useState, useTransition } from 'react';
import { syncCoupangInventory } from '@/app/dashboard/inventory/channels/actions';

export default function CoupangSyncButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSync() {
    setMessage(null);
    startTransition(async () => {
      const result = await syncCoupangInventory();
      if (result.error) {
        setMessage(`⚠️ ${result.error}`);
      } else {
        setMessage(
          `변경 ${result.updated}건 · 변동없음 ${result.unchanged}건 · 실패 ${result.failed}건`
        );
      }
    });
  }

  return (
    <div className="card p-5">
      <h3 className="font-display font-bold mb-2">재고 동기화 (로켓그로스)</h3>
      <p className="text-xs text-inkSoft mb-3">
        쿠팡 로켓창고에 있는 실제 판매가능재고를 그대로 가져와서 쿠팡 창고
        재고에 반영해요. <b>상품 관리</b>에서 쿠팡 옵션ID(vendorItemId)를
        등록해둔 상품만 동기화돼요.
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
