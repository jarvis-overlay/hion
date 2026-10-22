import { createClient } from '@/lib/supabase/server';
import CoupangSyncButton from '@/components/CoupangSyncButton';
import StockDashboard from '@/components/stock/StockDashboard';
import { buildStockStats, kstDateStr, parseFilter, parseTab, seriesStartIso } from '@/lib/stockStats';

// syncCoupangInventory 서버 액션(카탈로그+주문+재고 동기화)이 오래 걸릴 수
// 있어 기본 실행시간 제한을 60초로 늘려둔다.
export const maxDuration = 60;

// Supabase(PostgREST)는 한 번에 최대 1000행까지만 돌려준다. 60일치 판매
// 기록은 그걸 넘길 수 있어서, 넘기면 조용히 잘려서 숫자가 틀려지므로
// 페이지를 나눠 끝까지 가져온다.
const PAGE = 1000;
// 조회 중 일부 페이지가 실패해도 화면 전체를 에러로 만들지 않고, 가져온 만큼만
// 쓰면서 경고 문구를 띄운다.
async function fetchAllMovements(
  supabase: ReturnType<typeof createClient>,
  fromIso: string
): Promise<{ rows: any[]; error: string | null }> {
  const rows: any[] = [];
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('product_id, type, quantity, amount, occurred_at')
      .eq('channel', 'coupang')
      .in('type', ['out', 'in'])
      .gte('occurred_at', fromIso)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: { tab?: string; filter?: string };
}) {
  const supabase = createClient();
  const todayStr = kstDateStr(new Date());

  const [productsRes, stockRes, { data: channels }, { data: history }, series] =
    await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('warehouse_stock').select('product_id, warehouse, quantity'),
      supabase.from('channel_credentials').select('channel, connected'),
      supabase
        .from('stock_movements')
        .select('*, products(name)')
        .order('occurred_at', { ascending: false })
        .limit(500),
      fetchAllMovements(supabase, seriesStartIso(todayStr)),
    ]);

  const coupangConnected = channels?.find((c) => c.channel === 'coupang')?.connected || false;

  const products = productsRes.data;
  const stockRows = stockRes.data;
  // 상품/재고/판매 중 하나라도 못 불러왔으면 숫자가 실제와 달라 보이므로 알려준다.
  const loadError = productsRes.error?.message || stockRes.error?.message || series.error;

  const stats = buildStockStats({
    products: products || [],
    stockRows: stockRows || [],
    movements: series.rows,
    todayStr,
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <h1 className="font-display text-2xl font-bold">재고·판매 현황</h1>
        {coupangConnected && <CoupangSyncButton compact />}
      </div>
      <p className="text-sm text-inkSoft mb-5">
        쿠팡 기준이에요. 재고 수량·원가 수정은{' '}
        <a href="/dashboard/inventory/products" className="underline">
          상품 관리
        </a>
        에서 해요.
      </p>

      {loadError && (
        <div className="rounded-xl bg-warnBg text-warn text-xs px-4 py-3 mb-4">
          일부 데이터를 불러오지 못해 숫자가 실제와 다를 수 있어요. 새로고침해보시고, 계속되면
          알려주세요. ({loadError})
        </div>
      )}

      <StockDashboard
        stats={stats}
        movements={history || []}
        productOptions={(products || []).map((p) => ({
          id: p.id,
          name: p.name,
          is_hidden: p.is_hidden ?? null,
        }))}
        initialTab={parseTab(searchParams.tab)}
        initialFilter={parseFilter(searchParams.filter)}
      />
    </div>
  );
}
