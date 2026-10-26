'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  runCategoryRecommendation,
  runProductRecommendation,
  addExcludedCategory,
  deleteExcludedCategory,
  type ProductRecommendation,
  type CategoryRecommendation,
  type StrategyKey,
  type CustomFilters,
} from '@/app/dashboard/sourcing/trends/actions';
import type { Season } from '@/lib/ai';
import { Badge, MarketBadgeRow, strategyBucket, type StrategyBucket, STRATEGY_OPTIONS } from '@/components/MarketBadge';

const SEASON_OPTIONS: { value: Season; label: string }[] = [
  { value: 'summer', label: '여름 시즌' },
  { value: 'winter', label: '겨울 시즌' },
  { value: 'all', label: '사계절' },
];

export default function AiRecommendation({
  excludedCategories,
}: {
  excludedCategories: { id: string; label: string }[];
}) {
  const [season, setSeason] = useState<Season>('all');
  const [strategy, setStrategy] = useState<StrategyKey | 'all'>('all');
  // "AI 자유 추천"은 지금까지와 동일하게 시즌/전략만으로 바로 찾고,
  // "조건 설정"은 아래 입력값(제외 카테고리/범위/리뷰수/가격)을 같이
  // 반영해서 찾는다 - 비슷비슷한 추천이 아니라 내 상황에 맞는 추천을
  // 받고 싶다는 요청으로 추가함.
  const [mode, setMode] = useState<'auto' | 'custom'>('auto');
  const [includeScope, setIncludeScope] = useState('');
  const [minReviewCount, setMinReviewCount] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [newExcludeLabel, setNewExcludeLabel] = useState('');
  const [isPendingExclude, startExcludeTransition] = useTransition();
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categories, setCategories] = useState<CategoryRecommendation[] | null>(null);
  // "더 보기"를 눌렀을 때 AI가 방금 전략 필터링으로 걸러진 후보를 또
  // 내놓지 않도록, 화면에 보여준 것뿐 아니라 서버가 훑어본 후보 전체를
  // 제외 목록으로 누적한다.
  const [seenCategories, setSeenCategories] = useState<string[]>([]);
  const [hasSearchedCategories, setHasSearchedCategories] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<ProductRecommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 카테고리를 연달아 클릭하면(예: 잘못 누르고 바로 다른 걸 누름) 두
  // 요청이 동시에 진행되다가 먼저 누른 요청이 나중에 끝나면 그 결과로
  // 화면이 덮어써지는 경쟁 상태가 있었다. 클릭마다 토큰을 새로 발급해서
  // 응답이 왔을 때 여전히 최신 클릭인지 확인 후에만 반영한다.
  const pickRequestRef = useRef(0);

  // "전체 보기"를 골랐을 때만 의미 있는 그룹화 - 특정 전략을 이미
  // 골랐으면 결과가 전부 그 전략 하나뿐이라 그룹 나눌 필요가 없다.
  const groupedCategories = useMemo(() => {
    if (!categories) return [];
    const buckets = new Map<string, { bucket: StrategyBucket | null; items: CategoryRecommendation[] }>();
    for (const c of categories) {
      const bucket = c.badges ? strategyBucket(c.badges) : null;
      const key = bucket ? bucket.key : 'unverified';
      if (!buckets.has(key)) buckets.set(key, { bucket, items: [] });
      buckets.get(key)!.items.push(c);
    }
    return [...buckets.values()].sort((a, b) => (a.bucket?.order ?? 99) - (b.bucket?.order ?? 99));
  }, [categories]);

  const selectedStrategyOption = STRATEGY_OPTIONS.find((o) => o.value === strategy)!;

  // "조건 설정" 모드일 때만 필터를 실제로 적용한다 - "AI 자유 추천"에서는
  // 입력값이 남아있어도 무시(모드 전환만으로 켜고 끌 수 있게).
  function buildCustomFilters(): CustomFilters | undefined {
    if (mode !== 'custom') return undefined;
    const scope = includeScope
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const filters: CustomFilters = {};
    if (scope.length > 0) filters.includeScope = scope;
    if (minReviewCount.trim()) filters.minReviewCount = Number(minReviewCount);
    if (minPrice.trim()) filters.minPrice = Number(minPrice);
    if (maxPrice.trim()) filters.maxPrice = Number(maxPrice);
    return filters;
  }

  async function fetchCategories() {
    setLoadingCategories(true);
    setError(null);
    setProducts(null);
    setSelectedCategory(null);
    try {
      // 저장해둔 제외 카테고리(조건 모드에서 관리) + 이번 세션에서 이미
      // 본 카테고리를 합쳐서 전달한다.
      const excludeList = [...excludedCategories.map((e) => e.label), ...seenCategories];
      const res = await runCategoryRecommendation(season, excludeList, strategy, buildCustomFilters());
      if (!res) setError('응답이 없어요 (시간 초과일 수 있어요). 다시 시도해주세요.');
      else if ('error' in res) setError(res.error);
      else {
        // 서버에서도 걸러주지만(코드 레벨), 혹시 모를 중복을 화면에서도
        // 한 번 더 막는다 - 같은 카테고리명이 서로 다른 실시간 쿠팡
        // 스크래핑 결과(=다른 badges)와 함께 두 번 쌓이면 골든타임/
        // 레드오션처럼 모순된 전략에 동시에 나타나 보이는 버그가 있었음.
        setCategories((prev) => {
          const existing = new Set((prev || []).map((c) => c.category.trim().toLowerCase()));
          const fresh = res.categories.filter((c) => !existing.has(c.category.trim().toLowerCase()));
          return [...(prev || []), ...fresh];
        });
        setSeenCategories((prev) => [...prev, ...res.consideredCategories]);
        setHasSearchedCategories(true);
      }
    } catch (e: any) {
      setError(e?.message || '오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoadingCategories(false);
    }
  }

  async function handlePickCategory(category: string) {
    const requestId = ++pickRequestRef.current;
    setSelectedCategory(category);
    setLoadingProducts(true);
    setError(null);
    setProducts(null);
    try {
      const res = await runProductRecommendation(category, season, buildCustomFilters());
      if (pickRequestRef.current !== requestId) return; // 그 사이 다른 카테고리를 클릭함 - 이 응답은 버림
      if (!res) setError('응답이 없어요 (시간 초과일 수 있어요). 다시 시도해주세요.');
      else if ('error' in res) setError(res.error);
      else setProducts(res.recommendations);
    } catch (e: any) {
      if (pickRequestRef.current !== requestId) return;
      setError(e?.message || '오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      if (pickRequestRef.current === requestId) setLoadingProducts(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8">
      <h2 className="text-lg font-bold mb-1">AI 소싱 추천</h2>
      <p className="text-sm text-inkSoft mb-5">
        쿠팡 전체 판매 랭킹(다른 셀러 포함, 실시간 조회)을 근거로 시즌 →
        전략 → 카테고리 → 구체 상품 → 알리바바 소싱 후보까지 단계별로
        길을 안내해드려요.
      </p>

      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-inkSoft mb-2">
          1단계 · 시즌
        </p>
        <div className="flex flex-wrap gap-2">
          {SEASON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setSeason(opt.value);
                setSeenCategories([]);
                setCategories(null);
                setHasSearchedCategories(false);
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
        </div>
      </div>

      <div className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-inkSoft mb-2">
          2단계 · 소싱 전략
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          {STRATEGY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setStrategy(opt.value);
                setSeenCategories([]);
                setCategories(null);
                setHasSearchedCategories(false);
              }}
              className={`text-left rounded-xl p-3 transition ${
                strategy === opt.value
                  ? 'bg-accentBg ring-2 ring-accent'
                  : 'bg-white ring-1 ring-paperLine hover:ring-accent'
              }`}
            >
              <div className="text-sm font-bold mb-0.5">
                {opt.icon} {opt.label}
              </div>
              <p className="text-[11px] text-inkSoft leading-snug">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-inkSoft mb-2">
          3단계 · 추천 방식
        </p>
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => {
              setMode('auto');
              setSeenCategories([]);
              setCategories(null);
              setHasSearchedCategories(false);
            }}
            className={`flex-1 rounded-xl p-3 text-left transition ${
              mode === 'auto' ? 'bg-accentBg ring-2 ring-accent' : 'bg-white ring-1 ring-paperLine hover:ring-accent'
            }`}
          >
            <div className="text-sm font-bold mb-0.5">🤖 AI 자유 추천</div>
            <p className="text-[11px] text-inkSoft leading-snug">조건 없이 AI가 알아서 찾아줘요</p>
          </button>
          <button
            onClick={() => {
              setMode('custom');
              setSeenCategories([]);
              setCategories(null);
              setHasSearchedCategories(false);
            }}
            className={`flex-1 rounded-xl p-3 text-left transition ${
              mode === 'custom' ? 'bg-accentBg ring-2 ring-accent' : 'bg-white ring-1 ring-paperLine hover:ring-accent'
            }`}
          >
            <div className="text-sm font-bold mb-0.5">🎯 조건 설정</div>
            <p className="text-[11px] text-inkSoft leading-snug">내가 정한 조건 안에서 찾아줘요</p>
          </button>
        </div>

        {mode === 'custom' && (
          <div className="grid gap-3 bg-paper rounded-xl p-4">
            <div>
              <p className="text-xs font-semibold text-inkSoft mb-1.5">
                제외 카테고리 (이미 하는 중이거나 피하고 싶은 상품군)
              </p>
              {excludedCategories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {excludedCategories.map((c) => (
                    <span
                      key={c.id}
                      className="flex items-center gap-1 text-[11px] bg-white ring-1 ring-paperLine rounded-full pl-2.5 pr-1.5 py-1"
                    >
                      {c.label}
                      <button
                        onClick={() => startExcludeTransition(() => deleteExcludedCategory(c.id))}
                        disabled={isPendingExclude}
                        className="text-inkSoft hover:text-red-700"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={newExcludeLabel}
                  onChange={(e) => setNewExcludeLabel(e.target.value)}
                  placeholder="예: 주방용품"
                  className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1 rounded"
                />
                <button
                  onClick={() => {
                    if (!newExcludeLabel.trim()) return;
                    startExcludeTransition(() => addExcludedCategory(newExcludeLabel.trim()));
                    setNewExcludeLabel('');
                  }}
                  disabled={isPendingExclude || !newExcludeLabel.trim()}
                  className="text-xs text-accent font-semibold px-2 disabled:opacity-40"
                >
                  + 추가
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-inkSoft mb-1.5">
                포함 범위 (이 안에서만 찾아줘요, 선택 입력)
              </p>
              <input
                value={includeScope}
                onChange={(e) => setIncludeScope(e.target.value)}
                placeholder="예: 욕실용품, 수납정리 (쉼표로 여러 개)"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full rounded"
              />
              <p className="text-[10px] text-inkSoft mt-1">
                ⚠️ 이 조건은 AI에게 지시만 하는 거라 100% 보장은 안 돼요.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-xs font-semibold text-inkSoft mb-1.5">최소 리뷰수</p>
                <input
                  type="number"
                  value={minReviewCount}
                  onChange={(e) => setMinReviewCount(e.target.value)}
                  placeholder="예: 500"
                  className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full rounded"
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-inkSoft mb-1.5">최소 가격(원)</p>
                <input
                  type="number"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="예: 10000"
                  className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full rounded"
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-inkSoft mb-1.5">최대 가격(원)</p>
                <input
                  type="number"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="예: 50000"
                  className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full rounded"
                />
              </div>
            </div>
            <p className="text-[10px] text-inkSoft -mt-1">
              ✅ 리뷰수/가격 조건은 실제 쿠팡 데이터로 코드에서 직접 걸러내서 100% 지켜져요.
            </p>
          </div>
        )}
      </div>

      <button
        onClick={() => fetchCategories()}
        disabled={loadingCategories}
        className="btn-primary px-5 py-2.5 text-sm w-full sm:w-auto disabled:opacity-50 mb-5"
      >
        {loadingCategories
          ? '분석 중...'
          : seenCategories.length > 0
          ? `${selectedStrategyOption.icon} 다른 카테고리 더 보기`
          : `${selectedStrategyOption.icon} 카테고리 추천받기`}
      </button>

      {loadingCategories && (
        <p className="text-sm text-inkSoft -mt-3 mb-5">
          쿠팡 실제 판매 데이터를 카테고리 8개에 대해 실시간으로 조회하는 중이에요. 1분 내외로
          걸릴 수 있어요...
        </p>
      )}

      {error && (
        <p className="text-sm text-warn bg-warnBg rounded-md px-4 py-3 mb-4">{error}</p>
      )}

      {hasSearchedCategories && categories && categories.length === 0 && !loadingCategories && (
        <p className="text-sm text-inkSoft bg-paper rounded-md px-4 py-3 mb-4">
          이번엔 "{selectedStrategyOption.label}" 전략에 맞는 카테고리를 실데이터로
          찾지 못했어요. 위 버튼을 다시 눌러서 더 찾아보거나, 다른 전략을
          선택해보세요.
        </p>
      )}

      {categories && categories.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-semibold text-inkSoft mb-3">
            {strategy === 'all'
              ? '쿠팡 실제 검색 데이터로 검증된 카테고리를 전략별로 묶었어요.'
              : `"${selectedStrategyOption.label}" 전략에 맞는, 쿠팡 실제 검색 데이터로 검증된 카테고리예요.`}{' '}
            선택하면 구체 상품을 추천해드려요.
          </p>
          {strategy === 'all' ? (
            groupedCategories.map((group, gi) => (
              <div key={gi} className="mb-5 last:mb-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm font-bold">
                    {group.bucket ? `${group.bucket.icon} ${group.bucket.label}` : '❔ 미검증'}
                  </span>
                </div>
                <p className="text-xs text-inkSoft leading-relaxed mb-2">
                  {group.bucket
                    ? group.bucket.blurb
                    : '실시간 쿠팡 데이터 조회에 실패해서 검증이 안 됐어요. 참고용으로만 봐주세요.'}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.items.map((c) => (
                    <CategoryCard
                      key={c.category}
                      category={c}
                      selected={selectedCategory === c.category}
                      onClick={() => handlePickCategory(c.category)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {categories.map((c) => (
                <CategoryCard
                  key={c.category}
                  category={c}
                  selected={selectedCategory === c.category}
                  onClick={() => handlePickCategory(c.category)}
                />
              ))}
            </div>
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
                <div className="mb-3">
                  <MarketBadgeRow
                    badges={p.badges}
                    scopeNote={
                      p.searchKeyword
                        ? `"${p.searchKeyword}" 검색어 기준 데이터예요 - 카테고리 전체 뱃지와 숫자가 다를 수 있어요.`
                        : undefined
                    }
                  />
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

function CategoryCard({
  category: c,
  selected,
  onClick,
}: {
  category: CategoryRecommendation;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-xl p-3 transition ${
        selected ? 'bg-accentBg ring-2 ring-accent' : 'bg-white ring-1 ring-paperLine hover:ring-accent'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm font-bold">{c.category}</span>
      </div>
      {c.badges && (
        <div className="mb-1.5">
          <MarketBadgeRow
            badges={c.badges}
            extra={
              c.naverTrend && (
                <Badge
                  tier={
                    c.naverTrend.direction === 'up'
                      ? 'good'
                      : c.naverTrend.direction === 'down'
                      ? 'bad'
                      : 'neutral'
                  }
                >
                  {c.naverTrend.direction === 'up' ? '📈' : c.naverTrend.direction === 'down' ? '📉' : '➖'} 네이버
                  관심도 {c.naverTrend.changePct >= 0 ? '+' : ''}
                  {c.naverTrend.changePct.toFixed(0)}%
                </Badge>
              )
            }
          />
        </div>
      )}
      <p className="text-xs text-inkSoft leading-relaxed">{c.reason}</p>
    </button>
  );
}
