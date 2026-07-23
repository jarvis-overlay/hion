import { createClient } from '@/lib/supabase/server';
import SaleForm from '@/components/SaleForm';
import StockTable from '@/components/StockTable';
import ChannelSalesTable from '@/components/ChannelSalesTable';
import DailySalesHistory from '@/components/DailySalesHistory';
import HistoryList from '@/components/HistoryList';
import CoupangSyncButton from '@/components/CoupangSyncButton';

function startOfTodayKST() {
  const now = new Date();
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - kstOffsetMs);
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');

export default async function StockPage() {
  const supabase = createClient();

  const { data: products } = await supabase
    .from('products')
    .select('id, name, is_hidden')
    .order('name');

  const { data: stockRows } = await supabase
    .from('warehouse_stock')
    .select('*');

  const { data: channels } = await supabase
    .from('channel_credentials')
    .select('channel, connected');
  const coupangConnected =
    channels?.find((c) => c.channel === 'coupang')?.connected || false;

  // 실제 판매(주문) 기록만 골라서 오늘 판매 요약 계산
  const { data: todaySalesRaw } = await supabase
    .from('stock_movements')
    .select('*, products(name)')
    .like('external_ref', 'coupang-order:%')
    .gte('occurred_at', startOfTodayKST().toISOString());

  const salesByProduct: Record<
    string,
    { name: string; qty: number; amount: number }
  > = {};
  for (const row of todaySalesRaw || []) {
    const key = row.product_id;
    if (!salesByProduct[key]) {
      salesByProduct[key] = {
        name: row.products?.name || '상품',
        qty: 0,
        amount: 0,
      };
    }
    salesByProduct[key].qty += Math.abs(row.quantity);
    salesByProduct[key].amount += Number(row.amount) || 0;
  }
  const todaySales = Object.values(salesByProduct).sort(
    (a, b) => b.amount - a.amount
  );
  const todayTotalAmount = todaySales.reduce((s, p) => s + p.amount, 0);
  const todayTotalQty = todaySales.reduce((s, p) => s + p.qty, 0);

  // 일자별 판매 히스토리용 (최근 30일, 상품별 상세 포함)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: dailySalesRows } = await supabase
    .from('stock_movements')
    .select('occurred_at, quantity, amount, product_id, products(name)')
    .like('external_ref', 'coupang-order:%')
    .gte('occurred_at', thirtyDaysAgo.toISOString())
    .order('occurred_at', { ascending: false });

  const { data: movements } = await supabase
    .from('stock_movements')
    .select('*, products(name)')
    .order('created_at', { ascending: false })
    .limit(50);

  // 채널별 판매 현황용 데이터 (전체 기간 누적)
  const { data: salesRows } = await supabase
    .from('stock_movements')
    .select('product_id, channel, quantity')
    .eq('type', 'out')
    .not('channel', 'is', null);

  const coupangStockByProduct: Record<string, number> = {};
  for (const row of stockRows || []) {
    if (row.warehouse === 'coupang') {
      coupangStockByProduct[row.product_id] = row.quantity;
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <h1 className="font-display text-2xl font-bold">재고 현황</h1>
        {coupangConnected && <CoupangSyncButton compact />}
      </div>
      <p className="text-sm text-inkSoft mb-5">
        쿠팡 창고 / 자사 물류창고 재고와 전체 입출고 히스토리
      </p>

      <div className="mb-6">
        <StockTable products={products || []} stockRows={stockRows || []} />
      </div>

      <div className="mb-6">
        <h2 className="font-display text-lg font-bold mb-3">
          채널별 판매 현황 (누적)
        </h2>
        <ChannelSalesTable
          products={products || []}
          salesRows={salesRows || []}
          coupangStockByProduct={coupangStockByProduct}
        />
      </div>

      {coupangConnected && (
        <div className="card p-5 mb-6">
          <h2 className="font-display font-bold mb-3">
            오늘 판매된 상품 (쿠팡)
          </h2>
          <div className="flex gap-6 mb-4">
            <div>
              <div className="text-xs text-inkSoft">매출금액</div>
              <div className="text-xl font-bold font-mono">
                {fmt(todayTotalAmount)}원
              </div>
            </div>
            <div>
              <div className="text-xs text-inkSoft">판매수량</div>
              <div className="text-xl font-bold font-mono">
                {todayTotalQty}개
              </div>
            </div>
          </div>
          {todaySales.length ? (
            <div className="flex flex-col gap-2">
              {todaySales.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm border-b border-paperLine last:border-0 pb-2 last:pb-0"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="font-mono text-xs text-inkSoft whitespace-nowrap ml-3">
                    {fmt(p.amount)}원 · {p.qty}개
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-inkSoft">
              오늘 아직 판매 동기화된 내역이 없어요.
            </p>
          )}
        </div>
      )}

      {coupangConnected && (
        <div className="mb-6">
          <h2 className="font-display text-lg font-bold mb-3">
            일자별 판매 히스토리 (쿠팡, 최근 30일)
          </h2>
          <DailySalesHistory rows={dailySalesRows || []} />
        </div>
      )}

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
