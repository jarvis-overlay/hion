'use client';

import { useState, type ReactNode } from 'react';
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

// 시장규모/경쟁강도 뱃지 색상 (RP-AI StatusBadge 패턴 참고 - dot + ring-inset pill)
type BadgeTier = 'good' | 'ok' | 'bad' | 'neutral';

type Badges = NonNullable<ProductRecommendation['badges']>;

const MARKET_TIER_COLOR: Record<Badges['marketScaleTier'], BadgeTier> = {
  'very-high': 'good',
  high: 'good',
  mid: 'ok',
  low: 'bad',
  'very-low': 'bad',
};

const COMPETITION_TIER_COLOR: Record<Badges['competitionTier'], BadgeTier> = {
  low: 'good',
  mid: 'ok',
  high: 'bad',
};

const BADGE_STYLE: Record<BadgeTier, string> = {
  good: 'bg-profitBg text-profit ring-1 ring-inset ring-profit/20',
  ok: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  bad: 'bg-warnBg text-warn ring-1 ring-inset ring-warn/20',
  neutral: 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine',
};

function Badge({ tier, children }: { tier: BadgeTier; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${BADGE_STYLE[tier]}`}
    >
      {children}
    </span>
  );
}

export default function AiRecommendation() {
  const [season, setSeason] = useState<Season>('summer');
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categories, setCategories] = useState<CategoryRecommendation[] | null>(null);
  const [seenCategories, setSeenCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<ProductRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCategoryClick() {
    setLoadingCategories(true);
    setError(null);
    setProducts(null);
    setSelectedCategory(null);
    try {
      const res = await runCategoryRecommendation(season, seenCategories);
      if (!res) setError('응답이 없어요 (시간 초과일 수 있어요). 다시 시도해주세요.');
      else if ('error' in res) setError(res.error);
      else {
        setCategories((prev) => [...(prev || []), ...res.categories]);
        setSeenCategories((prev) => [...prev, ...res.categories.map((c) => c.category)]);
      }
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
            onClick={() => {
              setSeason(opt.value);
              setSeenCategories([]);
            }}
            className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition ${
              season === opt.value
                ? 'bg-accent text-white shadow-glow'
                : 'bg-white text-inkSoft ring-1 ring-paperLine hover:bg-paper'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={handleCategoryClick}
          disabled={loadingCategories}
          className="btn-primary px-5 py-2.5 text-sm sm:ml-auto disabled:opacity-50"
        >
          {loadingCategories
            ? '분석 중...'
            : seenCategories.length > 0
            ? '다른 카테고리 더 보기'
            : '카테고리 추천받기'}
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
                className={`rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition ${
                  selectedCategory === c.category
                    ? 'bg-accent text-white shadow-glow'
                    : 'bg-white text-inkSoft ring-1 ring-paperLine hover:bg-paper'
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
            <div key={i} className="rounded-2xl ring-1 ring-paperLine p-5 sm:p-6">
              <h3 className="text-lg font-bold mb-2">{p.item}</h3>

              {!p.verified && (
                <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2 mb-3">
                  ⚠️ 실시간 쿠팡 데이터 조회에 실패해서(캡차 차단 등), AI의
                  일반 지식만으로 추천된 결과예요. 참고용으로만 봐주세요.
                </p>
              )}

              {p.badges && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <Badge tier={MARKET_TIER_COLOR[p.badges.marketScaleTier]}>
                    🔥 시장규모 {p.badges.marketScaleLabel} (리뷰 {p.badges.topReviewCount.toLocaleString()}개)
                  </Badge>
                  <Badge tier={COMPETITION_TIER_COLOR[p.badges.competitionTier]}>
                    ⚔️ 경쟁강도 {p.badges.competitionLabel} (상품 {p.badges.productCount}개)
                  </Badge>
                  <Badge tier="neutral">💰 {p.badges.priceRange}</Badge>
                </div>
              )}

              <p className="text-sm text-ink leading-relaxed mb-4">{p.reason}</p>

              {p.criteria && (
                <dl className="grid gap-2 text-xs mb-4 sm:grid-cols-3">
                  <div className="bg-paper rounded-md px-3 py-2">
                    <dt className="font-semibold text-inkSoft mb-0.5">📊 수요 근거</dt>
                    <dd className="text-ink leading-relaxed">{p.criteria.demand}</dd>
                  </div>
                  <div className="bg-paper rounded-md px-3 py-2">
                    <dt className="font-semibold text-inkSoft mb-0.5">⚔️ 경쟁/전략</dt>
                    <dd className="text-ink leading-relaxed">{p.criteria.competition}</dd>
                  </div>
                  <div className="bg-paper rounded-md px-3 py-2">
                    <dt className="font-semibold text-inkSoft mb-0.5">🗓️ 시기 근거</dt>
                    <dd className="text-ink leading-relaxed">{p.criteria.seasonality}</dd>
                  </div>
                </dl>
              )}

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
                        className="flex gap-2 ring-1 ring-paperLine rounded-xl p-2 hover:ring-accent transition"
                      >
                        {r.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.imageUrl}
                            alt={r.name}
                            className="w-14 h-14 rounded object-cover shrink-0 bg-paperLine"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded shrink-0 bg-paperLine" />
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

              {p.verified && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-inkSoft mb-2">
                  알리바바 소싱 후보
                </p>
                {p.sourcingLinks.length === 0 ? (
                  <p className="text-xs text-inkSoft bg-paper rounded-md px-3 py-2">
                    알리바바 조회에 실패했거나 결과가 없어요. 알리바바 봇 차단
                    때문일 수 있으니, alibaba.com에서 직접 검색해보시는 걸
                    추천해요.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-3">
                    {p.sourcingLinks.map((s, j) => (
                      <a
                        key={j}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex gap-2 ring-1 ring-paperLine rounded-xl p-2 hover:ring-accent transition"
                      >
                        {s.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={s.imageUrl}
                            alt={s.nameKo}
                            className="w-14 h-14 rounded object-cover shrink-0 bg-paperLine"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded shrink-0 bg-paperLine" />
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
                )}
              </div>
              )}

              <p className="text-xs text-warn border-t border-paperLine/70 pt-3">
                ⚠️ {p.caution}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
