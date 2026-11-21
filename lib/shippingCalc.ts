// 해외 소싱 LCL(해상 혼적) 배송비 계산 - CBM(부피, m³) 기준 요율표.
//
// 사용자가 제공한 실제 요율표(0.5cbm ~ 62.5cbm, BASIC/PREMIUM/SELLER/VIP 전부
// 동일 금액)를 분석해보면: 1cbm당 99,000원으로 정확히 비례하고, 0.5cbm
// 단위로 올림 처리한다. 유일한 예외는 0.5cbm 구간으로, 99,000*0.5=49,500원이
// 아니라 59,000원(최소 청구 금액)이 적용된다. 표 전체를 하드코딩하는 대신
// 이 두 상수 + 올림 규칙으로 계산한다 (요율이 바뀌면 아래 두 값만 고치면 됨).
export const LCL_RATE_PER_CBM = 99000;
export const LCL_MIN_CHARGE = 59000;
export const LCL_CBM_STEP = 0.5;

// cbm을 0.5 단위로 올림한다 (청구 기준 CBM).
export function roundLclCbm(cbm: number): number {
  return Math.ceil(cbm / LCL_CBM_STEP) * LCL_CBM_STEP;
}

// 올림한 CBM에 요율을 곱하고, 최소 청구금액과 비교해 큰 쪽을 반환.
export function computeLclFreightKrw(cbm: number): number {
  if (!cbm || cbm <= 0) return 0;
  return Math.max(LCL_MIN_CHARGE, roundLclCbm(cbm) * LCL_RATE_PER_CBM);
}

// 박스 가로/세로/높이(cm) x 수량으로 총 CBM 계산 (1,000,000cm³ = 1m³)
export function cbmFromDimensions(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  quantity: number
): number {
  if (!lengthCm || !widthCm || !heightCm || !quantity) return 0;
  return (lengthCm * widthCm * heightCm * quantity) / 1_000_000;
}

// LCL 배송비 외에 실제 청구서에 따로 잡히는 부가서비스 항목들 - 화물마다
// 조합이 달라서 고정폼 대신 자유 추가형 리스트로 쓴다. 여기 목록은 항목명
// 자동완성용 프리셋일 뿐이고, amount가 있는 항목(관세사 수임료)만 첫 선택
// 시 참고용으로 금액을 미리 채워준다 - 나머지는 매번 실비가 달라서 직접
// 입력해야 한다.
export interface ShippingExtraFeePreset {
  label: string;
  amount?: number;
}

export const SHIPPING_EXTRA_FEE_PRESETS: ShippingExtraFeePreset[] = [
  { label: '기본검수' },
  { label: '포장보완' },
  { label: '로켓 바코드 스티커' },
  { label: '원산지 표시' },
  { label: '원산지 증명 (C/O)' },
  { label: 'B/L' },
  { label: 'D/O' },
  { label: '입고완료' },
  { label: '밀크런 택배' },
  { label: '화물택배 (착불)' },
  { label: '창고료' },
  // 목록통관 배제/금액초과로 일반(간이)통관 진행 시 붙는 관세사 수임료
  // (사용자 제공 요금 안내 기준 고정값)
  { label: '관세사 수임료 (개인)', amount: 3650 },
  { label: '관세사 수임료 (사업자)', amount: 22000 },
];

// ---- 해외배송비 계산기의 "개당 금액" 계산 (ShippingCostCalculator와 발주 회차 복사가 같이 쓴다) ----
export interface ShippingCalcInput {
  mode: 'direct' | 'dims';
  cbmDirect: string;
  length: string;
  width: string;
  height: string;
  quantity: string;
  extraFees: { label?: string; amount: string; basis: 'total' | 'perUnit' }[];
  taxes?: { on: boolean; dutyRate: string; vatManual: boolean; vat: string; dutyManual: boolean; duty: string };
}

// unitCost(개당 매입원가)를 넘기면 관세·부가세 자동 계산 구역이 있는 것으로 본다 (taxes.on이 켜져 있을 때만 합산).
// 수량은 calc.quantity 문자열을 쓴다(빈칸/0이면 1개로 계산). 부가세 = 매입액/11, 관세 = 매입액 x 관세율.
export function computeShippingPerUnit(calc: ShippingCalcInput, unitCost?: number) {
  const qty = Math.max(1, parseInt(calc.quantity) || 1);
  const cbm =
    calc.mode === 'direct'
      ? parseFloat(calc.cbmDirect) || 0
      : cbmFromDimensions(parseFloat(calc.length) || 0, parseFloat(calc.width) || 0, parseFloat(calc.height) || 0, qty);
  const freight = computeLclFreightKrw(cbm);
  // '전체 화물 기준' 항목은 해상운임과 합쳐서 수량으로 나누고, '개당' 항목은 이미 1개 기준이므로 그대로 더한다.
  const extrasTotalBasis = calc.extraFees
    .filter((r) => r.basis === 'total')
    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const extrasPerUnitBasis = calc.extraFees
    .filter((r) => r.basis === 'perUnit')
    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const taxSupported = unitCost !== undefined;
  const taxOn = !!calc.taxes?.on;
  const taxBase = Math.max(0, unitCost || 0) * qty;
  const dutyRateNum = Math.max(0, parseFloat(calc.taxes?.dutyRate ?? '8') || 0);
  const autoVat = Math.round(taxBase / 11);
  const autoDuty = Math.round((taxBase * dutyRateNum) / 100);
  const vatValue = taxSupported && taxOn ? (calc.taxes!.vatManual ? Math.max(0, parseFloat(calc.taxes!.vat) || 0) : autoVat) : 0;
  const dutyValue = taxSupported && taxOn ? (calc.taxes!.dutyManual ? Math.max(0, parseFloat(calc.taxes!.duty) || 0) : autoDuty) : 0;
  const taxTotal = vatValue + dutyValue;
  const shipmentTotal = freight + extrasTotalBasis + taxTotal;
  const perUnit = shipmentTotal / qty + extrasPerUnitBasis;
  const grandTotal = shipmentTotal + extrasPerUnitBasis * qty;
  return {
    qty, cbm, freight, extrasTotalBasis, extrasPerUnitBasis, taxSupported, taxBase,
    autoVat, autoDuty, vatValue, dutyValue, taxTotal, shipmentTotal, perUnit, grandTotal,
  };
}
