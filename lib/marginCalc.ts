// 소싱 리스트 등록 폼(실시간 미리보기)과 소싱 리스트 카드(저장된 값
// 기준)가 똑같은 마진 공식을 쓰도록 한 곳에 모아둠 - 마진 계산기
// 페이지와도 동일한 공식.
export interface MarginInputs {
  price: number | null; // 판매가(정가)
  coupon: number | null; // 쿠폰 할인액 (선택)
  cost: number | null; // 매입 원가
  outputVat: number | null;
  importVat: number | null;
  coupangFee: number | null;
  shipping: number | null;
  adCost: number | null; // 광고비 (선택)
  etcCost: number | null;
}

export interface MarginResult {
  actualPrice: number; // 쿠폰 할인 적용 후 실제 판매가
  profit: number; // 최종 마진 금액
  marginPct: number | null; // 판매가 대비 마진율 (%) - 판매가 없으면 null
}

export function computeMargin(inputs: MarginInputs): MarginResult {
  const lp = inputs.price ?? 0;
  const cp = inputs.coupon ?? 0;
  const p = Math.max(0, lp - cp);
  const c = inputs.cost ?? 0;
  const ov = inputs.outputVat ?? 0;
  const iv = inputs.importVat ?? 0;
  const fee = inputs.coupangFee ?? 0;
  const s = inputs.shipping ?? 0;
  const a = inputs.adCost ?? 0;
  const e = inputs.etcCost ?? 0;
  const profit = p - ov - c + iv - fee - s - a - e;
  const marginPct = lp > 0 ? (profit / p) * 100 : null;
  return { actualPrice: p, profit, marginPct };
}
