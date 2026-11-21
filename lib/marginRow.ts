// 저장된 마진 행(sourcing_items / sourcing_item_orders 공통 컬럼)에서 useMarginFields 초기값을 만든다.
import type { MarginFieldsInit } from '@/lib/useMarginFields';

// 수수료/광고비 금액에서 비율(%)을 되살린다 (판매가가 있어야 가능, 실제 판매가 <= 0이면 null -> 훅이 기본값 사용)
function ratePct(amount: unknown, price: unknown, coupon: unknown): number | null {
  if (!price || amount == null) return null;
  const denom = Number(price) - Number(coupon || 0);
  if (!(denom > 0)) return null;
  return Number(((Number(amount) / denom) * 100).toFixed(2));
}

export function marginInitFromRow(row: any): MarginFieldsInit {
  return {
    price: row.price,
    cost: row.cost,
    coupon: row.coupon,
    importVat: row.import_vat,
    feeRatePct: ratePct(row.coupang_fee, row.price, row.coupon),
    adRatePct: ratePct(row.ad_cost, row.price, row.coupon),
    shipping: row.shipping,
    intlShipping: row.intl_shipping,
    etcCost: row.etc_cost,
  };
}
