'use client';

import { useState } from 'react';
import { toggleProductVisibility } from '@/app/dashboard/inventory/stock/actions';

const CHANNELS = [
  { key: 'coupang', label: '쿠팡' },
  { key: 'naver', label: '네이버' },
  { key: 'ohou', label: '오늘의집' },
  { key: 'ably', label: '에이블리' },
  { key: 'toss', label: '토스쇼핑' },
];

const RANGES = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: 'all', label: '전체' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

function startOfTodayKST() {
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - kstOffsetMs);
}

function cutoffFor(range: RangeKey): Date | null {
  if (range === 'all') return null;
  if (range === 'today') return startOfTodayKST();
  const days = range === '7d' ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export default function ChannelSalesTable({
  products,
  salesRows,
  coupangStockByProduct,
}: {
  products: any[]; // id, name, is_hidden
  salesRows: any[]; // product_id, channel, quantity, occurred_at
  coupangStockByProduct: Record<string, number>;
}) {
  const [range, setRange] = useState<RangeKey>('today');
  const [showHidden, setShowHidden] = useState(false);

  const cutoff = cutoffFor(range);
  const filteredRows = cutoff
    ? salesRows.filter((r) => r.occurred_at && new Date(r.occurred_at) >= cutoff)
    : salesRows;

  const salesByProduct: Record<string, Record<string, number>> = {};
  for (const row of filteredRows) {
    if (!salesByProduct[row.product_id]) salesByProduct[row.product_id] = {};
    salesByProduct[row.product_id][row.channel] =
      (salesByProduct[row.product_id][row.channel] || 0) +
      Math.abs(row.quantity);
  }

  const visibleProducts = products.filter((p) => showHidden || !p.is_hidden);
  const hiddenCount = products.length - visibleProducts.length;

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b border-paperLine flex-wrap gap-2">
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                range === r.key
                  ? 'bg-ink text-white border-ink'
                  : 'border-paperLine text-inkSoft hover:text-ink'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-inkSoft cursor-pointer">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            숨긴 상품도 보기
          </label>
          {hiddenCount > 0 && (
            <span className="text-xs text-inkSoft">{hiddenCount}개 숨김</span>
          )}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-xs text-inkSoft uppercase tracking-wide">
            <th className="text-left py-2 px-4 whitespace-nowrap">상품</th>
            <th className="text-right py-2 px-4 whitespace-nowrap">
              총 판매량
            </th>
            {CHANNELS.map((c) => (
              <th
                key={c.key}
                className="text-right py-2 px-4 whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
            <th className="text-right py-2 px-4 whitespace-nowrap">
              쿠팡 창고 재고
            </th>
            <th className="text-right py-2 px-4 whitespace-nowrap">관리</th>
          </tr>
        </thead>
        <tbody>
          {visibleProducts.map((p) => {
            const byChannel = salesByProduct[p.id] || {};
            const total = Object.values(byChannel).reduce(
              (s, v) => s + v,
              0
            );
            return (
              <tr
                key={p.id}
                className={`border-b border-paperLine last:border-0 ${
                  p.is_hidden ? 'opacity-50' : ''
                }`}
              >
                <td className="py-2 px-4 font-medium whitespace-nowrap">
                  {p.name}
                </td>
                <td className="py-2 px-4 text-right font-mono font-bold">
                  {total}
                </td>
                {CHANNELS.map((c) => (
                  <td
                    key={c.key}
                    className="py-2 px-4 text-right font-mono text-inkSoft"
                  >
                    {byChannel[c.key] || 0}
                  </td>
                ))}
                <td className="py-2 px-4 text-right font-mono">
                  {coupangStockByProduct[p.id] ?? 0}
                </td>
                <td className="py-2 px-4 text-right">
                  <button
                    onClick={() => toggleProductVisibility(p.id, !p.is_hidden)}
                    className="text-xs underline text-inkSoft hover:text-ink whitespace-nowrap"
                  >
                    {p.is_hidden ? '다시 보이기' : '숨기기'}
                  </button>
                </td>
              </tr>
            );
          })}
          {!visibleProducts.length && (
            <tr>
              <td colSpan={9} className="py-4 px-4 text-center text-inkSoft">
                등록된 상품이 없어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
