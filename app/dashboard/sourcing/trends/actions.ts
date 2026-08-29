'use server';

import {
  fetchSearchTrend,
  fetchShoppingCategoryTrend,
  fetchShoppingKeywordTrend,
  SHOPPING_CATEGORIES,
  type TimeUnit,
} from '@/lib/naver';
import {
  recommendCategories,
  finalizeCategoryRecommendations,
  suggestCandidateKeywords,
  finalizeProductRecommendations,
  refineAlibabaSearchTerms,
  translateProductNames,
  recommendFromKnowledgeOnly,
  type Season,
  type CategoryRecommendation as CategoryDraft,
  type CategoryFinding,
  type KeywordFinding,
  type MarketScaleTier,
  type CompetitionTier,
} from '@/lib/ai';
import { fetchCoupangBestsellers, fetchAlibabaProducts, type CoupangBestseller } from '@/lib/brightdata';

export type { MarketScaleTier, CompetitionTier };

export interface MarketBadges {
  marketScaleLabel: string; // "매우 큼" / "큼" / "중간" / "작음" / "매우 작음"
  marketScaleTier: MarketScaleTier;
  medianReviewCount: number; // 시장규모 판정 기준값
  topReviewCount: number; // 참고용 (목록 내 최다 리뷰)
  competitionLabel: string; // "낮음" / "보통" / "높음"
  competitionTier: CompetitionTier;
  meaningfulCompetitorCount: number; // 경쟁강도 판정 기준값
  productCount: number; // 참고용 (조회된 상품 수 - fetch 제한값이라 경쟁강도 근거로 안 씀)
  priceRange: string;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 실제 쿠팡 검색 결과 목록 하나를 받아서 시장규모/경쟁강도 뱃지 + AI에게
// 줄 요약 텍스트를 만든다. 카테고리 검증 단계와 상품 검증 단계 둘 다에서
// 쓰는 공통 로직이라 여기 한 곳에 모아둠.
function analyzeCoupangResults(
  coupang: CoupangBestseller[]
): { badges: MarketBadges; summary: string; productListText: string } | null {
  if (coupang.length === 0) return null;

  const reviewCounts = coupang.map(
    (c) => Number((c.reviewCount || '0').replace(/,/g, '')) || 0
  );
  // 예전엔 "목록 내 리뷰 최다 상품"(max) 하나로 시장규모를 판정했는데,
  // 상품 하나만 튀어도(단일 히트상품) 전체 시장이 "매우 큼"으로 잘못
  // 판정되는 문제가 있었다. 중앙값을 쓰면 "이 목록의 상품들이 대체로
  // 어느 정도 팔리는지"를 더 왜곡 없이 반영한다.
  const maxReviews = Math.max(...reviewCounts);
  const medianReviews = median(reviewCounts);
  const totalReviews = reviewCounts.reduce((a, b) => a + b, 0);
  const topByReviews = coupang[reviewCounts.indexOf(maxReviews)];

  const [marketScaleLabel, marketScaleTier, scaleDesc]: [string, MarketScaleTier, string] =
    medianReviews >= 3000
      ? ['매우 큼', 'very-high', '매우 큰 시장 (검증된 강한 수요)']
      : medianReviews >= 1000
      ? ['큼', 'high', '큰 시장 (수요 확실)']
      : medianReviews >= 300
      ? ['중간', 'mid', '중간 규모 시장']
      : medianReviews >= 50
      ? ['작음', 'low', '작은 시장 (니치, 신중 필요)']
      : ['매우 작음', 'very-low', '매우 작은 시장 (수요 거의 없음 - 비추천 가능성 높음)'];

  // 검색 결과 상품 "개수"는 우리가 fetch할 때 지정한 limit(예: 10개)에
  // 그냥 다 차면 나오는 숫자라 경쟁강도랑 무관하다. 대신 "리뷰 300개
  // 이상(=니치 시장 상한선) 확보한, 진짜 검증된 경쟁자가 몇 명인지"로
  // 경쟁강도를 판정한다.
  const meaningfulCompetitorCount = reviewCounts.filter((r) => r >= 300).length;
  const [competitionLabel, competitionTier]: [string, CompetitionTier] =
    meaningfulCompetitorCount >= 6
      ? ['높음', 'high']
      : meaningfulCompetitorCount >= 3
      ? ['보통', 'mid']
      : ['낮음', 'low'];

  const prices = coupang.map((c) => Number((c.price || '').replace(/,/g, ''))).filter((p) => p > 0);
  const priceRange =
    prices.length > 0
      ? `${Math.min(...prices).toLocaleString()}~${Math.max(...prices).toLocaleString()}원`
      : '가격 정보 없음';

  const top = coupang[0];
  const summary = `판매량 1위 "${top.name}" (리뷰 ${top.reviewCount ?? '0'}개, ${
    top.price ?? '?'
  }원). 목록 내 리뷰 중앙값 ${medianReviews.toLocaleString()}개(최다는 "${topByReviews.name}" ${maxReviews.toLocaleString()}개) - 시장 규모는 중앙값 기준으로 판정: ${scaleDesc}. 리뷰 300개 이상인 검증된 경쟁자 ${meaningfulCompetitorCount}명 확인 - 경쟁강도 ${competitionLabel}. 목록 전체 리뷰 합계 ${totalReviews.toLocaleString()}개, 총 ${
    coupang.length
  }개 상품 확인됨, 가격 분포 ${priceRange}`;

  const productListText = coupang
    .map(
      (c, i) =>
        `${i + 1}. "${c.name}" - 리뷰 ${c.reviewCount ?? '0'}개, ${c.price ?? '?'}원`
    )
    .join('\n');

  return {
    badges: {
      marketScaleLabel,
      marketScaleTier,
      medianReviewCount: medianReviews,
      topReviewCount: maxReviews,
      competitionLabel,
      competitionTier,
      meaningfulCompetitorCount,
      productCount: coupang.length,
      priceRange,
    },
    summary,
    productListText,
  };
}

async function fetchNaverTrendSummary(): Promise<string | null> {
  const timeUnit: TimeUnit = 'week';
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 4);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  const chunks: (typeof SHOPPING_CATEGORIES)[number][][] = [];
  for (let i = 0; i < SHOPPING_CATEGORIES.length; i += 3) {
    chunks.push(SHOPPING_CATEGORIES.slice(i, i + 3));
  }

