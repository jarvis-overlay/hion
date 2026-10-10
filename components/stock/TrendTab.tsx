'use client';

import { Fragment, useState } from 'react';
import type { StockStatsResult } from '@/lib/stockStats';
import { Delta, MiniBars, fmt } from './shared';

const RANGES = [7, 14, 30] as const;
type Metric = 'amount' | 'qty';

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function weekdayOf(dateStr: string) {
  return WEEKDAY[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

function Toggle<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={String(o.key)}
          type="button"
          onClick={() => onChange(o.key)}
          className={`text-xs px-3 py-1.5 rounded-full border ${
            value === o.key ? 'bg-ink text-white border-ink' : 'border-paperLine bg-white text-inkSoft hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// 판매 추이 탭: 기간(7/14/30일)을 고르면 직전 같은 길이의 기간과 비교하고,
// 일자별 표에서 날짜를 눌러 그날 팔린 상품 내역을 펼쳐본다.
export default function TrendTab({
  stats,
  initialRange = 14,
}: {
  stats: StockStatsResult;
  initialRange?: 7 | 14 | 30;
}) {
  const [range, setRange] = useState<7 | 14 | 30>(initialRange);
  const [metric, setMetric] = useState<Metric>('amount');
  const [openDate, setOpenDate] = useState<string | null>(null);

  const { days } = stats;
  const current = days.slice(-range);
  const previous = days.slice(-range * 2, -range);

  const sumOf = (list: typeof days, k: 'qty' | 'amount' | 'returns') =>
    list.reduce((s, d) => s + d[k], 0);

  const curAmount = sumOf(current, 'amount');
  const prevAmount = sumOf(previous, 'amount');
  const curQty = sumOf(current, 'qty');
  const prevQty = sumOf(previous, 'qty');
  const curReturns = sumOf(current, 'returns');

  const values = current.map((d) => (metric === 'amount' ? d.amount : Math.max(0, d.qty)));
  const tooltips = current.map(
    (d) => `${d.date}(${weekdayOf(d.date)}) · ${fmt(d.amount)}원 · ${d.qty}개${d.returns ? ` · 반품 ${d.returns}` : ''}`
  );

  const tableDays = [...days.slice(-30)].reverse();

  return (
    <div className="grid gap-4">
      <section className="card p-5">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
          <Toggle
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ key: r, label: `${r}일` }))}
          />
          <Toggle
            value={metric}
            onChange={setMetric}
            options={[
              { key: 'amount' as Metric, label: '매출' },
              { key: 'qty' as Metric, label: '판매수량' },
            ]}
          />
        </div>

        <dl className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-xl bg-paper px-2.5 sm:px-3 py-2.5">
            <dt className="text-xs text-inkSoft">매출</dt>
            <dd className="font-mono font-bold text-xs sm:text-base whitespace-nowrap">{fmt(curAmount)}원</dd>
            <dd className="text-[11px]">
              <Delta now={curAmount} prev={prevAmount} />
            </dd>
          </div>
          <div className="rounded-xl bg-paper px-2.5 sm:px-3 py-2.5">
            <dt className="text-xs text-inkSoft">판매수량</dt>
            <dd className="font-mono font-bold text-xs sm:text-base whitespace-nowrap">{fmt(curQty)}개</dd>
            <dd className="text-[11px]">
              <Delta now={curQty} prev={prevQty} />
            </dd>
          </div>
          <div className="rounded-xl bg-paper px-2.5 sm:px-3 py-2.5">
            <dt className="text-xs text-inkSoft">일평균 매출</dt>
            <dd className="font-mono font-bold text-xs sm:text-base whitespace-nowrap">{fmt(curAmount / range)}원</dd>
            <dd className="text-[11px] text-inkSoft">반품 {curReturns}개</dd>
          </div>
        </dl>
        <p className="text-[11px] text-inkSoft -mt-2 mb-3">
          증감은 바로 앞 {range}일 대비예요. 매출·수량은 반품을 뺀 순 기준이에요.
        </p>

        <MiniBars
          values={values}
          labels={current.map((d) => d.date.slice(5).replace('-', '/'))}
          tooltips={tooltips}
          height={140}
          labelEvery={range <= 7 ? 1 : range <= 14 ? 2 : 4}
        />
      </section>

      <section>
        <h2 className="font-display text-base font-bold mb-2">일자별 내역 (최근 30일)</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-xs text-inkSoft">
                <th className="text-left py-2 px-4">날짜</th>
                <th className="text-right py-2 px-4">매출</th>
                <th className="text-right py-2 px-4">판매</th>
                <th className="text-right py-2 px-4">반품</th>
              </tr>
            </thead>
            <tbody>
              {tableDays.map((d) => {
                const isOpen = openDate === d.date;
                const items = stats.dayItems[d.date] || [];
                const empty = d.qty === 0 && d.amount === 0 && d.returns === 0;
                return (
                  <Fragment key={d.date}>
                    <tr
                      onClick={() => !empty && setOpenDate(isOpen ? null : d.date)}
                      className={`border-b border-paperLine ${empty ? 'text-inkSoft' : 'cursor-pointer hover:bg-paper/60'}`}
                    >
                      <td className="py-2 px-4 font-medium whitespace-nowrap">
                        {d.date.slice(5)} ({weekdayOf(d.date)})
                        {!empty && <span className="text-inkSoft text-[10px]"> {isOpen ? '▲' : '▼'}</span>}
                      </td>
                      <td className="py-2 px-4 text-right font-mono">{empty ? '-' : `${fmt(d.amount)}원`}</td>
                      <td className="py-2 px-4 text-right font-mono font-bold">{empty ? '-' : `${d.qty}개`}</td>
                      <td className={`py-2 px-4 text-right font-mono ${d.returns ? 'text-red-700' : 'text-inkSoft'}`}>
                        {d.returns || '-'}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-paper/40 border-b border-paperLine">
                        <td colSpan={4} className="py-3 px-5">
                          <ul className="space-y-1.5 text-xs">
                            {items.map((i) => (
                              <li key={i.name} className="flex justify-between gap-3 text-inkSoft">
                                <span className="break-words min-w-0">{i.name}</span>
                                <span className="font-mono whitespace-nowrap">
                                  {i.qty}개 · {fmt(i.amount)}원
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
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
