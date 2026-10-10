'use client';

import { riskPriorityOf, type StockStatsResult } from '@/lib/stockStats';
import { Delta, MiniBars, RiskChips, daysLeftText, fmt, fmt1 } from './shared';

// 개요 탭: "지금 조치가 필요한 상품"과 "매출이 어떻게 흘러가는지"만 보여준다.
// 자세한 건 각각 상품별/판매 추이 탭으로 이동해서 본다.
export default function OverviewTab({
  stats,
  onOpenProduct,
  onGo,
}: {
  stats: StockStatsResult;
  onOpenProduct: (id: string) => void;
  onGo: (tab: 'products' | 'trend', filter?: string) => void;
}) {
  const { summary, days, products } = stats;

  const atRisk = products
    .filter((p) => !p.isHidden && p.risks.length > 0)
    .sort(
      (a, b) =>
        riskPriorityOf(a.risks) - riskPriorityOf(b.risks) ||
        (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) ||
        b.sold30 - a.sold30
    );
  const shown = atRisk.slice(0, 8);

  const last14 = days.slice(-14);
  const todayStr = days[days.length - 1].date;
  const topToday = (stats.dayItems[todayStr] || []).filter((i) => i.qty > 0).slice(0, 5);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold">조치가 필요한 상품</h2>
          {atRisk.length > shown.length && (
            <button
              type="button"
              onClick={() => onGo('products', 'risk')}
              className="text-xs text-accent hover:underline"
            >
              전체 {atRisk.length}개 보기 →
            </button>
          )}
        </div>
        {shown.length ? (
          <ul className="flex flex-col">
            {shown.map((p) => (
              <li key={p.id} className="border-b border-paperLine last:border-0">
                <button
                  type="button"
                  onClick={() => onOpenProduct(p.id)}
                  className="w-full text-left py-3 hover:bg-paper/60 rounded-lg px-2 -mx-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold break-words min-w-0">{p.name}</span>
                    <span className="flex gap-1 flex-wrap justify-end shrink-0">
                      <RiskChips risks={p.risks} />
                    </span>
                  </div>
                  <div className="text-xs text-inkSoft mt-1 font-mono">
                    쿠팡 재고 {fmt(p.coupangStock)}개
                    {p.dailyRate > 0 && ` · 하루 ${fmt1(p.dailyRate)}개`}
                    {p.coupangStock > 0 && p.daysLeft !== null && ` · ${daysLeftText(p)}치`}
                    {p.risks.includes('soldout') &&
                      (p.ownStock > 0 ? ` · 자사 재고 ${fmt(p.ownStock)}개로 입고 가능` : ' · 자사 재고도 없음')}
                    {p.risks.includes('returns') &&
                      ` · 30일 반품 ${p.returned30}/${p.soldGross30}건`}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-inkSoft py-6 text-center">
            지금 위험한 상품이 없어요 👍
          </p>
        )}
      </section>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold">최근 14일 매출 흐름</h2>
          <button
            type="button"
            onClick={() => onGo('trend')}
            className="text-xs text-accent hover:underline"
          >
            자세히 →
          </button>
        </div>
        <MiniBars
          values={last14.map((d) => d.amount)}
          labels={last14.map((d) => d.date.slice(8))}
          tooltips={last14.map((d) => `${d.date} · ${fmt(d.amount)}원 · ${d.qty}개`)}
          labelEvery={2}
        />

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-paper px-3 py-2.5">
            <dt className="text-xs text-inkSoft">오늘</dt>
            <dd className="font-mono font-bold">{fmt(summary.todayAmount)}원</dd>
            <dd className="text-[11px] text-inkSoft">
              {summary.todayQty}개 · 어제 전체 {fmt(summary.yesterdayAmount)}원
            </dd>
          </div>
          <div className="rounded-xl bg-paper px-3 py-2.5">
            <dt className="text-xs text-inkSoft">이번주 (월~오늘)</dt>
            <dd className="font-mono font-bold">{fmt(summary.weekAmount)}원</dd>
            <dd className="text-[11px] text-inkSoft">
              지난주 같은 기간 대비{' '}
              <Delta now={summary.weekAmount} prev={summary.prevWeekAmount} />
            </dd>
          </div>
        </dl>

        <h3 className="text-xs font-semibold text-inkSoft mt-5 mb-2">오늘 많이 팔린 상품</h3>
        {topToday.length ? (
          <ul className="text-sm flex flex-col gap-1.5">
            {topToday.map((i) => (
              <li key={i.name} className="flex justify-between gap-3">
                <span className="truncate">{i.name}</span>
                <span className="font-mono text-xs text-inkSoft whitespace-nowrap">
                  {i.qty}개 · {fmt(i.amount)}원
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-inkSoft">오늘 아직 판매 동기화된 내역이 없어요.</p>
        )}
      </section>
    </div>
  );
}
