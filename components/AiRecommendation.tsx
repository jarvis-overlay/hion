'use client';

import { useState } from 'react';
import { runAiRecommendation } from '@/app/dashboard/sourcing/trends/actions';
import type { SourcingRecommendation } from '@/lib/claude';

export default function AiRecommendation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SourcingRecommendation[] | null>(null);
  const [usedTrendData, setUsedTrendData] = useState(false);

  async function handleClick() {
    setLoading(true);
    setError(null);
    const res = await runAiRecommendation();
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setItems(res.recommendations);
    setUsedTrendData(res.usedTrendData);
  }

  return (
    <div className="card p-8 border-t-2 border-t-accent">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-bold mb-1">AI 소싱 추천</h2>
          <p className="text-sm text-inkSoft">
            네이버 쇼핑 카테고리 트렌드를 자동으로 읽고, Claude가 지금 소싱하기
            좋은 구체적인 아이템을 골라줘요.
          </p>
        </div>
        <button
          onClick={handleClick}
          disabled={loading}
          className="btn-primary px-6 py-3 text-sm font-semibold whitespace-nowrap disabled:opacity-50"
        >
          {loading ? '분석 중...' : items ? '다시 추천받기' : 'AI 추천 받기'}
        </button>
      </div>

      {error && (
        <p className="mt-6 text-sm text-warn bg-warnBg rounded-md px-4 py-3">
          {error}
        </p>
      )}

      {loading && (
        <p className="mt-6 text-sm text-inkSoft">
          최근 카테고리별 트렌드를 모으고 Claude에게 물어보는 중이에요...
        </p>
      )}

      {items && items.length > 0 && !usedTrendData && (
        <p className="mt-6 text-xs text-inkSoft bg-accentBg rounded-md px-4 py-3">
          네이버 트렌드/자체 판매 데이터 없이 Claude의 일반 지식(계절성 등)만으로
          추천된 결과예요. 참고용으로만 봐주세요.
        </p>
      )}

      {items && items.length > 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {items.map((rec, i) => (
            <div
              key={i}
              className="rounded-lg border border-paperLine p-5 bg-white/60"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-accent bg-accentBg rounded px-2 py-0.5">
                  {rec.category}
                </span>
              </div>
              <h3 className="font-display text-base font-bold mb-2">
                {rec.item}
              </h3>
              <p className="text-sm text-ink mb-2">{rec.reason}</p>
              <p className="text-xs text-inkSoft mb-1">📈 {rec.trendNote}</p>
              <p className="text-xs text-warn">⚠️ {rec.caution}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
