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
  shipping: number | null; // 쿠팡 국내배송비 (정산 내역 기준)
  intlShipping?: number | null; // 해외배송비 (중국->한국, CBM 계산기로 채움) - shipping과 별개 항목. 아직 이 개념이 없는 호출부(옵션 등)도 있어서 선택 필드로 둠
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
  const is = inputs.intlShipping ?? 0;
  const a = inputs.adCost ?? 0;
  const e = inputs.etcCost ?? 0;
  const profit = p - ov - c + iv - fee - s - is - a - e;
  const marginPct = lp > 0 ? (profit / p) * 100 : null;
  return { actualPrice: p, profit, marginPct };
}

export interface MinPriceInputs {
  cost: number | null;
  importVat: number | null;
  shipping: number | null;
  intlShipping: number | null;
  etcCost: number | null;
  feeRatePct: number | null; // 쿠팡수수료율 (%)
  adRatePct: number | null; // 광고비율 (%)
  targetMarginPct: number; // 목표 마진율 (%)
}

export interface MinPriceResult {
  price: number | null; // feasible이 false면 null (의미 없는 가격)
  feasible: boolean;
}

// "목표 마진율을 달성하려면 최소 얼마에 팔아야 하나"를 대수적으로
// 역산한다(이분탐색 아님). computeMargin과 같은 공식을 전제로 함:
//   profit = p - p/11 - cost + importVat - p*feeRate - p*adRate - shipping - intlShipping - etcCost
//          = p*k - F   (k = 1 - 1/11 - feeRate - adRate, F = cost - importVat + shipping + intlShipping + etcCost)
// targetMarginPct = profit/p*100 이 되는 p를 풀면:
//   p*k - F = p*targetMarginPct/100
//   p*(k - targetMarginPct/100) = F
//   p = F / (k - targetMarginPct/100)
// 분모(denom)가 0 이하면(수수료+광고비+목표마진이 너무 커서) 어떤 가격을
// 매겨도 그 마진을 달성할 수 없다 - feasible: false로 알려준다. 쿠폰은
// 이 역산 범위 밖이라 반영하지 않는다.
export function computeMinPriceForTargetMargin(inputs: MinPriceInputs): MinPriceResult {
  const feeRate = (inputs.feeRatePct ?? 0) / 100;
  const adRate = (inputs.adRatePct ?? 0) / 100;
  const k = 1 - 1 / 11 - feeRate - adRate;
  const F =
    (inputs.cost ?? 0) -
    (inputs.importVat ?? 0) +
    (inputs.shipping ?? 0) +
    (inputs.intlShipping ?? 0) +
    (inputs.etcCost ?? 0);
  const denom = k - inputs.targetMarginPct / 100;
  const feasible = denom > 0;
  return { price: feasible ? F / denom : null, feasible };
}
