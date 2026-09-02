import { createClient } from '@/lib/supabase/server';
import SourcingForm from '@/components/SourcingForm';
import SourcingList from '@/components/SourcingList';

export default async function SourcingPage() {
  const supabase = createClient();
  // 옵션/공급처 테이블 마이그레이션을 아직 안 돌렸으면 이 조인 쿼리
  // 자체가 실패한다 - 그런 경우에도 기존 소싱 리스트는 그대로 보이도록
  // (옵션/공급처 없이) 예전 방식으로 한 번 더 시도한다.
  let { data: items, error } = await supabase
    .from('sourcing_items')
    .select(
      '*, sourcing_item_options(*), sourcing_item_suppliers(*), sourcing_item_comparisons(*, sourcing_comparison_prices(*))'
    )
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .from('sourcing_items')
      .select('*')
      .order('created_at', { ascending: false });
    items = fallback.data;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-1">소싱 리스트</h1>
      <p className="text-sm text-inkSoft mb-5">
        소싱 후보 상품을 등록하고 상태 · 마진까지 한 곳에서 관리해요
      </p>
      <SourcingForm />
      <SourcingList items={items || []} />
    </div>
  );
}
