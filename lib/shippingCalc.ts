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

// cbm을 0.5 단위로 올림한 뒤 요율 곱하고, 최소 청구금액과 비교해 큰 쪽을 반환.
export function computeLclFreightKrw(cbm: number): number {
  if (!cbm || cbm <= 0) return 0;
  const roundedCbm = Math.ceil(cbm / LCL_CBM_STEP) * LCL_CBM_STEP;
  return Math.max(LCL_MIN_CHARGE, roundedCbm * LCL_RATE_PER_CBM);
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
  { label: '원산지 표시' },
  { label: '원산지 증명 (C/O)' },
  { label: 'B/L' },
  { label: 'D/O' },
  { label: '입고완료' },
  { label: '밀크런 택배' },
  { label: '화물택배 (착불)' },
  { label: '창고료' },
  { label: '관·부가세' },
  // 목록통관 배제/금액초과로 일반(간이)통관 진행 시 붙는 관세사 수임료
  // (사용자 제공 요금 안내 기준 고정값)
  { label: '관세사 수임료 (개인)', amount: 3650 },
  { label: '관세사 수임료 (사업자)', amount: 22000 },
];
