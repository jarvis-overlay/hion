'use client';

import { useState } from 'react';
import { runAiRecommendation } from '@/app/dashboard/sourcing/trends/actions';
import type { SourcingRecommendation } from '@/lib/ai';

export default function AiRecommendation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SourcingRecommendation[] | null>(null);
  const [usedTrendData, setUsedTrendData] = useState(false);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await runAiRecommendation();
      if ('error' in res) {
        setError(res.error);
      } else {
        setItems(res.recommendations);
        setUsedTrendData(res.usedTrendData);
      }
    } catch (e: any) {
      setError(e?.message || '요청 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold mb-1">AI 소싱 추천</h2>
          <p className="text-sm text-inkSoft">
            우리 쿠팡 판매 데이터와 트렌드를 자동으로 읽고, AI가 지금 소싱하기
            좋은 구체적인 아이템을 근거와 함께 골라줘요.
          </p>
        </div>
        <button
          onClick={handleClick}
          disabled={loading}
          className="btn-primary px-6 py-2.5 text-sm font-semibold whitespace-nowrap disabled:opacity-50"
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
          우리 판매 데이터와 트렌드를 모으고 AI에게 물어보는 중이에요...
        </p>
      )}

      {items && items.length > 0 && !usedTrendData && (
        <p className="mt-6 text-xs text-inkSoft bg-accentBg rounded-md px-4 py-3">
          네이버 트렌드/자체 판매 데이터 없이 AI의 일반 지식(계절성 등)만으로
          추천된 결과예요. 참고용으로만 봐주세요.
        </p>
      )}

      {items && items.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {items.map((rec, i) => (
            <div key={i} className="rounded-lg border border-paperLine p-5">
              <span className="text-xs font-semibold text-accent bg-accentBg rounded px-2 py-0.5">
                {rec.category}
              </span>
              <h3 className="text-base font-bold mt-2 mb-1.5">{rec.item}</h3>
              <p className="text-sm text-ink mb-3">{rec.reason}</p>

              <dl className="space-y-1.5 text-xs mb-3">
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-inkSoft">
                    📈 트렌드/판매
                  </dt>
                  <dd className="text-inkSoft">{rec.criteria?.trend}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-inkSoft">
                    🗓️ 시기
                  </dt>
                  <dd className="text-inkSoft">{rec.criteria?.seasonality}</dd>
                </div>
              </dl>

              {rec.referenceExamples && rec.referenceExamples.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {rec.referenceExamples.map((ex, j) => (
                    <span
                      key={j}
                      className="text-xs bg-[#F5F5F5] text-inkSoft rounded px-2 py-1"
                    >
                      예시: {ex}
                    </span>
                  ))}
                </div>
              )}

              <p className="text-xs text-warn border-t border-paperLine pt-3">
                ⚠️ {rec.caution}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
