import { createClient } from '@/lib/supabase/server';
import SaleForm from '@/components/SaleForm';
import StockTable from '@/components/StockTable';
import HistoryList from '@/components/HistoryList';

export default async function StockPage() {
  const supabase = createClient();

  const { data: products } = await supabase
    .from('products')
    .select('id, name')
    .order('name');

  const { data: stockRows } = await supabase
    .from('warehouse_stock')
    .select('*');

  const { data: movements } = await supabase
    .from('stock_movements')
    .select('*, products(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">재고 현황</h1>
      <p className="text-sm text-inkSoft mb-5">
        쿠팡 창고 / 자사 물류창고 재고와 전체 입출고 히스토리
      </p>

      <div className="mb-6">
        <StockTable products={products || []} stockRows={stockRows || []} />
      </div>

      {products?.length ? (
        <SaleForm products={products} />
      ) : (
        <div className="card p-4 mb-6 text-sm text-inkSoft">
          먼저 <b>상품 관리</b>에서 상품을 등록해야 판매 기록을 남길 수 있어요.
        </div>
      )}

      <div>
        <h2 className="font-display text-lg font-bold mb-3">히스토리</h2>
        <HistoryList movements={movements || []} />
      </div>
    </div>
  );
}
