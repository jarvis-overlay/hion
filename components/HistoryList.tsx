'use client';

import { useTransition } from 'react';
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

export default function HistoryList({ movements }: { movements: any[] }) {
  const [isPending, startTransition] = useTransition();

  if (!movements.length) {
    return <p className="text-sm text-inkSoft">아직 히스토리가 없어요.</p>;
  }

  return (
    <div className="grid gap-2">
      {movements.map((m) => (
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
            {new Date(m.created_at).toLocaleDateString('ko-KR')}
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
  );
}
