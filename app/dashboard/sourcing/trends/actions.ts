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
  season: Season
): Promise<{ categories: CategoryRecommendation[] } | { error: string }> {
  const naverSummary = await fetchNaverTrendSummary();
  const contextSummary = naverSummary
    ? `[네이버 쇼핑인사이트 카테고리별 트렌드]\n${naverSummary}`
    : null;

  try {
    const categories = await recommendCategories({ season, contextSummary });
    return { categories };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export interface ProductRecommendation {
  item: string;
  reason: string;
  criteria: { demand: string; seasonality: string };
  coupangReferences: {
    name: string;
    price: string | null;
    reviewCount: string | null;
    url: string;
  }[];
  sourcingLinks: { name: string; price: string | null; url: string }[];
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
    keywords = (await suggestCandidateKeywords({ category, season })).slice(0, 3);
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }

  if (keywords.length === 0) {
    return { error: '후보 키워드를 생성하지 못했어요.' };
  }

  const coupangResults = await Promise.all(
    keywords.map(async ({ ko }) => ({
      keyword: ko,
      coupang: await fetchCoupangBestsellers(ko, 5).catch(() => []),
    }))
  );

  const findings: KeywordFinding[] = coupangResults.map(({ keyword, coupang }) => {
    if (coupang.length === 0) {
      return { keyword, coupangSummary: '쿠팡 조회 실패/데이터 없음', hasAlibaba: false };
    }
    const top = coupang[0];
    const summary = `1위 "${top.name}" (리뷰 ${top.reviewCount ?? '?'}개, ${
      top.price ?? '?'
    }원), 총 ${coupang.length}개 상품 확인됨`;
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

  // 최종 확정된 키워드만 알리바바 소싱 후보를 조회 (느려서 최소화)
  const enMap = new Map(keywords.map((k) => [k.ko, k.en]));
  const alibabaByKeyword = new Map(
    await Promise.all(
      drafts.map(async (d) => {
        const en = enMap.get(d.keyword);
        const alibaba = en ? await fetchAlibabaProducts(en, 3).catch(() => []) : [];
        return [d.keyword, alibaba] as const;
      })
    )
  );

  const recommendations: ProductRecommendation[] = drafts
    .map((d) => {
      const match = coupangResults.find((s) => s.keyword === d.keyword);
      if (!match) return null;
      return {
        item: d.displayName,
        reason: d.reason,
        criteria: d.criteria,
        coupangReferences: match.coupang.slice(0, 3).map((c) => ({
          name: c.name,
          price: c.price,
          reviewCount: c.reviewCount,
          url: c.url,
        })),
        sourcingLinks: (alibabaByKeyword.get(d.keyword) || []).map((a) => ({
          name: a.name,
          price: a.price,
          url: a.url,
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
