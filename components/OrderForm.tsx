'use client';

import { useRef, useTransition } from 'react';
import { addPurchaseOrder } from '@/app/dashboard/inventory/orders/actions';

export default function OrderForm({ products }: { products: any[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await addPurchaseOrder(fd);
          formRef.current?.reset();
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
          <label className="text-xs text-inkSoft">환율 (원/위안)</label>
          <input
            name="exchange_rate"
            type="number"
            step="0.1"
            defaultValue={190}
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
