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
        <p className="text-sm text-inkSoft">
          추천할 만한 결과를 찾지 못했어요. 다른 카테고리로 시도해보세요.
        </p>
      )}

      {products && products.length > 0 && (
        <div className="space-y-5">
          {products.map((p, i) => (
            <div key={i} className="rounded-xl border border-paperLine p-5 sm:p-6">
              <h3 className="text-lg font-bold mb-1.5">{p.item}</h3>
              <p className="text-sm text-ink leading-relaxed mb-4">{p.reason}</p>

              <dl className="grid gap-2 text-xs mb-4 sm:grid-cols-2">
                <div className="bg-[#F7F7F7] rounded-md px-3 py-2">
                  <dt className="font-semibold text-inkSoft mb-0.5">📊 수요 근거</dt>
                  <dd className="text-ink leading-relaxed">{p.criteria.demand}</dd>
                </div>
                <div className="bg-[#F7F7F7] rounded-md px-3 py-2">
                  <dt className="font-semibold text-inkSoft mb-0.5">🗓️ 시기 근거</dt>
                  <dd className="text-ink leading-relaxed">{p.criteria.seasonality}</dd>
                </div>
              </dl>

              {p.coupangReferences.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-inkSoft mb-2">
                    쿠팡 판매중 (참고)
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {p.coupangReferences.map((r, j) => (
                      <a
                        key={j}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex gap-2 border border-paperLine rounded-lg p-2 hover:border-accent transition-colors"
                      >
                        {r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.imageUrl}
                            alt={r.name}
                            className="w-14 h-14 rounded object-cover shrink-0 bg-[#F0F0F0]"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded shrink-0 bg-[#F0F0F0]" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-ink line-clamp-2 leading-snug mb-1">
                            {r.name}
                          </p>
                          <p className="text-xs text-inkSoft">
                            {r.price ? `${r.price}원` : ''}
                            {r.reviewCount ? ` · 리뷰 ${r.reviewCount}개` : ''}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {p.sourcingLinks.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-inkSoft mb-2">
                    알리바바 소싱 후보
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {p.sourcingLinks.map((s, j) => (
                      <a
                        key={j}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex gap-2 border border-paperLine rounded-lg p-2 hover:border-accent transition-colors"
                      >
                        {s.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.imageUrl}
                            alt={s.nameKo}
                            className="w-14 h-14 rounded object-cover shrink-0 bg-[#F0F0F0]"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded shrink-0 bg-[#F0F0F0]" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-ink line-clamp-2 leading-snug mb-0.5">
                            {s.nameKo}
                          </p>
                          <p className="text-[11px] text-inkSoft line-clamp-1 mb-1">
                            {s.name}
                          </p>
                          <p className="text-xs text-accent font-medium">{s.price}</p>
                        </div>
                      </a>
                    ))}
                  </div>
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
