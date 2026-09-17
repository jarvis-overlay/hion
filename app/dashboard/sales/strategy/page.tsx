import { createClient } from '@/lib/supabase/server';
import SalesStrategyList from '@/components/SalesStrategyList';

// generateStrategy가 실시간 쿠팡 조회(캡차 재시도 예산 120초) + Claude
// 호출까지 순차로 이어져서 기본 타임아웃보다 넉넉하게 잡아야 함
// (상품 검색 페이지와 동일한 근거).
export const maxDuration = 280;

export default async function SalesStrategyPage() {
  const supabase = createClient();
  const { data: items } = await supabase
    .from('sourcing_items')
    .select(
      '*, sourcing_item_suppliers(*), sourcing_item_comparisons(*, sourcing_comparison_prices(*)), sourcing_item_strategies(*)'
    )
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-1">판매 전략</h1>
      <p className="text-sm text-inkSoft mb-6">
        실제 쿠팡 시장 위치 + 이미 입력해둔 공급처·비교 상품군 데이터를 근거로, 이 상품을 지금 어떻게
        팔아야 할지 AI가 구체적으로 제안해줘요.
      </p>
      <SalesStrategyList items={items || []} />
    </div>
  );
}
