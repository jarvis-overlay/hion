'use server';

// 소싱 리스트 카드의 "비교 상품군" 섹션에서, 손으로 쿠팡을 검색해서 베껴
// 적지 않고 이미 있는 쿠팡 실데이터 수집 로직(lib/brightdata.ts)을 그대로
// 재사용해서 후보를 자동으로 조사해준다. 캡차/타임아웃 등 실패는 흔하므로
// (AI 소싱 추천 쪽에서 실측 확인된 패턴) 절대 throw하지 않고 한국어 에러
// 문구로 돌려준다 - 실패해도 기존 수동 입력 폼이 같은 섹션에 그대로 있어서
// 사용자가 계속 작업할 수 있다.
import { fetchCoupangBestsellers } from '@/lib/brightdata';
import { analyzeCoupangResults, type MarketBadges } from '@/lib/coupangMarket';

export interface CoupangResearchCandidate {
  name: string;
  price: string | null;
  reviewCount: string | null;
  imageUrl: string | null;
  url: string;
}

export interface CoupangResearchResult {
  candidates: CoupangResearchCandidate[];
  badges: MarketBadges;
  suggestedMarketSize: 'high' | 'mid' | 'low';
}

// AI 소싱 추천에서 쓰는 5단계(very-high~very-low)를, 비교 상품군이 쓰는
// 3단계(high/mid/low)로 축약한다 - 저장 테이블(sourcing_comparison_prices)
// 컬럼이 3단계라 그 폭에 맞춰야 함.
function toThreeTierMarketSize(tier: MarketBadges['marketScaleTier']): 'high' | 'mid' | 'low' {
  if (tier === 'very-high' || tier === 'high') return 'high';
  if (tier === 'mid') return 'mid';
  return 'low'; // 'low' | 'very-low'
}

export async function researchCoupangComparisons(
  keyword: string
): Promise<CoupangResearchResult | { error: string }> {
  const q = keyword.trim();
  if (!q) return { error: '조사할 키워드를 입력해주세요.' };

  let coupang;
  try {
    // 다른 쿠팡 조사 호출부(runProductSearch 등)와 같이, 캡차로 실패해도
    // budgetMs 안에서 짧게 재시도한다. 버튼 한 번 누르고 바로 결과를
    // 기다리는 UX라 너무 길게 잡지 않음(30초).
    coupang = await fetchCoupangBestsellers(q, 20, { budgetMs: 30000 });
  } catch (e: any) {
    return {
      error:
        e?.message ||
        '쿠팡 조사에 실패했어요. 캡차 차단이거나 일시적인 오류일 수 있어요. 잠시 후 다시 시도해주세요.',
    };
  }

  if (coupang.length === 0) {
    return {
      error: '쿠팡에서 검색 결과를 찾지 못했어요. 다른 키워드로 다시 시도해주세요.',
    };
  }

  const analysis = analyzeCoupangResults(coupang);
  if (!analysis) {
    return {
      error: '조사 결과를 분석하지 못했어요.',
    };
  }

  return {
    candidates: coupang.map((c) => ({
      name: c.name,
      price: c.price,
      reviewCount: c.reviewCount,
      imageUrl: c.imageUrl,
      url: c.url,
    })),
    badges: analysis.badges,
    suggestedMarketSize: toThreeTierMarketSize(analysis.badges.marketScaleTier),
  };
}
