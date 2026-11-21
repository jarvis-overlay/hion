// 소싱 상품의 발주 이력(sourcing_item_orders) 요약 순수 함수.
import { summarizeMoney, marginResultFromRow } from '@/lib/sourcingSummary';
import { computeShippingPerUnit, type ShippingCalcInput } from '@/lib/shippingCalc';

export interface OrderRowSummary {
  id: string;
  roundNo: number;
  orderedAt: string | null;
  quantity: number | null;
  cost: number | null;
  intlShipping: number | null;
  profit: number | null; // 개당 마진 (판매가가 없으면 null)
  marginPct: number | null;
  totalProfit: number | null; // 개당 마진(반올림) x 수량, 수량이 없으면 null
}

// 마진 컬럼 (회차 행과 소싱 상품 행이 같은 이름을 쓴다)
export const MARGIN_COLUMNS = [
  'price',
  'cost',
  'coupon',
  'coupang_fee',
  'ad_cost',
  'shipping',
  'intl_shipping',
  'intl_shipping_calc',
  'import_vat',
  'output_vat',
  'etc_cost',
  'cost_fx_currency',
  'cost_fx_amount',
  'cost_fx_rate',
  'fee_category',
] as const;

export function sortOrders<T extends { round_no: number }>(orders: T[]): T[] {
  return [...orders].sort((a, b) => a.round_no - b.round_no);
}

export function latestOrder<T extends { round_no: number }>(orders: T[]): T | null {
  let best: T | null = null;
  for (const o of orders) if (!best || o.round_no > best.round_no) best = o;
  return best;
}

export function summarizeOrders(orders: any[]): OrderRowSummary[] {
  return sortOrders(orders).map((o) => {
    const m = summarizeMoney(o);
    const q = o.quantity != null && Number(o.quantity) > 0 ? Number(o.quantity) : null;
    const hasPrice = o.price != null; // 판매가가 없으면 마진 계산이 의미 없다
    return {
      id: o.id,
      roundNo: o.round_no,
      orderedAt: o.ordered_at ?? null,
      quantity: q,
      cost: m.cost,
      intlShipping: m.intlShipping,
      profit: hasPrice ? m.profit : null,
      marginPct: hasPrice ? m.marginPct : null,
      totalProfit: hasPrice && q != null ? Math.round(m.profit) * q : null,
    };
  });
}

export interface OrderTotals {
  totalQuantity: number; // 수량을 입력한 회차의 수량 합
  totalProfit: number | null; // 수량·판매가가 있는 회차의 총 마진 합
  weightedMarginPct: number | null; // Σ총마진 ÷ Σ(실판매가 x 수량), 수량·판매가가 있는 회차만
}

// 합계 줄: 수량을 입력한 회차만 합산한다. 수량 있는 회차가 없으면 null(합계 줄 숨김).
export function summarizeOrderTotals(orders: any[]): OrderTotals | null {
  let totalQuantity = 0;
  let profitSum = 0;
  let revenueSum = 0;
  let any = false;
  let anyProfit = false;
  for (const o of orders) {
    const q = o.quantity != null && Number(o.quantity) > 0 ? Number(o.quantity) : null;
    if (q == null) continue;
    any = true;
    totalQuantity += q;
    if (o.price == null) continue;
    const m = marginResultFromRow(o);
    anyProfit = true;
    profitSum += Math.round(m.profit) * q;
    revenueSum += m.actualPrice * q;
  }
  if (!any) return null;
  return {
    totalQuantity,
    totalProfit: anyProfit ? profitSum : null,
    weightedMarginPct: anyProfit && revenueSum > 0 ? (profitSum / revenueSum) * 100 : null,
  };
}

// 직전 회차(또는 카드)의 해외배송비 칸이 계산기 결과를 그대로 반영한 값이면 true (수동으로 덮어쓴 값이면 false)
function intlShippingIsAuto(src: any): boolean {
  const calc = src?.intl_shipping_calc as ShippingCalcInput | null;
  if (!calc || src.intl_shipping == null) return false;
  const qStr = src.quantity != null ? String(src.quantity) : calc.quantity;
  if (!(parseInt(qStr) > 0)) return false; // 수량을 모르면 자동 반영 여부를 판단할 수 없다 -> 값 보존
  const r = computeShippingPerUnit({ ...calc, quantity: qStr, extraFees: calc.extraFees ?? [] }, Math.max(0, Number(src.cost) || 0));
  return Math.round(r.perUnit) === Math.round(Number(src.intl_shipping));
}

// 새 회차의 시작 값: 직전 회차(번호가 가장 큰 것)가 있으면 그 값, 없으면 소싱 상품의 기본 마진 정보.
// 수량·발주일·메모는 복사하지 않는다.
// 해외배송비: 계산기 결과를 그대로 쓰던 값이면 비워서(새 수량 입력 시 자동 반영) 시작하고, 직접 고친 값이면 그대로 복사한다.
// 관세·부가세를 직접 고친 상태(vatManual/dutyManual)는 새 수량 기준 자동 계산으로 되돌린다.
export function nextOrderPrefill(orders: any[], item: any): { source: 'prev' | 'item'; values: Record<string, any>; fromRound: number | null } {
  const prev = latestOrder(orders);
  const src = prev ?? item;
  const values: Record<string, any> = {};
  for (const k of MARGIN_COLUMNS) values[k] = src?.[k] ?? null;
  if (intlShippingIsAuto(src)) values.intl_shipping = null;
  const calc = values.intl_shipping_calc;
  if (calc && typeof calc === 'object' && calc.taxes) {
    values.intl_shipping_calc = { ...calc, taxes: { ...calc.taxes, vatManual: false, vat: '', dutyManual: false, duty: '' } };
  }
  return { source: prev ? 'prev' : 'item', values, fromRound: prev ? prev.round_no : null };
}
