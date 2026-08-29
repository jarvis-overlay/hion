import type { MarketBadges } from '@/app/dashboard/sourcing/trends/actions';

export type StrategyKey = 'golden' | 'redocean' | 'niche' | 'caution';

export interface StrategyBucket {
  key: StrategyKey;
  label: string;
  icon: string;
  blurb: string;
  order: number;
}

// 시장규모x경쟁강도 조합으로 소싱 전략을 4갈래로 나눈다. 서버 액션
// (카테고리 필터링)과 클라이언트 UI(뱃지 아래 그룹 설명) 양쪽에서 쓰는
// 순수 로직이라 React 컴포넌트가 없는 별도 파일에 둔다 - actions.ts는
// 'use server'라서 async 함수 아닌 걸 export할 수 없고, 컴포넌트 파일에
// 두면 서버 액션이 클라이언트 전용 코드를 끌고 들어오게 되기 때문.
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

export const STRATEGY_OPTIONS: { value: StrategyKey | 'all'; label: string; icon: string; description: string }[] = [
  { value: 'all', label: '전체 보기', icon: '🎲', description: '모든 전략을 섞어서 보여줘요' },
  { value: 'golden', label: '골든타임', icon: '🏆', description: '수요 검증 + 경쟁 낮음 - 안정적으로 가고 싶을 때' },
  { value: 'niche', label: '니치 리더', icon: '🎯', description: '규모는 작아도 경쟁 없음 - 틈새를 선점하고 싶을 때' },
  { value: 'redocean', label: '레드오션', icon: '⚔️', description: '큰 시장 + 경쟁 있음 - 차별화로 승부하고 싶을 때' },
];
