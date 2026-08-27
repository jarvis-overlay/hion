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
  suggestCandidateKeywords,
  finalizeProductRecommendations,
  refineAlibabaSearchTerms,
  translateProductNames,
  recommendFromKnowledgeOnly,
  type Season,
  type CategoryRecommendation,
  type KeywordFinding,
} from '@/lib/ai';
import { fetchCoupangBestsellers, fetchAlibabaProducts } from '@/lib/brightdata';

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

// 1단계: 시즌 선택 + 네이버 트렌드(되면)를 근거로 소싱 카테고리를 추천한다.
// 우리 스토어의 과거 판매 데이터는 일부러 근거로 안 쓴다 - 이미 팔던 걸
// 근거 삼으면 새로운 소싱 기회를 찾는다는 목적과 순환논리가 되기 때문.
export async function runCategoryRecommendation(
  season: Season,
  excludeCategories: string[] = []
): Promise<{ categories: CategoryRecommendation[] } | { error: string }> {
  const naverSummary = await fetchNaverTrendSummary();
  const contextSummary = naverSummary
    ? `[네이버 쇼핑인사이트 카테고리별 트렌드]\n${naverSummary}`
    : null;

  try {
    const categories = await recommendCategories({ season, contextSummary, excludeCategories });
    return { categories };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export type MarketScaleTier = 'very-high' | 'high' | 'mid' | 'low' | 'very-low';
export type CompetitionTier = 'low' | 'mid' | 'high';

export interface ProductRecommendation {
  item: string;
  reason: string;
  verified: boolean; // false면 실시간 데이터 없이 AI 일반 지식만으로 추천된 것
  criteria: { demand: string; competition: string; seasonality: string } | null;
  badges: {
    marketScaleLabel: string; // "매우 큼" / "큼" / "중간" / "작음" / "매우 작음"
    marketScaleTier: MarketScaleTier;
    topReviewCount: number;
    competitionLabel: string; // "낮음" / "보통" / "높음"
    competitionTier: CompetitionTier;
    productCount: number;
    priceRange: string;
  } | null;
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
    keywords = (await suggestCandidateKeywords({ category, season })).slice(0, 6);
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  if (keywords.length === 0) {
    return { error: '후보 키워드를 생성하지 못했어요.' };
  }

  // 6개를 한꺼번에 병렬로 쏘면 같은 Bright Data 존 안에서 서로 경합해서
  // 오히려 다 같이 타임아웃 나는 경우가 많았다. 3개씩 나눠서 순차 처리
  // (배치 안에서는 병렬)하면 경합이 줄어서 개별 성공률이 올라간다.
  const COUPANG_BATCH_SIZE = 3;
  const coupangResults: { keyword: string; coupang: Awaited<ReturnType<typeof fetchCoupangBestsellers>> }[] = [];
  for (let i = 0; i < keywords.length; i += COUPANG_BATCH_SIZE) {
    const batch = keywords.slice(i, i + COUPANG_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ({ ko }) => ({
        keyword: ko,
        coupang: await fetchCoupangBestsellers(ko, 5).catch(() => []),
      }))
    );
    coupangResults.push(...batchResults);
  }

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

  const badgesByKeyword = new Map<string, ProductRecommendation['badges']>();

  const findings: KeywordFinding[] = coupangResults.map(({ keyword, coupang }) => {
    if (coupang.length === 0) {
      return { keyword, coupangSummary: '쿠팡 조회 실패/데이터 없음', hasAlibaba: false };
    }
    const reviewCounts = coupang.map(
      (c) => Number((c.reviewCount || '0').replace(/,/g, '')) || 0
    );
    // 쿠팡 "판매량순" 정렬은 최근 판매 속도 기준이라, 1위 상품이 꼭 리뷰가
    // 가장 많은 상품은 아니다 (예: 신상품이 급상승해서 1위여도 리뷰는
    // 적을 수 있음). 시장 "규모"를 판단할 땐 목록 전체에서 리뷰가 가장
    // 많은 상품 기준으로 봐야 왜곡이 없다.
    const maxReviews = Math.max(...reviewCounts);
    const totalReviews = reviewCounts.reduce((a, b) => a + b, 0);
    const topByReviews = coupang[reviewCounts.indexOf(maxReviews)];

    const [marketScaleLabel, marketScaleTier, scaleDesc]: [
      string,
      MarketScaleTier,
      string
    ] =
      maxReviews >= 3000
        ? ['매우 큼', 'very-high', '매우 큰 시장 (검증된 강한 수요)']
        : maxReviews >= 1000
        ? ['큼', 'high', '큰 시장 (수요 확실)']
        : maxReviews >= 300
        ? ['중간', 'mid', '중간 규모 시장']
        : maxReviews >= 50
        ? ['작음', 'low', '작은 시장 (니치, 신중 필요)']
        : ['매우 작음', 'very-low', '매우 작은 시장 (수요 거의 없음 - 비추천 가능성 높음)'];

    // 검색 결과 상품 개수가 많을수록 이미 셀러가 많이 들어와 있다는 뜻 -
    // 경쟁 강도의 단순 근사치로 사용
    const [competitionLabel, competitionTier]: [string, CompetitionTier] =
      coupang.length >= 5
        ? ['높음', 'high']
        : coupang.length >= 3
        ? ['보통', 'mid']
        : ['낮음', 'low'];

    const prices = coupang
      .map((c) => Number((c.price || '').replace(/,/g, '')))
      .filter((p) => p > 0);
    const priceRangeNum =
      prices.length > 0
        ? `${Math.min(...prices).toLocaleString()}~${Math.max(...prices).toLocaleString()}원`
        : '가격 정보 없음';

    badgesByKeyword.set(keyword, {
      marketScaleLabel,
      marketScaleTier,
      topReviewCount: maxReviews,
      competitionLabel,
      competitionTier,
      productCount: coupang.length,
      priceRange: priceRangeNum,
    });

    const top = coupang[0];
    const summary = `판매량 1위 "${top.name}" (리뷰 ${
      top.reviewCount ?? '0'
    }개, ${top.price ?? '?'}원). 목록 내 리뷰 최다 상품은 "${topByReviews.name}" (리뷰 ${maxReviews.toLocaleString()}개) - 시장 규모는 이 최댓값 기준으로 판정: ${scaleDesc}. 목록 전체 리뷰 합계 ${totalReviews.toLocaleString()}개, 총 ${
      coupang.length
    }개 상품 확인됨, 가격 분포 ${priceRangeNum}`;
    return { keyword, coupangSummary: summary, hasAlibaba: true };
  });

  let drafts;
  try {
    drafts = await finalizeProductRecommendations({
      category,
      season,
      findings,
    });
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  // 최종 확정된 키워드만 알리바바 소싱 후보를 조회 (느려서 최소화).
  // 카테고리 단계에서 미리 만든 일반적인 영어 키워드 대신, 실제 쿠팡에서
  // 잘 팔리는 상품명을 보고 검색어를 다시 만들어서 연관도를 높인다.
  const enMap = new Map(keywords.map((k) => [k.ko, k.en]));
  const topProductByKeyword = new Map(
    coupangResults.map(({ keyword, coupang }) => {
      const reviewCounts = coupang.map(
        (c) => Number((c.reviewCount || '0').replace(/,/g, '')) || 0
      );
      const top = coupang[reviewCounts.indexOf(Math.max(...reviewCounts, 0))];
      return [keyword, top?.name] as const;
    })
  );

  const refinedTerms = await refineAlibabaSearchTerms(
    drafts
      .map((d) => ({ keyword: d.keyword, topCoupangProductName: topProductByKeyword.get(d.keyword) }))
      .filter((d): d is { keyword: string; topCoupangProductName: string } => !!d.topCoupangProductName)
  ).catch((): Record<string, string> => ({}));

  const alibabaByKeyword = new Map(
    await Promise.all(
      drafts.map(async (d) => {
        const en = refinedTerms[d.keyword] || enMap.get(d.keyword);
        const alibaba = en ? await fetchAlibabaProducts(en, 5).catch(() => []) : [];
        return [d.keyword, alibaba] as const;
      })
    )
  );

  // 알리바바 상품명은 영문이라 한글 번역을 같이 붙여준다 (한 번에 배치 번역)
  const allAlibabaNames = [...alibabaByKeyword.values()].flat().map((a) => a.name);
  const translations = await translateProductNames(allAlibabaNames).catch(
    () => allAlibabaNames
  );
  const translationMap = new Map(allAlibabaNames.map((name, i) => [name, translations[i]]));

  const recommendations: ProductRecommendation[] = drafts
    .map((d): ProductRecommendation | null => {
      const match = coupangResults.find((s) => s.keyword === d.keyword);
      const badges = badgesByKeyword.get(d.keyword);
      if (!match || !badges) return null;
      return {
        item: d.displayName,
        reason: d.reason,
        verified: true,
        criteria: d.criteria,
        badges,
        coupangReferences: match.coupang.slice(0, 5).map((c) => ({
          name: c.name,
          price: c.price,
          reviewCount: c.reviewCount,
          url: c.url,
          imageUrl: c.imageUrl,
        })),
        sourcingLinks: (alibabaByKeyword.get(d.keyword) || []).map((a) => ({
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
