import { createClient } from '@/lib/supabase/server';
import ProductForm from '@/components/ProductForm';
import ProductCard from '@/components/ProductCard';
import CoupangImportPicker from '@/components/CoupangImportPicker';

export default async function ProductsPage() {
  const supabase = createClient();
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  const { data: channels } = await supabase
    .from('channel_credentials')
    .select('channel, connected');
  const coupangConnected =
    channels?.find((c) => c.channel === 'coupang')?.connected || false;

  // 실제 판매/재고 동기화는 이 매핑 테이블(옵션ID→상품, 1:N)을 기준으로
  // 동작한다 - products.coupang_vendor_item_id는 예전에 쓰던 필드라 지금은
  // 동기화 로직 어디에서도 안 읽는다.
  const { data: vendorItemRows } = await supabase
    .from('product_vendor_items')
    .select('product_id, vendor_item_id');
  const vendorItemsByProduct: Record<string, string[]> = {};
  for (const row of vendorItemRows || []) {
    if (!vendorItemsByProduct[row.product_id]) {
      vendorItemsByProduct[row.product_id] = [];
    }
    vendorItemsByProduct[row.product_id].push(row.vendor_item_id);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">상품 관리</h1>
      <p className="text-sm text-inkSoft mb-5">
        재고·발주 관리의 기준이 되는 상품을 먼저 등록해요
      </p>
      {coupangConnected && <CoupangImportPicker />}
      <ProductForm />
      <div className="grid gap-3 sm:grid-cols-2">
        {products?.length ? (
          products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              vendorItemIds={vendorItemsByProduct[p.id] || []}
            />
          ))
        ) : (
          <p className="text-sm text-inkSoft col-span-2">
            아직 등록된 상품이 없어요.
          </p>
        )}
      </div>
    </div>
  );
}
