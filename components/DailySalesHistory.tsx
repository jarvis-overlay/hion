'use client';

import { Fragment, useState } from 'react';

function toKstDateStr(iso: string) {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');

export default function DailySalesHistory({ rows }: { rows: any[] }) {
  const byDate: Record<
    string,
    { amount: number; qty: number; items: { name: string; qty: number; amount: number }[] }
  > = {};

  for (const row of rows) {
    const date = toKstDateStr(row.occurred_at);
    if (!byDate[date]) byDate[date] = { amount: 0, qty: 0, items: [] };
    const qty = Math.abs(row.quantity);
    const amount = Number(row.amount) || 0;
    byDate[date].qty += qty;
    byDate[date].amount += amount;
    byDate[date].items.push({
      name: row.products?.name || '알 수 없음',
      qty,
      amount,
    });
  }

  // 같은 날짜 안에서 같은 상품끼리 다시 합치기
  for (const date of Object.keys(byDate)) {
    const merged: Record<string, { name: string; qty: number; amount: number }> = {};
    for (const item of byDate[date].items) {
      if (!merged[item.name]) merged[item.name] = { name: item.name, qty: 0, amount: 0 };
      merged[item.name].qty += item.qty;
      merged[item.name].amount += item.amount;
    }
    byDate[date].items = Object.values(merged).sort((a, b) => b.qty - a.qty);
  }

  const dates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1));
  const [openDate, setOpenDate] = useState<string | null>(dates[0] ?? null);

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-xs text-inkSoft uppercase tracking-wide">
            <th className="text-left py-2 px-4">날짜</th>
            <th className="text-right py-2 px-4">매출금액</th>
            <th className="text-right py-2 px-4">판매수량</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => {
            const row = byDate[date];
            const isOpen = openDate === date;
            return (
              <Fragment key={date}>
                <tr
                  onClick={() => setOpenDate(isOpen ? null : date)}
                  className="border-b border-paperLine cursor-pointer hover:bg-paper/60"
                >
                  <td className="py-2 px-4 font-medium">
                    {date} <span className="text-inkSoft">{isOpen ? '▲' : '▼'}</span>
                  </td>
                  <td className="py-2 px-4 text-right font-mono">{fmt(row.amount)}원</td>
                  <td className="py-2 px-4 text-right font-mono font-bold">{row.qty}개</td>
                </tr>
                {isOpen && (
                  <tr className="bg-paper/40">
                    <td colSpan={3} className="py-3 px-6">
                      <ul className="space-y-1.5">
                        {row.items.map((item, i) => (
                          <li key={i} className="flex justify-between text-inkSoft">
                            <span>{item.name}</span>
                            <span className="font-mono">
                              {item.qty}개 · {fmt(item.amount)}원
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {!dates.length && (
            <tr>
              <td colSpan={3} className="py-4 px-4 text-center text-inkSoft">
                판매 기록이 없어요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
