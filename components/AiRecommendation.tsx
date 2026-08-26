'use client';

import { useState } from 'react';
import {
  runCategoryRecommendation,
  runProductRecommendation,
  type ProductRecommendation,
} from '@/app/dashboard/sourcing/trends/actions';
import type { CategoryRecommendation, Season } from '@/lib/ai';

const SEASON_OPTIONS: { value: Season; label: string }[] = [
  { value: 'summer', label: '여름 시즌' },
  { value: 'winter', label: '겨울 시즌' },
  { value: 'all', label: '사계절' },
];

export default function AiRecommendation() {
  const [season, setSeason] = useState<Season>('summer');
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categories, setCategories] = useState<CategoryRecommendation[] | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<ProductRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCategoryClick() {
    setLoadingCategories(true);
    setError(null);
    setCategories(null);
    setProducts(null);
    setSelectedCategory(null);
    try {
      const res = await runCategoryRecommendation(season);
      if (!res) setError('응답이 없어요 (시간 초과일 수 있어요). 다시 시도해주세요.');
      else if ('error' in res) setError(res.error);
      else setCategories(res.categories);
    } catch (e: any) {
      setError(e?.message || '오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoadingCategories(false);
    }
  }

  async function handlePickCategory(category: string) {
    setSelectedCategory(category);
    setLoadingProducts(true);
    setError(null);
    setProducts(null);
    try {
      const res = await runProductRecommendation(category, season);
      if (!res) setError('응답이 없어요 (시간 초과일 수 있어요). 다시 시도해주세요.');
      else if ('error' in res) setError(res.error);
      else setProducts(res.recommendations);
    } catch (e: any) {
      setError(e?.message || '오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoadingProducts(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8">
      <h2 className="text-lg font-bold mb-1">AI 소싱 추천</h2>
      <p className="text-sm text-inkSoft mb-5">
        쿠팡 전체 판매 랭킹(다른 셀러 포함, 실시간 조회)을 근거로 카테고리 →
        구체 상품 → 알리바바 소싱 후보까지 순서대로 추천해줘요.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        {SEASON_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSeason(opt.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              season === opt.value
                ? 'bg-ink text-white border-ink'
                : 'border-paperLine text-inkSoft hover:border-ink'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={handleCategoryClick}
          disabled={loadingCategories}
          className="btn-primary px-5 py-2 text-sm font-semibold sm:ml-auto disabled:opacity-50"
        >
          {loadingCategories ? '분석 중...' : '카테고리 추천받기'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-warn bg-warnBg rounded-md px-4 py-3 mb-4">{error}</p>
      )}

      {categories && categories.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-inkSoft mb-2">
            카테고리를 선택하면 구체 상품을 추천해드려요
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((c, i) => (
              <button
                key={i}
                onClick={() => handlePickCategory(c.category)}
                title={c.reason}
                className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                  selectedCategory === c.category
                    ? 'bg-accentBg border-accent text-accent font-semibold'
                    : 'border-paperLine hover:border-ink'
                }`}
              >
                {c.category}
              </button>
            ))}
          </div>
          {selectedCategory && (
            <p className="text-xs text-inkSoft mt-2">
              {categories.find((c) => c.category === selectedCategory)?.reason}
            </p>
          )}
        </div>
      )}

      {loadingProducts && (
        <p className="text-sm text-inkSoft">
          쿠팡 판매 랭킹과 알리바바 소싱 후보를 실시간으로 조회하는 중이에요.
          알리바바는 봇 차단 때문에 느릴 수 있어서 최대 1~2분 정도 걸릴 수
          있어요...
        </p>
      )}

      {products && products.length === 0 && !loadingProducts && (
        <p className="text-sm text-inkSoft">추천할 만한 결과를 찾지 못했어요. 다른 카테고리로 시도해보세요.</p>
      )}

      {products && products.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {products.map((p, i) => (
            <div key={i} className="rounded-lg border border-paperLine p-5">
              <h3 className="text-base font-bold mb-1.5">{p.item}</h3>
              <p className="text-sm text-ink mb-3">{p.reason}</p>

              <dl className="space-y-1.5 text-xs mb-3">
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-inkSoft">📊 수요 근거</dt>
                  <dd className="text-inkSoft">{p.criteria.demand}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="shrink-0 font-semibold text-inkSoft">🗓️ 시기</dt>
                  <dd className="text-inkSoft">{p.criteria.seasonality}</dd>
                </div>
              </dl>

              {p.coupangReferences.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-inkSoft mb-1">
                    쿠팡 판매중 (참고)
                  </p>
                  <ul className="space-y-1">
                    {p.coupangReferences.map((r, j) => (
                      <li key={j}>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline"
                        >
                          {r.name}
                          {r.price ? ` · ${r.price}원` : ''}
                          {r.reviewCount ? ` · 리뷰 ${r.reviewCount}개` : ''}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {p.sourcingLinks.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-inkSoft mb-1">
                    알리바바 소싱 후보
                  </p>
                  <ul className="space-y-1">
                    {p.sourcingLinks.map((s, j) => (
                      <li key={j}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline"
                        >
                          {s.name}
                          {s.price ? ` · ${s.price}` : ''}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-warn border-t border-paperLine pt-3">
                ⚠️ {p.caution}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
