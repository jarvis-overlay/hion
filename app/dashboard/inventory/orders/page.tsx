import { createClient } from '@/lib/supabase/server';
import OrderForm from '@/components/OrderForm';
import OrderRow from '@/components/OrderRow';

export default async function OrdersPage() {
  const supabase = createClient();

  const { data: products } = await supabase
    .from('products')
    .select('id, name')
    .order('name');

  const { data: orders } = await supabase
    .from('purchase_orders')
    .select('*, products(name)')
    .order('order_date', { ascending: false });

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">발주 · 입고</h1>
      <p className="text-sm text-inkSoft mb-5">
        중국 발주를 기록하고, 물류창고 도착 시 쿠팡 창고 / 자사 창고로 배분해서
        입고 처리해요
      </p>

      {products?.length ? (
        <OrderForm products={products} />
      ) : (
        <div className="card p-4 mb-6 text-sm text-inkSoft">
          먼저 <b>상품 관리</b>에서 상품을 등록해야 발주를 넣을 수 있어요.
        </div>
      )}

      <div className="grid gap-3">
        {orders?.length ? (
          orders.map((o) => <OrderRow key={o.id} order={o} />)
        ) : (
          <p className="text-sm text-inkSoft">아직 등록된 발주가 없어요.</p>
        )}
      </div>
    </div>
  );
}