  const summaries: string[] = [];
  try {
    for (const chunk of chunks) {
      const res = await fetchShoppingCategoryTrend({
        startDate,
        endDate,
        timeUnit,
        categories: chunk.map((c) => ({ name: c.name, param: [c.code] })),
      });
      for (const r of res.results) {
        const data = r.data;
        if (data.length < 2) continue;
        const half = Math.floor(data.length / 2);
        const first = data.slice(0, half);
        const second = data.slice(half);
        const avg = (arr: { ratio: number }[]) =>
          arr.reduce((s, d) => s + d.ratio, 0) / arr.length;
        const a1 = avg(first);
        const a2 = avg(second);
        const change = a1 === 0 ? 0 : ((a2 - a1) / a1) * 100;
        summaries.push(
          `- ${r.title}: 최근 관심도 ${a2.toFixed(1)} (이전 대비 ${
            change >= 0 ? '+' : ''
          }${change.toFixed(1)}%)`
        );
      }
    }
  } catch {
    return null; // 네이버 데이터랩 연동 실패 - 계정 이슈로 막혀있을 수 있음
  }
  return summaries.length > 0 ? summaries.join('\n') : null;
}

export interface CategoryRecommendation {
  category: string;
  reason: string;
  verified: boolean; // false면 실데이터 검증 없이 AI 브레인스토밍 그대로
  badges: MarketBadges | null;
}

