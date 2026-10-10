'use client';

import { useCallback, useState } from 'react';
import type { ProductFilter, StockStatsResult, StockTab } from '@/lib/stockStats';
import HistoryList from '@/components/HistoryList';
import SaleForm from '@/components/SaleForm';
import OverviewTab from './OverviewTab';
import ProductsTab from './ProductsTab';
import TrendTab from './TrendTab';
import { Delta, fmt } from './shared';

const TABS: { key: StockTab; label: string }[] = [
  { key: 'overview', label: '개요' },
  { key: 'products', label: '상품별' },
  { key: 'trend', label: '판매 추이' },
  { key: 'history', label: '입출고 기록' },
];

// 요약 카드 → 해당 탭으로 이동하는 구조. 위쪽 카드는 어느 탭에 있든 항상
// 보이고, 누르면 탭(과 필터)이 바뀐다. 탭 상태는 주소(?tab=&filter=)에도
// 반영해서 새로고침/공유/뒤로가기 후에도 같은 화면으로 돌아온다 (서버
// 재렌더 없이 history.replaceState만 쓴다).
export default function StockDashboard({
  stats,
  movements,
  productOptions,
  initialTab,
  initialFilter,
}: {
  stats: StockStatsResult;
  movements: any[];
  productOptions: { id: string; name: string; is_hidden: boolean | null }[];
  initialTab: StockTab;
  initialFilter: ProductFilter;
}) {
  const [tab, setTab] = useState<StockTab>(initialTab);
  const [filter, setFilter] = useState<ProductFilter>(initialFilter);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [trendKey, setTrendKey] = useState(0);
  const [trendRange, setTrendRange] = useState<7 | 14 | 30>(14);

  const syncUrl = useCallback((nextTab: StockTab, nextFilter: ProductFilter) => {
    try {
      const params = new URLSearchParams();
      if (nextTab !== 'overview') params.set('tab', nextTab);
      if (nextTab === 'products' && nextFilter !== 'all') params.set('filter', nextFilter);
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    } catch {
      // 주소 동기화는 편의 기능이라 실패해도 화면 동작엔 영향 없음
    }
  }, []);

  function go(nextTab: StockTab, nextFilter?: ProductFilter, range?: 7 | 14 | 30) {
    const f = nextFilter ?? (nextTab === 'products' ? filter : 'all');
    setTab(nextTab);
    setFilter(f);
    setFocusId(null);
    if (range) {
      setTrendRange(range);
      setTrendKey((k) => k + 1);
    }
    syncUrl(nextTab, f);
  }

  function changeFilter(f: ProductFilter) {
    setFilter(f);
    syncUrl('products', f);
  }

  function openProduct(id: string) {
    setTab('products');
    setFilter('all');
    setFocusId(id);
    syncUrl('products', 'all');
  }

  const { summary } = stats;
  const riskDetail = (
    [
      ['soldout', '품절'],
      ['low', '임박'],
      ['returns', '반품'],
      ['excess', '과다'],
    ] as const
  )
    .filter(([k]) => summary.riskCounts[k] > 0)
    .map(([k, label]) => `${label} ${summary.riskCounts[k]}`)
    .join(' · ');

  const cardBase =
    'card p-4 sm:p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent';

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <button
          type="button"
          onClick={() => go('products', 'risk')}
          className={`${cardBase} ${summary.riskProductCount > 0 ? '!outline-red-200 !outline-2' : ''}`}
        >
          <div className="text-xs text-inkSoft mb-1.5">위험 상품</div>
          <div
            className={`text-xl sm:text-2xl font-bold font-mono ${
              summary.riskProductCount > 0 ? 'text-red-700' : 'text-profit'
            }`}
          >
            {summary.riskProductCount}개
          </div>
          <div className="text-[11px] text-inkSoft mt-1 truncate">{riskDetail || '모두 정상'}</div>
        </button>

        <button type="button" onClick={() => go('trend', undefined, 7)} className={cardBase}>
          <div className="text-xs text-inkSoft mb-1.5">오늘 매출</div>
          <div className="text-xl sm:text-2xl font-bold font-mono">{fmt(summary.todayAmount)}원</div>
          <div className="text-[11px] text-inkSoft mt-1">
            {summary.todayQty}개 · 어제 전체 {fmt(summary.yesterdayAmount)}원
          </div>
        </button>

        <button type="button" onClick={() => go('trend', undefined, 7)} className={cardBase}>
          <div className="text-xs text-inkSoft mb-1.5">이번주 매출</div>
          <div className="text-xl sm:text-2xl font-bold font-mono">{fmt(summary.weekAmount)}원</div>
          <div className="text-[11px] text-inkSoft mt-1">
            지난주 같은 기간 <Delta now={summary.weekAmount} prev={summary.prevWeekAmount} />
          </div>
        </button>

        <button type="button" onClick={() => go('products', 'all')} className={cardBase}>
          <div className="text-xs text-inkSoft mb-1.5">쿠팡 창고 재고</div>
          <div className="text-xl sm:text-2xl font-bold font-mono">{fmt(summary.coupangStockTotal)}개</div>
          <div className="text-[11px] text-inkSoft mt-1">자사 물류창고 {fmt(summary.ownStockTotal)}개</div>
        </button>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-paperLine mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => go(t.key, t.key === 'products' ? filter : undefined, t.key === 'trend' ? 14 : undefined)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${
              tab === t.key
                ? 'border-accent text-accent font-bold'
                : 'border-transparent text-inkSoft hover:text-ink font-semibold'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          stats={stats}
          onOpenProduct={openProduct}
          onGo={(t, f) => go(t, f as ProductFilter | undefined, t === 'trend' ? 14 : undefined)}
        />
      )}
      {tab === 'products' && (
        <ProductsTab stats={stats} filter={filter} onFilterChange={changeFilter} focusId={focusId} />
      )}
      {tab === 'trend' && <TrendTab key={trendKey} stats={stats} initialRange={trendRange} />}
      {tab === 'history' && (
        <div>
          {productOptions.length ? (
            <SaleForm products={productOptions} />
          ) : (
            <div className="card p-4 mb-6 text-sm text-inkSoft">
              먼저 <b>상품 관리</b>에서 상품을 등록해야 판매 기록을 남길 수 있어요.
            </div>
          )}
          <HistoryList movements={movements} products={productOptions} />
        </div>
      )}
    </div>
  );
}
