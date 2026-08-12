import { createClient } from '@/lib/supabase/server';
import ProductForm from '@/components/ProductForm';
import ProductCard from '@/components/ProductCard';
import CoupangImportPicker from '@/components/CoupangImportPicker';
import ReturnGradeRegisterForm from '@/components/ReturnGradeRegisterForm';

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
    .select('product_id, vendor_item_id, is_return_grade');
  const vendorItemsByProduct: Record<string, string[]> = {};
  for (const row of vendorItemRows || []) {
    if (!vendorItemsByProduct[row.product_id]) {
      vendorItemsByProduct[row.product_id] = [];
    }
    vendorItemsByProduct[row.product_id].push(row.vendor_item_id);
  }

  // 재고 현황 페이지와 동일한 데이터를 여기서도 보여주기 위해 같이 불러온다.
  const { data: stockRows } = await supabase
    .from('warehouse_stock')
    .select('product_id, warehouse, quantity');
  const stockByProduct: Record<string, { coupang: number; own: number }> = {};
  for (const row of stockRows || []) {
    if (!stockByProduct[row.product_id]) {
      stockByProduct[row.product_id] = { coupang: 0, own: 0 };
    }
    if (row.warehouse === 'coupang') stockByProduct[row.product_id].coupang = row.quantity;
    if (row.warehouse === 'own') stockByProduct[row.product_id].own = row.quantity;
  }

  // "반품 재판매 상품" 구역 분류는 옵션ID 하나라도 반품등급이면 상품
  // 전체를 옮겨버리던 방식(옵션이 여러 개인 메인 상품이 옵션 하나 잘못된
  // 매핑 때문에 통째로 반품 구역으로 밀려나는 버그가 있었음) 대신,
  // 반품등급 상품 등록 흐름에서만 붙는 표식(상품 자체에 등급이 있거나
  // notes에 '반품등급'이 있음)으로 판단한다.
  const isReturnGradeProduct = (p: any) =>
    !!p.return_grade || (p.notes || '').includes('반품등급');

  const mainProducts = (products || []).filter((p) => !isReturnGradeProduct(p));
  const returnGradeProducts = (products || []).filter((p) => isReturnGradeProduct(p));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">상품 관리</h1>
      <p className="text-sm text-inkSoft mb-5">
        재고·발주 관리의 기준이 되는 상품을 먼저 등록해요
      </p>
      {coupangConnected && <CoupangImportPicker />}
      {coupangConnected && <ReturnGradeRegisterForm />}
      <ProductForm />

      <h2 className="font-display text-lg font-bold mb-3">메인 상품</h2>
      <div className="grid gap-3 sm:grid-cols-2 mb-8">
        {mainProducts.length ? (
          mainProducts.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              vendorItemIds={vendorItemsByProduct[p.id] || []}
              stock={stockByProduct[p.id]}
            />
          ))
        ) : (
          <p className="text-sm text-inkSoft col-span-2">
            아직 등록된 상품이 없어요.
          </p>
        )}
      </div>

      {returnGradeProducts.length > 0 && (
        <>
          <h2 className="font-display text-lg font-bold mb-1">
            반품 재판매 상품
          </h2>
          <p className="text-xs text-inkSoft mb-3">
            쿠팡이 반품받은 상품을 별도 등급(회수품)으로 재등록한 것들이에요.
            쿠폰 할인이 적용 안 되고, 원가/마진도 메인 상품과 따로 관리돼요.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {returnGradeProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                vendorItemIds={vendorItemsByProduct[p.id] || []}
                stock={stockByProduct[p.id]}
                isReturnGrade
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
