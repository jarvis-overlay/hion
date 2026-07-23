'use client';

import { useRef, useTransition } from 'react';
import { recordSale } from '@/app/dashboard/inventory/stock/actions';

const CHANNELS = [
  { value: 'coupang', label: '쿠팡' },
  { value: 'naver', label: '네이버' },
  { value: 'ohou', label: '오늘의집' },
  { value: 'ably', label: '에이블리' },
  { value: 'toss', label: '토스쇼핑' },
];

export default function SaleForm({ products }: { products: any[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await recordSale(fd);
          formRef.current?.reset();
        })
      }
      className="card p-5 mb-6 grid gap-3"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-inkSoft">
        판매 출고 기록 (수동)
      </h2>
      <div className="grid grid-cols-2 gap-3">
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
        <select
          name="channel"
          required
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        >
          <option value="">채널 선택</option>
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          name="quantity"
          type="number"
          placeholder="판매 수량"
          required
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="note"
          placeholder="메모 (선택)"
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '기록 중...' : '출고 기록'}
      </button>
      <p className="text-[11px] text-inkSoft">
        쿠팡은 쿠팡 창고에서, 나머지 채널은 자사 물류창고에서 자동으로 차감돼요.
        (API 연동 전까지는 수동 입력)
      </p>
    </form>
  );
}
