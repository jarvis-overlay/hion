'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import { deleteMovement } from '@/app/dashboard/inventory/stock/actions';

const WAREHOUSE_LABEL: Record<string, string> = {
  coupang: '쿠팡 창고',
  own: '자사 물류창고',
};

const TYPE_LABEL: Record<string, string> = {
  in: '입고',
  out: '판매출고',
  move: '창고이동',
};

const CHANNEL_LABEL: Record<string, string> = {
  coupang: '쿠팡',
  naver: '네이버',
  ohou: '오늘의집',
  ably: '에이블리',
  toss: '토스쇼핑',
};

function toKstDateStr(iso: string) {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default function HistoryList({
  movements,
  products = [],
}: {
  movements: any[];
  products?: any[];
}) {
  const [isPending, startTransition] = useTransition();
  const [productFilter, setProductFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (productFilter !== 'all' && m.product_id !== productFilter) return false;
      if (typeFilter !== 'all' && m.type !== typeFilter) return false;
      const dateStr = toKstDateStr(m.occurred_at || m.created_at);
      if (dateFrom && dateStr < dateFrom) return false;
      if (dateTo && dateStr > dateTo) return false;
      return true;
    });
  }, [movements, productFilter, typeFilter, dateFrom, dateTo]);

  const grouped = useMemo(() => {
    const byDate: Record<string, any[]> = {};
    for (const m of filtered) {
      const dateStr = toKstDateStr(m.occurred_at || m.created_at);
      if (!byDate[dateStr]) byDate[dateStr] = [];
      byDate[dateStr].push(m);
    }
    const dates = Object.keys(byDate).sort((a, b) =>
      sortDir === 'desc' ? (a < b ? 1 : -1) : a < b ? -1 : 1
    );
    return dates.map((d) => ({ date: d, rows: byDate[d] }));
  }, [filtered, sortDir]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs"
        >
          <option value="all">전체 상품</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs"
        >
          <option value="all">전체 유형</option>
          <option value="in">입고</option>
          <option value="out">판매출고</option>
          <option value="move">창고이동</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
        />
        <span className="text-xs text-inkSoft self-center">~</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
        />
        <button
          onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="text-xs border border-paperLine px-2 py-1.5 rounded hover:bg-paper/60"
        >
          날짜 {sortDir === 'desc' ? '최신순 ▼' : '오래된순 ▲'}
        </button>
        {(productFilter !== 'all' || typeFilter !== 'all' || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setProductFilter('all');
              setTypeFilter('all');
              setDateFrom('');
              setDateTo('');
            }}
            className="text-xs text-inkSoft underline self-center"
          >
            필터 초기화
          </button>
        )}
        <span className="text-xs text-inkSoft self-center ml-auto">
          {filtered.length}건
        </span>
      </div>

      {!grouped.length ? (
        <p className="text-sm text-inkSoft">조건에 맞는 히스토리가 없어요.</p>
      ) : (
        <div className="grid gap-4">
          {grouped.map(({ date, rows }) => (
            <Fragment key={date}>
              <div className="text-xs font-semibold text-inkSoft sticky top-0">
                {date} <span className="text-inkSoft font-normal">({rows.length}건)</span>
              </div>
              <div className="grid gap-2 -mt-2">
                {rows.map((m) => (
                  <div
                    key={m.id}
                    className="card px-4 py-3 flex items-center gap-3 text-sm flex-wrap"
                  >
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                        m.type === 'in'
                          ? 'bg-profitBg text-profit'
                          : 'bg-warnBg text-warn'
                      }`}
                    >
                      {TYPE_LABEL[m.type] || m.type}
                    </span>
                    <span className="font-medium flex-1 min-w-[100px]">
                      {m.products?.name || '상품'}
                    </span>
                    <span className="text-xs text-inkSoft">
                      {WAREHOUSE_LABEL[m.warehouse] || m.warehouse}
                    </span>
                    {m.channel && (
                      <span className="text-xs bg-paperLine px-2 py-0.5 rounded-full">
                        {CHANNEL_LABEL[m.channel] || m.channel}
                      </span>
                    )}
                    <span
                      className={`font-mono text-sm ${
                        m.quantity < 0 ? 'text-red-700' : 'text-profit'
                      }`}
                    >
                      {m.quantity > 0 ? '+' : ''}
                      {m.quantity}
                    </span>
                    <span className="text-[11px] text-inkSoft whitespace-nowrap">
                      {new Date(m.occurred_at || m.created_at).toLocaleString('ko-KR')}
                    </span>
                    {m.note && (
                      <span className="text-xs text-inkSoft basis-full">{m.note}</span>
                    )}
                    <button
                      onClick={() => startTransition(() => deleteMovement(m.id))}
                      disabled={isPending}
                      className="text-xs text-inkSoft hover:text-red-700 ml-auto"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
