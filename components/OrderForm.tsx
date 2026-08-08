'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  addPurchaseOrder,
  fetchCnyToKrwRate,
} from '@/app/dashboard/inventory/orders/actions';

export default function OrderForm({ products }: { products: any[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [rate, setRate] = useState(190);
  const [rateStatus, setRateStatus] = useState<
    'loading' | 'auto' | 'manual' | 'failed'
  >('loading');

  async function loadRate() {
    setRateStatus('loading');
    const result = await fetchCnyToKrwRate();
    if (result.rate) {
      setRate(Math.round(result.rate * 100) / 100);
      setRateStatus('auto');
    } else {
      setRateStatus('failed');
    }
  }

  useEffect(() => {
    loadRate();
  }, []);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await addPurchaseOrder(fd);
          formRef.current?.reset();
          loadRate();
        })
      }
      className="card p-5 mb-6 grid gap-3"
    >
      <select
        name="product_id"
        required
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      >
        <option value="">상품 선택</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-inkSoft">발주일</label>
          <input
            name="order_date"
            type="date"
            required
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono w-full mt-1"
          />
        </div>
        <div>
          <label className="text-xs text-inkSoft">수량</label>
          <input
            name="quantity"
            type="number"
            placeholder="0"
            required
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono w-full mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-inkSoft">단가 (위안, CNY)</label>
          <input
            name="unit_price_cny"
            type="number"
            step="0.01"
            placeholder="0"
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono w-full mt-1"
          />
        </div>
        <div>
          <label className="text-xs text-inkSoft flex items-center gap-1.5">
            환율 (원/위안)
            {rateStatus === 'loading' && (
              <span className="text-inkSoft">조회 중...</span>
            )}
            {rateStatus === 'auto' && (
              <span className="text-profit">실시간 자동 조회됨</span>
            )}
            {rateStatus === 'failed' && (
              <span className="text-warn">자동 조회 실패, 직접 입력해줘</span>
            )}
            <button
              type="button"
              onClick={loadRate}
              className="text-inkSoft underline hover:text-ink"
            >
              새로고침
            </button>
          </label>
          <input
            name="exchange_rate"
            type="number"
            step="0.01"
            value={rate}
            onChange={(e) => {
              setRate(Number(e.target.value));
              setRateStatus('manual');
            }}
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono w-full mt-1"
          />
        </div>
      </div>

      <textarea
        name="note"
        placeholder="특이사항 (품질, 협상, 배송 이슈 등)"
        rows={2}
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '등록 중...' : '발주 등록'}
      </button>
    </form>
  );
}
