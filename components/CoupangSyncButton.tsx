'use client';

import { useState, useTransition } from 'react';
import { syncCoupangOrders } from '@/app/dashboard/inventory/channels/actions';

export default function CoupangSyncButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSync() {
    setMessage(null);
    startTransition(async () => {
      const result = await syncCoupangOrders();
      if (result.error) {
        setMessage(`⚠️ ${result.error}`);
      } else {
        setMessage(
          `반영 ${result.synced}건 · 이미 처리됨 ${result.skipped}건 · 매핑 안 된 상품 ${result.unmapped}건`
        );
      }
    });
  }

  return (
    <div className="card p-5">
      <h3 className="font-display font-bold mb-2">주문 동기화</h3>
      <p className="text-xs text-inkSoft mb-3">
        최근 7일간 결제완료된 쿠팡 주문을 가져와서 쿠팡 창고 재고에서 자동으로
        차감해요. <b>상품 관리</b>에서 쿠팡 옵션ID(vendorItemId)를 등록해둔
        상품만 매칭돼요.
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
