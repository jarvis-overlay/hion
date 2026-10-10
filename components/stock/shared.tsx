'use client';

import { RISK_LABEL, type ProductStat, type RiskKey } from '@/lib/stockStats';

export const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ko-KR');

export const RISK_CHIP_CLASS: Record<RiskKey, string> = {
  soldout: 'bg-red-50 text-red-700',
  low: 'bg-warnBg text-warn',
  returns: 'bg-accentBg text-accent',
  excess: 'bg-blue-50 text-blue-600',
};

export function RiskChips({ risks }: { risks: RiskKey[] }) {
  if (!risks.length) return null;
  return (
    <>
      {risks.map((r) => (
        <span
          key={r}
          className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap font-semibold ${RISK_CHIP_CLASS[r]}`}
        >
          {RISK_LABEL[r]}
        </span>
      ))}
    </>
  );
}

// 지난 기간 대비 증감 (지난 기간이 0이면 비율 대신 '신규' 표시)
export function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev <= 0 && now <= 0) return <span className="text-inkSoft">-</span>;
  if (prev <= 0) return <span className="text-profit font-semibold">신규</span>;
  const pct = ((now - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span className={`font-semibold ${up ? 'text-profit' : 'text-red-700'}`}>
      {up ? '▲' : '▼'} {fmt1(Math.abs(pct))}%
    </span>
  );
}

// 외부 차트 라이브러리 없이 div 높이로 그리는 막대 차트. 마지막(오늘) 막대만
// 강조색, 나머지는 옅은 색. 값은 title로 툴팁(PC)과 접근성을 제공한다.
export function MiniBars({
  values,
  labels,
  tooltips,
  height = 96,
  labelEvery = 1,
}: {
  values: number[];
  labels?: string[];
  tooltips?: string[];
  height?: number;
  labelEvery?: number;
}) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {values.map((v, i) => {
          const isLast = i === values.length - 1;
          const h = v > 0 ? Math.max(4, (v / max) * height) : 2;
          return (
            <div
              key={i}
              className="flex-1 min-w-0 rounded-t-[3px]"
              style={{
                height: h,
                backgroundColor: isLast ? '#F5285C' : v > 0 ? '#FBC0CF' : '#F1F1F4',
              }}
              title={tooltips?.[i] ?? String(v)}
            />
          );
        })}
      </div>
      {labels && (
        <div className="flex gap-[3px] mt-1">
          {labels.map((l, i) => (
            <div
              key={i}
              className="flex-1 min-w-0 text-center text-[10px] text-inkSoft whitespace-nowrap overflow-visible"
            >
              {/* 마지막(오늘) 라벨은 항상 보이고, 그 직전 라벨은 겹치지 않게 숨긴다 */}
              {i === labels.length - 1 || (i % labelEvery === 0 && labels.length - 1 - i >= labelEvery) ? l : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 소진 예상 일수를 사람이 바로 읽는 문장으로
export function daysLeftText(p: ProductStat): string {
  if (p.coupangStock <= 0) return p.dailyRate > 0 ? '재고 없음' : '-';
  if (p.daysLeft === null) return '판매 없음';
  if (p.daysLeft >= 365) return '1년+';
  return `${fmt1(p.daysLeft)}일`;
}
