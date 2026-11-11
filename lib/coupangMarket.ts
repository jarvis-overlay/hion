// 쿠팡 실데이터 검색 결과(CoupangBestseller[])를 분석해서 시장규모/경쟁강도
// 뱃지를 계산하는 순수 동기 함수들. 원래 app/dashboard/sourcing/trends/actions.ts
// 안에 있었는데, 그 파일은 'use server'라서 async 함수가 아닌 걸 export할 수
// 없어 다른 'use server' 파일(소싱 리스트 쪽 쿠팡 조사 기능)에서 재사용할 수
// 없었다 - 그래서 순수 로직만 이 파일로 분리했다. trends/actions.ts는 여기서
// import해서 그대로 재노출(export type { MarketBadges } 등)한다.
import type { CoupangBestseller } from '@/lib/brightdata';

export type MarketScaleTier = 'very-high' | 'high' | 'mid' | 'low' | 'very-low';
export type CompetitionTier = 'low' | 'mid' | 'high';

export interface MarketBadges {
  marketScaleLabel: string; // "매우 큼" / "큼" / "중간" / "작음" / "매우 작음"
  marketScaleTier: MarketScaleTier;
  medianReviewCount: number; // 시장규모 판정 기준값
  totalReviewCount: number; // 참고용 (목록 전체 리뷰 합계 - 전체 규모 가늠용)
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
// 줄 요약 텍스트를 만든다. 카테고리 검증 단계와 상품 검증 단계(AI 소싱
// 추천), 소싱 리스트의 "쿠팡 실데이터로 조사" 기능까지 공통으로 쓰는
// 로직이라 여기 한 곳에 모아둠.
export function analyzeCoupangResults(
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

  // 경쟁강도는 "1위 상품 수준으로 잘 팔리는 다른 상품이 이 카테고리
  // 안에 얼마나 많은가"를 그 카테고리 1위 리뷰수 "대비 비율"로 잰다.
  //
  // 예전엔 절대 리뷰수(3,000개 이상)로 쟀는데, 그러면 시장규모(중앙값)
  // 계산과 똑같은 숫자를 공유하게 돼서 두 지표가 수학적으로 묶여버리는
  // 문제가 있었다: 중앙값이 1,000 이상이면 최소 절반은 이미 1,000
  // 이상이라는 게 정의상 보장되므로, 기준을 1,000으로 맞추면 "시장
  // 크면 무조건 경쟁도 높음"이 되어 "시장 크고 경쟁 낮음"(골든타임)
  // 조합이 원천적으로 안 나왔다(실측: 16개 후보 중 0개). 기준을 3,000
  // (시장규모 "매우 큼" 경계선)으로 올려서 그 버그는 고쳤지만, 이번엔
  // 반대쪽이 묶여버렸다 - 중앙값 3,000 이상(매우 큼)이면 역시 정의상
  // 최소 절반이 3,000 이상이라 "높음"이 자동 보장되고, 반대로 중앙값이
  // 1,000~3,000(큼)인데 그 중 절반이 3,000을 넘는 경우는 통계적으로
  // 거의 불가능하다. 그 결과 "큰 시장 + 경쟁 있음"(레드오션) 조합이
  // "매우 큰 시장"일 때만 나오는데, 지금 AI가 브레인스토밍하는 구체적인
  // 틈새형 카테고리명으로는 40개 샘플의 중앙값이 3,000을 넘기는 경우가
  // 거의 없어서 레드오션이 사실상 안 나왔다(실측 확인).
  //
  // 절대 리뷰수 대신 "이 카테고리 1위 대비 비율"로 재면 시장규모(중앙값)
  // 계산과 전혀 다른 숫자를 쓰게 되어 두 지표가 진짜로 독립적으로
  // 갈린다 - 시장이 크든 작든, "1위만 튀고 나머지는 멀리 뒤처진 경우"
  // (경쟁 낮음)와 "여러 상품이 1위와 비슷하게 선전하는 경우"(경쟁 높음)
  // 를 규모와 무관하게 구분할 수 있다.
  // 실제 쿠팡 랭킹은 1위가 2위 이하를 압도하는 극단적인 쏠림이 흔해서
  // (승자독식 구조), "1위 대비 30% 이상이 40% 이상" 같은 기준은 실측해
  // 보니 거의 모든 카테고리에서 "낮음"으로만 나왔다 - 기준을 더
  // 느슨하게 (1위 대비 15% 이상, 목록의 25% 이상) 조정.
  const topReviews = Math.max(...reviewCounts, 1);
  const meaningfulCompetitorCount = reviewCounts.filter((r) => r >= topReviews * 0.15).length;
  const meaningfulRatio = meaningfulCompetitorCount / reviewCounts.length;
  const [competitionLabel, competitionTier]: [string, CompetitionTier] =
    meaningfulRatio >= 0.25
      ? ['높음', 'high']
      : meaningfulRatio >= 0.1
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
  }원). 목록 내 리뷰 중앙값 ${medianReviews.toLocaleString()}개(최다는 "${topByReviews.name}" ${maxReviews.toLocaleString()}개) - 시장 규모는 중앙값 기준으로 판정: ${scaleDesc}. 조회된 ${
    coupang.length
  }개 중 1위 리뷰수의 15% 이상인 상품 ${meaningfulCompetitorCount}개(${(meaningfulRatio * 100).toFixed(
    0
  )}%) - 경쟁강도 ${competitionLabel}. 목록 전체 리뷰 합계 ${totalReviews.toLocaleString()}개, 가격 분포 ${priceRange}`;

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
      totalReviewCount: totalReviews,
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

// 뱃지 숫자(시장규모 x 경쟁강도 조합)를 보고 뭘 판단해야 하는지 한 문장
// 결론을 내려준다. 별도 AI 호출 없이 이미 계산된 뱃지만으로 즉시 판단.
export function marketVerdict(badges: MarketBadges): string {
  const bigMarket = badges.marketScaleTier === 'very-high' || badges.marketScaleTier === 'high';
  const smallMarket = badges.marketScaleTier === 'low' || badges.marketScaleTier === 'very-low';
  const highComp = badges.competitionTier === 'high';
  const lowComp = badges.competitionTier === 'low';

  if (smallMarket) {
    return '시장 자체가 작아서 신중해야 해요. 더 넓은 키워드로 다시 검색해보는 걸 추천해요.';
  }
  if (bigMarket && highComp) {
    return '수요는 확실하지만 이미 검증된 경쟁자가 많아요. 가격/디자인 차별화 없이는 진입이 어려울 수 있어요.';
  }
  if (bigMarket && lowComp) {
    return '수요는 확실한데 아직 경쟁자가 많지 않아요 - 지금이 진입 적기일 수 있어요.';
  }
  if (!bigMarket && lowComp) {
    return '중간 규모 시장에 경쟁이 적어요. 니치로 노려볼 만해요.';
  }
  return '적당한 규모, 적당한 경쟁이에요. 가격 경쟁력이나 상품 디테일이 성패를 가를 것 같아요.';
}
