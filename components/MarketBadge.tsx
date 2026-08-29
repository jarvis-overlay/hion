import type { ReactNode } from 'react';
import type { MarketBadges } from '@/app/dashboard/sourcing/trends/actions';

// 시장규모/경쟁강도 뱃지 색상 (RP-AI StatusBadge 패턴 참고 - dot + ring-inset pill)
export type BadgeTier = 'good' | 'ok' | 'bad' | 'neutral';

export const MARKET_TIER_COLOR: Record<MarketBadges['marketScaleTier'], BadgeTier> = {
  'very-high': 'good',
  high: 'good',
  mid: 'ok',
  low: 'bad',
  'very-low': 'bad',
};

export const COMPETITION_TIER_COLOR: Record<MarketBadges['competitionTier'], BadgeTier> = {
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

export function Badge({ tier, children }: { tier: BadgeTier; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${BADGE_STYLE[tier]}`}
    >
      {children}
    </span>
  );
}

export interface StrategyBucket {
  key: 'golden' | 'redocean' | 'niche' | 'caution';
  label: string;
  icon: string;
  blurb: string;
  order: number;
}

// 시장규모x경쟁강도 조합으로 소싱 전략을 4갈래로 나눈다. 카테고리를
// 하나씩 평면으로 나열하는 대신, "지금 이 카테고리들이 어떤 전략에
// 해당하는지" AI가 길안내를 해주듯 그룹으로 묶어서 보여주기 위함
// (AI 소싱 추천 카테고리 단계에서 씀). 추가 AI 호출 없이 이미 계산된
// 뱃지만으로 판정.
export function strategyBucket(badges: MarketBadges): StrategyBucket {
  const bigMarket = badges.marketScaleTier === 'very-high' || badges.marketScaleTier === 'high';
  const smallMarket = badges.marketScaleTier === 'low' || badges.marketScaleTier === 'very-low';
  const highComp = badges.competitionTier === 'high';

  if (bigMarket && !highComp) {
    return {
      key: 'golden',
      label: '골든타임',
      icon: '🏆',
      blurb: '수요는 검증됐고 아직 경쟁자가 많지 않아요 - 지금 들어가기 가장 좋은 조합이에요.',
      order: 0,
    };
  }
  if (bigMarket && highComp) {
    return {
      key: 'redocean',
      label: '레드오션',
      icon: '⚔️',
      blurb: '수요는 확실하지만 이미 검증된 경쟁자가 많아요. 가격/디자인 차별화 없이는 진입이 어려울 수 있어요.',
      order: 2,
    };
  }
  if (!smallMarket && !highComp) {
    return {
      key: 'niche',
      label: '니치 리더',
      icon: '🎯',
      blurb: '시장 규모는 크지 않지만 경쟁도 적어요. 선점하면 작게라도 확실히 자리잡을 수 있어요.',
      order: 1,
    };
  }
  if (smallMarket && !highComp) {
    return {
      key: 'niche',
      label: '니치 리더',
      icon: '🎯',
      blurb: '시장 규모는 작지만 경쟁도 거의 없어요. 니치로 노려볼 만해요.',
      order: 1,
    };
  }
  return {
    key: 'caution',
    label: '신중 필요',
    icon: '⚠️',
    blurb: '시장은 작은데 경쟁까지 있어요. 리스크 대비 보상이 낮은 편이니 신중하게 접근하세요.',
    order: 3,
  };
}

// 시장규모/경쟁강도/가격대 뱃지 세 개를 한 줄로 보여주는 공용 조각.
// AI 소싱 추천과 상품 검색(키워드 리서치) 둘 다에서 쓴다.
export function MarketBadgeRow({ badges }: { badges: MarketBadges }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tier={MARKET_TIER_COLOR[badges.marketScaleTier]}>
        🔥 시장규모 {badges.marketScaleLabel} (리뷰 중앙값 {badges.medianReviewCount.toLocaleString()}개)
      </Badge>
      <Badge tier={COMPETITION_TIER_COLOR[badges.competitionTier]}>
        ⚔️ 경쟁 {badges.competitionLabel} (검증 경쟁자 {badges.meaningfulCompetitorCount}명)
      </Badge>
      <Badge tier="neutral">💰 {badges.priceRange}</Badge>
    </div>
  );
}
