'use client';

import { useState, useTransition } from 'react';
import {
  receivePurchaseOrder,
  deletePurchaseOrder,
} from '@/app/dashboard/inventory/orders/actions';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');

export default function OrderRow({ order }: { order: any }) {
  const [isPending, startTransition] = useTransition();
  const [showReceive, setShowReceive] = useState(false);
  const [coupangQty, setCoupangQty] = useState('');
  const [ownQty, setOwnQty] = useState('');

  const totalKrw = order.quantity * order.unit_price_cny * order.exchange_rate;
  const isReceived = order.status === 'received';

  function handleReceive() {
    const c = parseInt(coupangQty) || 0;
    const o = parseInt(ownQty) || 0;
    if (c + o !== order.quantity) {
      alert(
        `쿠팡창고(${c}) + 자사창고(${o}) 합이 발주수량(${order.quantity})과 달라요.`
      );
      return;
    }
    startTransition(async () => {
      await receivePurchaseOrder(order.id, order.product_id, c, o, '');
      setShowReceive(false);
    });
  }

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">
              {order.products?.name || '상품'}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                isReceived
                  ? 'bg-profitBg text-profit'
                  : 'bg-warnBg text-warn'
              }`}
            >
              {isReceived ? '입고완료' : '발주중'}
            </span>
          </div>
          <div className="text-xs text-inkSoft font-mono mt-1">
            {order.order_date} · 수량 {order.quantity} · 단가 ¥
            {order.unit_price_cny} · 환율 {order.exchange_rate} · 약{' '}
            {fmt(totalKrw)}원
          </div>
          {order.note && (
            <p className="text-xs text-ink mt-1">{order.note}</p>
          )}
        </div>
        <div className="flex gap-2 text-xs">
          {!isReceived && (
            <button
              onClick={() => setShowReceive((v) => !v)}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              입고 처리
            </button>
          )}
          <button
            onClick={() => startTransition(() => deletePurchaseOrder(order.id))}
            disabled={isPending}
            className="text-inkSoft hover:text-red-700 px-2"
          >
            삭제
          </button>
        </div>
      </div>

      {showReceive && !isReceived && (
        <div className="mt-3 pt-3 border-t border-paperLine grid gap-2">
          <p className="text-xs text-inkSoft">
            총 {order.quantity}개를 어느 창고로 보낼지 나눠 입력해줘
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-inkSoft">쿠팡 창고</label>
              <input
                type="number"
                value={coupangQty}
                onChange={(e) => setCoupangQty(e.target.value)}
                placeholder="0"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono w-full mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-inkSoft">자사 물류창고</label>
              <input
                type="number"
                value={ownQty}
                onChange={(e) => setOwnQty(e.target.value)}
                placeholder="0"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono w-full mt-1"
              />
            </div>
          </div>
          <button
            onClick={handleReceive}
            disabled={isPending}
            className="btn-primary py-2 text-sm font-semibold disabled:opacity-50"
          >
            {isPending ? '처리 중...' : '입고 확정'}
          </button>
        </div>
      )}
    </div>
  );
}
