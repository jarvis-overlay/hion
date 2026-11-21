// 소싱 카드에서 탭(마진·배송 / 옵션 / 공급처 / 비교 상품군 / 체크리스트)별 "요약 한 줄"을 만드는 순수 함수.
import { computeMargin, type MarginResult } from '@/lib/marginCalc';
import { classifyRocketGrowth } from '@/lib/rocketGrowth';

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

export interface MoneySummary {
  hasPrice: boolean;
  hasCost: boolean;
  price: number | null;
  cost: number | null;
  profit: number;
  marginPct: number | null;
  shipping: number | null; // 쿠팡 로켓그로스 입출고+배송 (국내)
  intlShipping: number | null; // 해외배송비(개당)
  sizeName: string | null; // 로켓그로스 사이즈 유형 (크기를 넣은 경우)
  sumCm: number | null;
  overLimit: boolean;
  hasAnything: boolean;
}

// 저장된 마진 행(소싱 상품 / 발주 회차 공통 컬럼)에서 마진 계산 결과를 구한다.
export function marginResultFromRow(it: any): MarginResult {
  return computeMargin({
    price: it.price ?? null,
    coupon: it.coupon ?? null,
    cost: it.cost ?? null,
    outputVat: it.output_vat ?? null,
    importVat: it.import_vat ?? null,
    coupangFee: it.coupang_fee ?? null,
    shipping: it.shipping ?? null,
    intlShipping: it.intl_shipping ?? null,
    adCost: it.ad_cost ?? null,
    etcCost: it.etc_cost ?? null,
  });
}

export function summarizeMoney(it: any): MoneySummary {
  const m = marginResultFromRow(it);
  // 저장된 해외배송 계산기 값(박스 크기 모드)에서 사이즈 유형을 다시 구한다
  const calc = it.intl_shipping_calc;
  const cls =
    calc && calc.mode === 'dims'
      ? classifyRocketGrowth(num(calc.length), num(calc.width), num(calc.height), calc.weight ? num(calc.weight) || null : null)
      : null;
  return {
    hasPrice: it.price != null,
    hasCost: it.cost != null,
    price: it.price ?? null,
    cost: it.cost ?? null,
    profit: m.profit,
    marginPct: m.marginPct,
    shipping: it.shipping ?? null,
    intlShipping: it.intl_shipping ?? null,
    sizeName: cls ? cls.name : null,
    sumCm: cls ? cls.sumCm : null,
    overLimit: !!cls?.overLimit,
    hasAnything: it.price != null || it.cost != null || it.shipping != null || it.intl_shipping != null,
  };
}

export function summarizeOptions(options: any[]): { count: number; minPct: number | null; maxPct: number | null } {
  const pcts: number[] = [];
  for (const o of options) {
    const m = computeMargin({
      price: o.price ?? null,
      coupon: o.coupon ?? null,
      cost: o.cost ?? null,
      outputVat: o.output_vat ?? null,
      importVat: o.import_vat ?? null,
      coupangFee: o.coupang_fee ?? null,
      shipping: o.shipping ?? null,
      adCost: o.ad_cost ?? null,
      etcCost: o.etc_cost ?? null,
    });
    if (m.marginPct != null) pcts.push(m.marginPct);
  }
  return {
    count: options.length,
    minPct: pcts.length ? Math.min(...pcts) : null,
    maxPct: pcts.length ? Math.max(...pcts) : null,
  };
}

export function summarizeSuppliers(suppliers: any[]): { count: number; cheapest: { price: number; currency: string } | null } {
  let best: { price: number; currency: string } | null = null;
  for (const s of suppliers) {
    if (s.price == null) continue;
    // 통화가 섞여 있으면 비교가 안 되니, 첫 통화와 같은 통화끼리만 가장 싼 것을 본다
    if (!best) best = { price: s.price, currency: s.currency || '' };
    else if ((s.currency || '') === best.currency && s.price < best.price) best = { price: s.price, currency: s.currency || '' };
  }
  return { count: suppliers.length, cheapest: best };
}

export function summarizeChecklist(item: any, template: any[]): { checked: number; total: number } {
  const dbRows: any[] = item.sourcing_item_checklist || [];
  const byKey = new Map(dbRows.map((r) => [r.item_key, r]));
  let checked = 0;
  for (const t of template) if (byKey.get(t.item_key)?.checked) checked++;
  const custom = dbRows.filter((r) => String(r.item_key).startsWith('custom-'));
  checked += custom.filter((r) => r.checked).length;
  return { checked, total: template.length + custom.length };
}