// 1단계: 시즌 선택 + 네이버 트렌드(되면)로 카테고리 후보를 먼저
// 브레인스토밍한 다음, 후보마다 그 이름으로 실제 쿠팡 검색을 해서
// 시장규모/경쟁강도를 실측하고, 그 실데이터로 최종 카테고리를 확정한다.
// "주 판매 채널이 쿠팡"이라는 요청에 맞춰 카테고리 단계부터 실데이터로
// 검증하도록 함. 우리 스토어의 과거 판매 데이터는 일부러 근거로 안 쓴다
// - 이미 팔던 걸 근거 삼으면 새로운 소싱 기회를 찾는다는 목적과 순환논리가
// 되기 때문.
export async function runCategoryRecommendation(
  season: Season,
  excludeCategories: string[] = []
): Promise<{ categories: CategoryRecommendation[] } | { error: string }> {
  const stageStart = Date.now();
  const naverSummary = await fetchNaverTrendSummary();
  const contextSummary = naverSummary
    ? `[네이버 쇼핑인사이트 카테고리별 트렌드]\n${naverSummary}`
    : null;

  let candidates: CategoryDraft[];
  try {
    candidates = await recommendCategories({ season, contextSummary, excludeCategories });
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  if (candidates.length === 0) {
    return { categories: [] };
  }

  // 후보 카테고리 이름 그대로 쿠팡에서 실제 검색해서 시장규모/경쟁강도를
  // 실측한다. 예전엔 4개씩 배치로 순차 처리했는데, 캡차 실패율이 높다
  // 보니 순차 라운드가 늘어날수록 전체 시간만 늘고(서버리스 타임아웃
  // 위험) 실패율은 그대로였다. 한 번에 다 병렬로 쏘는 게 총 소요 시간을
  // (배치 수와 무관하게) 요청 1건의 최악 시간 수준으로 줄여준다.
  const coupangByCategory = new Map<string, CoupangBestseller[]>();
  const coupangCategoryResults = await Promise.all(
    candidates.map(async (c) => ({
      category: c.category,
      coupang: await fetchCoupangBestsellers(c.category, 5).catch(() => []),
    }))
  );
  for (const r of coupangCategoryResults) coupangByCategory.set(r.category, r.coupang);

  // 캡차로 실패한 후보만 골라서, 시간이 충분히 남아있을 때만 한 번 더
  // 재시도해서 검증된 카테고리 수를 보강한다. 시간이 부족하면 건너뛰어서
  // 서버리스 타임아웃 위험을 피한다. (실측: 재시도 없이도 전체 171초
  // 수준이라 300초 한도 안에서 재시도 여유가 있음)
  const CATEGORY_STAGE_BUDGET_MS = 270000;
  const CATEGORY_RETRY_WORST_CASE_MS = 90000;
  const failedCandidates = candidates.filter(
    (c) => (coupangByCategory.get(c.category) || []).length === 0
  );
  if (
    failedCandidates.length > 0 &&
    Date.now() - stageStart < CATEGORY_STAGE_BUDGET_MS - CATEGORY_RETRY_WORST_CASE_MS
  ) {
    const retryResults = await Promise.all(
      failedCandidates.map(async (c) => ({
        category: c.category,
        coupang: await fetchCoupangBestsellers(c.category, 5).catch(() => []),
      }))
    );
    for (const r of retryResults) {
      if (r.coupang.length > 0) coupangByCategory.set(r.category, r.coupang);
    }
  }

  const badgesByCategory = new Map<string, MarketBadges>();
  const findings: CategoryFinding[] = candidates.map((c) => {
    const coupang = coupangByCategory.get(c.category) || [];
    const analysis = analyzeCoupangResults(coupang);
    if (!analysis) return { category: c.category, summary: '쿠팡 조회 실패/데이터 없음' };
    badgesByCategory.set(c.category, analysis.badges);
    return { category: c.category, summary: analysis.summary };
  });

  // 전부 데이터가 없으면(스크래핑 전멸) 검증 없이 브레인스토밍 결과라도
  // 그대로 보여준다 - 빈 결과보다 낫다.
  if (badgesByCategory.size === 0) {
    return {
      categories: candidates.map((c) => ({
        category: c.category,
        reason: c.reason,
        verified: false,
        badges: null,
      })),
    };
  }

  let finalized: CategoryDraft[];
  try {
    finalized = await finalizeCategoryRecommendations({ season, findings });
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  const categories: CategoryRecommendation[] = finalized
    .map((f): CategoryRecommendation | null => {
      const badges = badgesByCategory.get(f.category);
      if (!badges) return null; // 실데이터 없는 카테고리는 검증 실패로 보고 제외
      return { category: f.category, reason: f.reason, verified: true, badges };
    })
    .filter((c): c is CategoryRecommendation => c !== null);

  return { categories };
}

export interface ProductRecommendation {
  item: string;
  reason: string;
  verified: boolean; // false면 실시간 데이터 없이 AI 일반 지식만으로 추천된 것
  criteria: { demand: string; competition: string; seasonality: string } | null;
  badges: MarketBadges | null;
  coupangReferences: {
    name: string;
    price: string | null;
    reviewCount: string | null;
    url: string;
    imageUrl: string | null;
  }[];
  sourcingLinks: {
    name: string;
    nameKo: string;
    price: string | null;
    url: string;
    imageUrl: string | null;
  }[];
  caution: string;
}

// 2단계: 카테고리 안에서 실제 쿠팡 판매 랭킹(시장 전체)을 먼저 조회해서
// AI가 후보를 추리고, 최종 확정된 것만 알리바바 소싱 후보를 조회한다.
// 알리바바는 봇 차단이 강해서 요청 1건에 최대 1분 가까이 걸리기 때문에,
// 모든 후보에 대해 미리 돌리면 서버 시간제한을 넘기므로 이렇게 순서를
// 나눴다.
export async function runProductRecommendation(
  category: string,
  season: Season
): Promise<{ recommendations: ProductRecommendation[] } | { error: string }> {
  let keywords: { ko: string; en: string }[];
  try {
    keywords = (await suggestCandidateKeywords({ category, season })).slice(0, 4);
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  if (keywords.length === 0) {
    return { error: '검색어를 생성하지 못했어요.' };
  }

  // 예전엔 "한꺼번에 쏘면 다 같이 실패한다"고 보고 3개씩 순차 배치했는데,
  // 실측해보니 그 "다 같이 실패"의 진짜 원인은 경합이 아니라 별도 버그
  // (빈 응답을 성공으로 오판해서 재시도를 안 함, brightdata.ts에서 수정함)
  // 였다. 버그를 고친 뒤 10개 동시 요청도 60%대로 정상 성공하는 걸
  // 확인했으므로 순차 배치를 없애고 한 번에 병렬로 쏜다 - 총 소요 시간이
  // 배치 수와 무관하게 요청 1건의 최악 시간 수준으로 줄어든다. limit도
  // 8로 늘려서 검색어당 더 풍부한 실제 상품 풀을 확보 - AI가 이 안에서
  // "진짜 메인 상품"을 골라야 하기 때문에 후보가 많을수록 좋다.
  // 실측 결과 이 단계 이후(finalize/알리바바 조회/번역)까지 포함해서
  // 정상 케이스도 280초 안팎으로 300초 한도에 거의 붙어있어서, 여기서
  // 실패 후 재시도를 넣을 시간 여유가 없다. 재시도는 안 하고 대신
  // 아래에서 알리바바 조회 자체의 최악 시간을 줄여서 여유를 확보한다.
  const coupangResults = await Promise.all(
    keywords.map(async ({ ko }) => ({
      keyword: ko,
      coupang: await fetchCoupangBestsellers(ko, 8).catch(() => []),
    }))
  );

  // 쿠팡 스크래핑이 (캡차 차단 등으로) 후보 전부 실패했으면, 빈 결과를
  // 보여주는 대신 AI 일반 지식으로라도 추천한다 - "실시간 데이터 아님"을
  // 명확히 표시해서 보여준다.
  if (coupangResults.every((r) => r.coupang.length === 0)) {
    try {
      const fallback = await recommendFromKnowledgeOnly(category, season);
      return {
        recommendations: fallback.map((f) => ({
          item: f.item,
          reason: f.reason,
          verified: false,
          criteria: null,
          badges: null,
          coupangReferences: [],
          sourcingLinks: [],
          caution: f.caution,
        })),
      };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  }

  const badgesByKeyword = new Map<string, MarketBadges>();
  const findings: KeywordFinding[] = coupangResults.map(({ keyword, coupang }) => {
    const analysis = analyzeCoupangResults(coupang);
    if (!analysis) return { keyword, productListText: '(검색 결과 없음)', hasData: false };
    badgesByKeyword.set(keyword, analysis.badges);
    return { keyword, productListText: analysis.productListText, hasData: true };
  });

  let drafts;
  try {
    // 알리바바 조회를 최종 상품 개수만큼 돌려야 해서(느림), 서버 시간
    // 제한을 넘기지 않도록 최대 4개로 강제 제한한다 (프롬프트에도
    // 지시했지만 안전장치로 코드에서도 자름).
    drafts = (await finalizeProductRecommendations({ category, season, findings })).slice(0, 3);
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  // AI가 고른 "대표 상품명"을 실제 쿠팡 검색 결과 목록에서 정확히 찾아서
  // 이미지/가격/URL 같은 사실 데이터를 붙인다 (AI가 링크를 지어내지
  // 않도록 - 완전히 못 찾으면 이 추천은 버린다).
  function findRepresentative(keyword: string, name: string): CoupangBestseller | undefined {
    const pool = coupangResults.find((r) => r.keyword === keyword)?.coupang || [];
    return (
      pool.find((c) => c.name === name) ||
      pool.find((c) => c.name.includes(name) || name.includes(c.name))
    );
  }

  // 최종 확정된 상품만 알리바바 소싱 후보를 조회 (느려서 최소화). 실제
  // 쿠팡에서 잘 팔리는 대표 상품명을 보고 검색어를 다시 만들어서 연관도를
  // 높인다.
  const refinedTerms = await refineAlibabaSearchTerms(
    drafts.map((d) => ({
      keyword: d.representativeProductName,
      topCoupangProductName: d.representativeProductName,
    }))
  ).catch((): Record<string, string> => ({}));

  const enMap = new Map(keywords.map((k) => [k.ko, k.en]));
  const alibabaByDraftIndex = await Promise.all(
    drafts.map(async (d) => {
      const en = refinedTerms[d.representativeProductName] || enMap.get(d.keyword);
      return en ? await fetchAlibabaProducts(en, 5).catch(() => []) : [];
    })
  );

  // 알리바바 상품명은 영문이라 한글 번역을 같이 붙여준다 (한 번에 배치 번역)
  const allAlibabaNames = alibabaByDraftIndex.flat().map((a) => a.name);
  const translations = await translateProductNames(allAlibabaNames).catch(
    () => allAlibabaNames
  );
  const translationMap = new Map(allAlibabaNames.map((name, i) => [name, translations[i]]));

  const recommendations: ProductRecommendation[] = drafts
    .map((d, i): ProductRecommendation | null => {
      const badges = badgesByKeyword.get(d.keyword);
      const rep = findRepresentative(d.keyword, d.representativeProductName);
      if (!badges || !rep) return null;
      const pool = coupangResults.find((r) => r.keyword === d.keyword)?.coupang || [];
      const alibaba = alibabaByDraftIndex[i] || [];
      return {
        item: d.displayName,
        reason: d.reason,
        verified: true,
        criteria: d.criteria,
        badges,
        coupangReferences: [rep, ...pool.filter((c) => c !== rep)].slice(0, 5).map((c) => ({
          name: c.name,
          price: c.price,
          reviewCount: c.reviewCount,
          url: c.url,
          imageUrl: c.imageUrl,
        })),
        sourcingLinks: alibaba.map((a) => ({
          name: a.name,
          nameKo: translationMap.get(a.name) || a.name,
          price: a.price,
          url: a.url,
          imageUrl: a.imageUrl,
        })),
        caution: d.caution,
      };
    })
    .filter((r): r is ProductRecommendation => r !== null);

  return { recommendations };
}

export async function runKeywordTrend(
  startDate: string,
  endDate: string,
  timeUnit: TimeUnit,
  groupInputs: string[] // 각 줄: "그룹명: 키워드1,키워드2" 또는 그냥 "키워드"
) {
  const keywordGroups = groupInputs
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((line) => {
      const [namePart, kwPart] = line.split(':');
      if (kwPart) {
        return {
          groupName: namePart.trim(),
          keywords: kwPart
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
        };
      }
      return { groupName: namePart.trim(), keywords: [namePart.trim()] };
    });

  if (keywordGroups.length === 0) {
    return { error: '키워드를 하나 이상 입력해주세요.' };
  }

  try {
    const result = await fetchSearchTrend({
      startDate,
      endDate,
      timeUnit,
      keywordGroups,
    });
    return { result };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runCategoryTrend(
  startDate: string,
  endDate: string,
  timeUnit: TimeUnit,
  categories: { name: string; param: string[] }[]
) {
  if (categories.length === 0) {
    return { error: '카테고리를 하나 이상 선택해주세요.' };
  }
  try {
    const result = await fetchShoppingCategoryTrend({
      startDate,
      endDate,
      timeUnit,
      categories,
    });
    return { result };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export async function runShoppingKeywordTrend(
  startDate: string,
  endDate: string,
  timeUnit: TimeUnit,
  categoryCode: string,
  keywordInputs: string[]
) {
  const keywords = keywordInputs
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((k) => ({ name: k, param: [k] }));

  if (!categoryCode) {
    return { error: '카테고리를 선택해주세요.' };
  }
  if (keywords.length === 0) {
    return { error: '키워드를 하나 이상 입력해주세요.' };
  }

  try {
    const result = await fetchShoppingKeywordTrend({
      startDate,
      endDate,
      timeUnit,
      categoryCode,
      keywords,
    });
    return { result };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export interface CoupangSnapshotItem {
  name: string;
  price: string | null;
  reviewCount: string | null;
  url: string;
  imageUrl: string | null;
}

// 네이버 트렌드 결과 옆에 나란히 보여줄 쿠팡 실제 판매 스냅샷 (다른 셀러
// 포함 시장 전체). 직접 비교 도구도 네이버만 보지 말고 쿠팡도 같이
// 보여달라는 요청으로 추가함.
export async function runCoupangSnapshot(
  titles: string[]
): Promise<Record<string, CoupangSnapshotItem[]>> {
  const uniqueTitles = [...new Set(titles.filter(Boolean))].slice(0, 5);

  const entries = await Promise.all(
    uniqueTitles.map(async (title) => {
      const items = await fetchCoupangBestsellers(title, 3).catch(() => []);
      return [
        title,
        items.map((c) => ({
          name: c.name,
          price: c.price,
          reviewCount: c.reviewCount,
          url: c.url,
          imageUrl: c.imageUrl,
        })),
      ] as const;
    })
  );

  return Object.fromEntries(entries);
}

export interface ProductSearchResult {
  coupang: CoupangSnapshotItem[];
  coupangError: string | null;
  // 그냥 쿠팡에서 검색해보는 것과 차별화하기 위한 부분 - 리뷰수 합계 등
  // 실데이터를 근거로 시장규모/경쟁강도/가격대를 계산해서 보여준다
  // (AI 소싱 추천에서 쓰는 것과 동일한 로직).
  badges: MarketBadges | null;
  // 네이버 쇼핑 상품 검색 API(v1/search/shop.json)는 2026-07-31부로
  // 완전히 종료되고 공식 대체 API가 없다 (데이터랩 트렌드만 NAVER API
  // HUB로 이관됨, 실제 상품 목록 검색은 이관 대상이 아니었음). 코드로
  // 고칠 수 있는 문제가 아니라서 항상 이 메시지를 고정으로 준다.
  naverUnavailable: string;
}

// 키워드 하나로 쿠팡에서 실제 판매중인 유사 상품을 찾아준다 (트렌드
// 추이가 아니라 지금 팔리고 있는 진짜 상품 목록). 그냥 쿠팡에서 검색해
// 보는 것과 다른 점: 리뷰수 합계/상품 개수/가격 분포를 계산해서
// 시장규모·경쟁강도·가격대를 뱃지로 보여준다.
export async function runProductSearch(keyword: string): Promise<ProductSearchResult> {
  const q = keyword.trim();
  const naverUnavailable =
    '네이버 쇼핑 상품 검색 API는 2026년 7월 31일부로 종료되어 더 이상 조회할 수 없어요 (네이버 측 공식 대체 API 없음). 네이버쇼핑은 직접 검색해서 확인해주세요.';
  if (!q) {
    return { coupang: [], coupangError: null, badges: null, naverUnavailable };
  }

  try {
    // 이 페이지는 요청 하나만 처리하고 maxDuration도 넉넉해서(180초),
    // 캡차 등으로 실패하면 시간이 남는 한 계속 재시도한다.
    const coupang = await fetchCoupangBestsellers(q, 10, { budgetMs: 150000 });
    const analysis = analyzeCoupangResults(coupang);
    return {
      coupang: coupang.map((c) => ({
        name: c.name,
        price: c.price,
        reviewCount: c.reviewCount,
        url: c.url,
        imageUrl: c.imageUrl,
      })),
      coupangError: null,
      badges: analysis?.badges ?? null,
      naverUnavailable,
    };
  } catch (e: any) {
    return { coupang: [], coupangError: e?.message || String(e), badges: null, naverUnavailable };
  }
}
