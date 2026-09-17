'use client';

import { useState, useTransition } from 'react';
import { generateStrategy } from '@/app/dashboard/sales/strategy/actions';
import { computeMargin } from '@/lib/marginCalc';
import type { SalesStrategyResult } from '@/lib/ai';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

function marginBadgeClass(pct: number) {
  if (pct < 0) return 'bg-red-100 text-red-700';
  if (pct < 15) return 'bg-warnBg text-warn';
  return 'bg-profitBg text-profit';
}

const STRATEGY_SECTIONS: { key: keyof SalesStrategyResult; label: string; icon: string }[] = [
  { key: 'pricingStrategy', label: '가격 전략', icon: '💰' },
  { key: 'reviewStrategy', label: '리뷰 확보 전략', icon: '⭐' },
  { key: 'adStrategy', label: '광고 운영 전략', icon: '📢' },
  { key: 'channelStrategy', label: '채널 우선순위', icon: '🛒' },
  { key: 'differentiation', label: '차별화 포인트', icon: '🎯' },
];

function StrategyView({
  strategy,
  verdict,
  keyword,
}: {
  strategy: SalesStrategyResult;
  verdict?: string | null;
  keyword?: string | null;
}) {
  return (
    <div className="grid gap-2 mt-3 pt-3 border-t border-paperLine">
      {verdict && (
        <p className="text-xs text-inkSoft bg-paper rounded-md px-3 py-2">
          📋 {keyword && <span className="font-semibold text-ink">"{keyword}" 조회 - </span>}
          {verdict}
        </p>
      )}
      {STRATEGY_SECTIONS.map((s) => (
        <div key={s.key} className="text-xs">
          <p className="font-semibold text-ink mb-0.5">
            {s.icon} {s.label}
          </p>
          <p className="text-inkSoft leading-relaxed">{strategy[s.key]}</p>
        </div>
      ))}
    </div>
  );
}

export default function SalesStrategyList({ items }: { items: any[] }) {
  const [search, setSearch] = useState('');
  // 판매 전략은 가격이 정해진 상품이라야 의미가 있어서, 기본값은 "입력"
  // (판매가·원가 다 있는) 상태만 보여준다 - 아직 조사 중인 후보까지 다
  // 뜨면 찾기 힘들다는 피드백으로 필터를 추가함.
  const [enteredFilter, setEnteredFilter] = useState('entered');
  const [stageFilter, setStageFilter] = useState('all');
  const [keywords, setKeywords] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, { strategy: SalesStrategyResult; verdict: string; keyword: string }>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  const q = search.trim().toLowerCase();
  const filtered = items.filter((it) => {
    if (enteredFilter !== 'all' && (it.input_status || 'not_entered') !== enteredFilter) return false;
    if (stageFilter !== 'all' && (it.stage || 'candidate') !== stageFilter) return false;
    if (!q) return true;
    return it.title?.toLowerCase().includes(q);
  });

  function handleGenerate(item: any) {
    const keyword = keywords[item.id] ?? item.title;
    setGeneratingId(item.id);
    setErrors((e) => ({ ...e, [item.id]: '' }));
    startTransition(async () => {
      const res = await generateStrategy(item.id, keyword);
      setGeneratingId(null);
      if ('error' in res) {
        setErrors((e) => ({ ...e, [item.id]: res.error }));
        return;
      }
      setResults((r) => ({
        ...r,
        [item.id]: { strategy: res.strategy, verdict: res.verdict, keyword: res.keyword },
      }));
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="상품명 검색"
          className="border border-paperLine bg-white px-3 py-2 text-sm flex-1 min-w-[180px]"
        />
        <select
          value={enteredFilter}
          onChange={(e) => setEnteredFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="entered">입력된 상품만</option>
          <option value="not_entered">미입력</option>
          <option value="all">입력/미입력 전체</option>
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">후보/확정 전체</option>
          <option value="candidate">후보</option>
          <option value="confirmed">확정</option>
        </select>
      </div>
      <p className="text-xs text-inkSoft mb-4">{filtered.length}개 표시 중 (전체 {items.length}개)</p>

      {filtered.length === 0 ? (
        <p className="text-sm text-inkSoft">조건에 맞는 상품이 없어요.</p>
      ) : (
        <div className="grid gap-3">
          {filtered.map((item) => {
            const margin = computeMargin({
              price: item.price,
              coupon: item.coupon,
              cost: item.cost,
              outputVat: item.output_vat,
              importVat: item.import_vat,
              coupangFee: item.coupang_fee,
              shipping: item.shipping,
              adCost: item.ad_cost,
              etcCost: item.etc_cost,
            });
            const saved = (item.sourcing_item_strategies || [])[0];
            const live = results[item.id];
            const strategy: SalesStrategyResult | null = live
              ? live.strategy
              : saved
              ? {
                  pricingStrategy: saved.pricing_strategy,
                  reviewStrategy: saved.review_strategy,
                  adStrategy: saved.ad_strategy,
                  channelStrategy: saved.channel_strategy,
                  differentiation: saved.differentiation,
                }
              : null;
            const verdict = live?.verdict ?? saved?.market_verdict;
            const keywordUsed = live?.keyword ?? saved?.keyword;
            const isGenerating = generatingId === item.id;

            return (
              <div key={item.id} className="card p-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-semibold text-sm">{item.title}</h3>
                  {margin.marginPct != null && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${marginBadgeClass(margin.marginPct)}`}>
                      마진 {fmt(margin.profit)} ({margin.marginPct.toFixed(1)}%)
                    </span>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-inkSoft font-mono mb-3">
                  {item.price != null && <span>판매가 {item.price.toLocaleString()}</span>}
                  {item.cost != null && <span>원가 {item.cost.toLocaleString()}</span>}
                </div>

                <div className="flex gap-2">
                  <input
                    value={keywords[item.id] ?? item.title}
                    onChange={(e) => setKeywords((k) => ({ ...k, [item.id]: e.target.value }))}
                    placeholder="시장 조회에 쓸 검색어"
                    className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
                  />
                  <button
                    onClick={() => handleGenerate(item)}
                    disabled={isGenerating}
                    className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
                  >
                    {isGenerating ? '생성 중...' : strategy ? '다시 생성' : '판매 전략 생성'}
                  </button>
                </div>
                {isGenerating && (
                  <p className="text-[11px] text-inkSoft mt-1.5">
                    실시간 쿠팡 조회 + AI 분석 중이에요. 캡차 재시도가 겹치면 최대 2~3분 걸릴 수 있어요...
                  </p>
                )}
                {errors[item.id] && (
                  <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2 mt-2">생성 실패: {errors[item.id]}</p>
                )}

                {strategy && <StrategyView strategy={strategy} verdict={verdict} keyword={keywordUsed} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
