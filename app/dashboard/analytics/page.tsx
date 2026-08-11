import { createClient } from '@/lib/supabase/server';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ko-KR');

// 마진 계산기(app/dashboard/margin)와 동일한 공식을 써야 마진율이 일치한다.
// 판매가 - 매출부가세(10%) - 매입가 + 매입부가세(10%, 매입세액공제로 환급되니
// 다시 더함) - 쿠팡수수료. 배송비/광고비는 판매 건별로 저장돼 있지 않아서
// 여기서는 뺄 수 없다 (그만큼 실제 마진은 이 표보다 더 낮을 수 있음).
const COUPANG_FEE_RATE = 10.8;

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const TIME_BUCKETS = [
  { key: 0, label: '새벽 (0~5시)' },
  { key: 1, label: '오전 (6~11시)' },
  { key: 2, label: '오후 (12~17시)' },
  { key: 3, label: '저녁 (18~23시)' },
];

function toKst(iso: string) {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
}

export default async function AnalyticsPage() {
  const supabase = createClient();

  const { data: products } = await supabase
    .from('products')
    .select('id, name, shipping_cost')
    .order('name');

  const { data: purchaseOrders } = await supabase
    .from('purchase_orders')
    .select('product_id, quantity, unit_price_cny, exchange_rate, unit_price_krw');

  const { data: stockRows } = await supabase
    .from('warehouse_stock')
    .select('product_id, quantity');

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: salesRows } = await supabase
    .from('stock_movements')
    .select('product_id, quantity, amount, occurred_at')
    .eq('channel', 'coupang')
    .eq('type', 'out')
    .gte('occurred_at', thirtyDaysAgo.toISOString());

  // 상품별 평균 매입단가 (KRW) - 발주 기록의 가중평균 (수량*단가*환율 합 / 수량 합)
  const costByProduct: Record<string, { costSum: number; qtySum: number }> = {};
  for (const po of purchaseOrders || []) {
    if (!costByProduct[po.product_id]) {
      costByProduct[po.product_id] = { costSum: 0, qtySum: 0 };
    }
    const unitCost =
      po.unit_price_krw != null
        ? Number(po.unit_price_krw)
        : Number(po.unit_price_cny) * Number(po.exchange_rate);
    costByProduct[po.product_id].costSum += Number(po.quantity) * unitCost;
    costByProduct[po.product_id].qtySum += Number(po.quantity);
  }

  // 상품별 현재 재고 (창고 합계)
  const stockByProduct: Record<string, number> = {};
  for (const row of stockRows || []) {
    stockByProduct[row.product_id] =
      (stockByProduct[row.product_id] || 0) + Number(row.quantity);
  }

  // 상품별 최근 30일 판매 요약
  const salesByProduct: Record<string, { qty: number; amount: number }> = {};
  // 요일 x 시간대 판매 건수
  const pattern: number[][] = Array.from({ length: 7 }, () =>
    Array(TIME_BUCKETS.length).fill(0)
  );
  for (const row of salesRows || []) {
    if (!salesByProduct[row.product_id]) {
      salesByProduct[row.product_id] = { qty: 0, amount: 0 };
    }
    salesByProduct[row.product_id].qty += -row.quantity;
    salesByProduct[row.product_id].amount += Number(row.amount) || 0;

    const kst = toKst(row.occurred_at);
    const day = kst.getUTCDay();
    const hour = kst.getUTCHours();
    const bucket = Math.floor(hour / 6);
    pattern[day][bucket] += -row.quantity;
  }

  const rows = (products || []).map((p) => {
    const cost = costByProduct[p.id];
    const avgCost = cost && cost.qtySum > 0 ? cost.costSum / cost.qtySum : null;
    const sales = salesByProduct[p.id];
    const qty30d = sales?.qty || 0;
    const amount30d = sales?.amount || 0;
    const avgSalePrice = qty30d > 0 ? amount30d / qty30d : null;
    const shippingCost = Number(p.shipping_cost) || 0;
    let profitPerUnit: number | null = null;
    if (avgCost !== null && avgSalePrice !== null) {
      const outputVat = avgSalePrice * 0.1;
      const importVat = avgCost * 0.1;
      const fee = avgSalePrice * (COUPANG_FEE_RATE / 100);
      profitPerUnit =
        avgSalePrice - outputVat - avgCost + importVat - fee - shippingCost;
    }
    const marginPct =
      profitPerUnit !== null && avgSalePrice ? (profitPerUnit / avgSalePrice) * 100 : null;
    const totalProfit30d = profitPerUnit !== null ? profitPerUnit * qty30d : null;
    const currentStock = stockByProduct[p.id] || 0;
    const dailyRate = qty30d / 30;
    const turnoverDays = dailyRate > 0 ? currentStock / dailyRate : null;

    return {
      id: p.id,
      name: p.name,
      avgCost,
      avgSalePrice,
      marginPct,
      totalProfit30d,
      qty30d,
      currentStock,
      turnoverDays,
    };
  });

  const profitRanked = [...rows]
    .filter((r) => r.qty30d > 0)
    .sort((a, b) => (b.totalProfit30d ?? -Infinity) - (a.totalProfit30d ?? -Infinity));

  const maxPatternValue = Math.max(1, ...pattern.flat());

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">성과 분석</h1>
      <p className="text-sm text-inkSoft mb-6">
        우리 판매·발주 데이터만으로 계산한 분석이에요. 외부 API나 크롤링 없이
        최근 30일 데이터 기준으로 자동 집계돼요.
      </p>

      <div className="mb-8">
        <h2 className="font-display text-lg font-bold mb-1">
          상품별 마진 랭킹 (최근 30일)
        </h2>
        <p className="text-xs text-inkSoft mb-3">
          마진 계산기와 같은 공식(매출/매입 부가세, 쿠팡수수료 {COUPANG_FEE_RATE}%,
          상품별 건당 배송비 반영)으로 계산했어요. 광고비는 판매 건별로 기록되지
          않아서 반영이 안 됐어요 — 실제 마진은 이보다 조금 더 낮을 수 있어요.
          발주 기록이 없거나 최근 30일 판매가 없는 상품은 계산에서 빠져요.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-xs text-inkSoft uppercase tracking-wide">
                <th className="text-left py-2 px-4">상품</th>
                <th className="text-right py-2 px-4 whitespace-nowrap">판매수량</th>
                <th className="text-right py-2 px-4 whitespace-nowrap">평균 판매가</th>
                <th className="text-right py-2 px-4 whitespace-nowrap">평균 매입가</th>
                <th className="text-right py-2 px-4 whitespace-nowrap">마진율</th>
                <th className="text-right py-2 px-4 whitespace-nowrap">
                  30일 총이익
                </th>
              </tr>
            </thead>
            <tbody>
              {profitRanked.map((r) => (
                <tr key={r.id} className="border-b border-paperLine last:border-0">
                  <td className="py-2 px-4 font-medium whitespace-nowrap">{r.name}</td>
                  <td className="py-2 px-4 text-right font-mono">{r.qty30d}개</td>
                  <td className="py-2 px-4 text-right font-mono">
                    {r.avgSalePrice !== null ? `${fmt(r.avgSalePrice)}원` : '-'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-inkSoft">
                    {r.avgCost !== null ? `${fmt(r.avgCost)}원` : '발주기록 없음'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono">
                    {r.marginPct !== null ? `${fmt1(r.marginPct)}%` : '-'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono font-bold">
                    {r.totalProfit30d !== null ? `${fmt(r.totalProfit30d)}원` : '-'}
                  </td>
                </tr>
              ))}
              {!profitRanked.length && (
                <tr>
                  <td colSpan={6} className="py-4 px-4 text-center text-inkSoft">
                    최근 30일 판매 데이터가 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="font-display text-lg font-bold mb-1">재고 회전 현황</h2>
        <p className="text-xs text-inkSoft mb-3">
          지금 판매 속도로 계속 팔린다고 가정했을 때, 현재 재고가 며칠 치인지
          보여줘요. 너무 길면(재고 과다) 프로모션을, 너무 짧으면(품절 임박)
          발주를 검토해보세요.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-xs text-inkSoft uppercase tracking-wide">
                <th className="text-left py-2 px-4">상품</th>
                <th className="text-right py-2 px-4 whitespace-nowrap">현재 재고</th>
                <th className="text-right py-2 px-4 whitespace-nowrap">
                  하루 평균 판매
                </th>
                <th className="text-right py-2 px-4 whitespace-nowrap">
                  소진 예상 일수
                </th>
                <th className="text-left py-2 px-4 whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => r.currentStock > 0 || r.qty30d > 0)
                .sort((a, b) => (a.turnoverDays ?? Infinity) - (b.turnoverDays ?? Infinity))
                .map((r) => {
                  const dailyRate = r.qty30d / 30;
                  let status = '';
                  let statusClass = '';
                  if (r.turnoverDays === null) {
                    status = '최근 판매 없음';
                    statusClass = 'text-inkSoft';
                  } else if (r.turnoverDays < 7) {
                    status = '품절 임박 - 발주 검토';
                    statusClass = 'text-warn';
                  } else if (r.turnoverDays > 90) {
                    status = '재고 과다 - 프로모션 검토';
                    statusClass = 'text-blue-600';
                  } else {
                    status = '정상';
                    statusClass = 'text-profit';
                  }
                  return (
                    <tr key={r.id} className="border-b border-paperLine last:border-0">
                      <td className="py-2 px-4 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="py-2 px-4 text-right font-mono">{r.currentStock}개</td>
                      <td className="py-2 px-4 text-right font-mono text-inkSoft">
                        {fmt1(dailyRate)}개
                      </td>
                      <td className="py-2 px-4 text-right font-mono">
                        {r.turnoverDays !== null ? `${fmt1(r.turnoverDays)}일` : '-'}
                      </td>
                      <td className={`py-2 px-4 whitespace-nowrap text-xs font-medium ${statusClass}`}>
                        {status}
                      </td>
                    </tr>
                  );
                })}
              {!rows.filter((r) => r.currentStock > 0 || r.qty30d > 0).length && (
                <tr>
                  <td colSpan={5} className="py-4 px-4 text-center text-inkSoft">
                    데이터가 없어요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="font-display text-lg font-bold mb-1">
          요일·시간대별 판매 패턴 (최근 30일)
        </h2>
        <p className="text-xs text-inkSoft mb-3">
          진하게 표시된 칸일수록 그 요일·시간대에 많이 팔렸어요. 광고 집행
          타이밍이나 프로모션 노출 시점 잡을 때 참고하세요.
        </p>
        <div className="card overflow-x-auto p-4">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left py-1 px-2 w-14"></th>
                {TIME_BUCKETS.map((b) => (
                  <th key={b.key} className="py-1 px-2 text-center text-inkSoft font-normal whitespace-nowrap">
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAY_LABELS.map((label, day) => (
                <tr key={day}>
                  <td className="py-1 px-2 font-medium">{label}</td>
                  {TIME_BUCKETS.map((b) => {
                    const value = pattern[day][b.key];
                    const intensity = value / maxPatternValue;
                    return (
                      <td key={b.key} className="py-1 px-2">
                        <div
                          className="rounded-md text-center py-2 font-mono font-semibold"
                          style={{
                            backgroundColor: `rgba(37, 99, 235, ${0.08 + intensity * 0.5})`,
                            color: intensity > 0.5 ? 'white' : 'inherit',
                          }}
                        >
                          {value || ''}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
