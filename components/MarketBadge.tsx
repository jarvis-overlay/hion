import type { ReactNode } from 'react';
import type { MarketBadges } from '@/app/dashboard/sourcing/trends/actions';

export { strategyBucket, type StrategyBucket, type StrategyKey, STRATEGY_OPTIONS } from '@/lib/strategy';

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

// 시장규모/경쟁강도/가격대 뱃지 세 개를 한 줄로 보여주는 공용 조각.
// AI 소싱 추천과 상품 검색(키워드 리서치) 둘 다에서 쓴다.
export function MarketBadgeRow({ badges }: { badges: MarketBadges }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tier={MARKET_TIER_COLOR[badges.marketScaleTier]}>
        🔥 시장규모 {badges.marketScaleLabel} (리뷰 중앙값 {badges.medianReviewCount.toLocaleString()}개)
      </Badge>
      <Badge tier={COMPETITION_TIER_COLOR[badges.competitionTier]}>
        ⚔️ 경쟁 {badges.competitionLabel} (검증 경쟁자 {badges.meaningfulCompetitorCount}/{badges.productCount}개)
      </Badge>
      <Badge tier="neutral">💰 {badges.priceRange}</Badge>
    </div>
  );
}
