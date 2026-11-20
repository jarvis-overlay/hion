// 쿠팡 로켓그로스 "사이즈 유형" 분류 + 개당 입출고·배송 요금 계산 (순수 함수 + 브라우저 저장 요금표).
//
// 분류 기준(쿠팡 화면 "로켓그로스 사이즈 유형", 개별 포장 상품 기준): 가로+세로+높이(세 변의 합, cm)와 무게(kg)를
// 각각 구간에 대어 보고, **둘 중 더 큰 쪽**이 최종 유형이다 (예: 세 변의 합은 극소형, 무게는 소형이면 소형).
//   극소형  ~80cm   / ~2kg
//   소형    ~100cm  / ~5kg      (초과~이하)
//   중형    ~120cm  / ~10kg
//   대형1   ~140cm  / ~15kg
//   대형2   ~160cm  / ~20kg
//   특대형  ~250cm  / ~30kg
//   특대형보다 크면 입고 불가.
//
// 요금(입출고비·배송비)은 쿠팡이 카테고리·판매가·시점에 따라 다르게 매긴다. 사용자 화면에 요금표가 없어서
// 쿠팡 공식 패션 카테고리 안내의 "시작 요금"을 기본값으로 넣고, 사용자가 윙(WING) 요금표대로 고쳐 쓰게 한다.

export type RgSizeId = 'xs' | 's' | 'm' | 'l1' | 'l2' | 'xl';

export interface RgSize {
  id: RgSizeId;
  name: string;
  maxSumCm: number; // 세 변의 합 상한(이하)
  maxKg: number; // 무게 상한(이하)
}

export const RG_SIZES: RgSize[] = [
  { id: 'xs', name: '극소형', maxSumCm: 80, maxKg: 2 },
  { id: 's', name: '소형', maxSumCm: 100, maxKg: 5 },
  { id: 'm', name: '중형', maxSumCm: 120, maxKg: 10 },
  { id: 'l1', name: '대형1', maxSumCm: 140, maxKg: 15 },
  { id: 'l2', name: '대형2', maxSumCm: 160, maxKg: 20 },
  { id: 'xl', name: '특대형', maxSumCm: 250, maxKg: 30 },
];

export interface RgClassification {
  id: RgSizeId | null; // null = 입고 불가(특대형보다 큼) 또는 입력 부족
  name: string; // 화면 표시용 ("중형" / "입고 불가")
  sumCm: number;
  weightKg: number | null;
  bySize: RgSizeId | null; // 세 변의 합만으로 정한 유형
  byWeight: RgSizeId | null; // 무게만으로 정한 유형
  weightMissing: boolean; // 무게를 안 넣어서 크기만으로 정함
  overLimit: boolean; // 크기나 무게가 특대형 상한을 넘음
  reason: string; // 사용자에게 보여줄 근거 한 줄
}

function indexById(id: RgSizeId | null): number {
  return id ? RG_SIZES.findIndex((s) => s.id === id) : -1;
}

function sizeBySum(sum: number): RgSizeId | null {
  for (const s of RG_SIZES) if (sum <= s.maxSumCm) return s.id;
  return null;
}

function sizeByWeight(kg: number): RgSizeId | null {
  for (const s of RG_SIZES) if (kg <= s.maxKg) return s.id;
  return null;
}

export function sizeName(id: RgSizeId | null): string {
  return RG_SIZES.find((s) => s.id === id)?.name ?? '입고 불가';
}

// 가로·세로·높이(cm)가 모두 0보다 클 때만 분류한다. 무게(kg)는 없으면 크기만 본다.
export function classifyRocketGrowth(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  weightKg: number | null
): RgClassification | null {
  if (!(lengthCm > 0) || !(widthCm > 0) || !(heightCm > 0)) return null;
  const sum = Math.round((lengthCm + widthCm + heightCm) * 10) / 10;
  const hasWeight = weightKg != null && Number.isFinite(weightKg) && weightKg > 0;
  const bySize = sizeBySum(sum);
  const byWeight = hasWeight ? sizeByWeight(weightKg as number) : null;
  const overBySize = bySize === null;
  const overByWeight = hasWeight && byWeight === null;
  if (overBySize || overByWeight) {
    return {
      id: null,
      name: '입고 불가',
      sumCm: sum,
      weightKg: hasWeight ? (weightKg as number) : null,
      bySize,
      byWeight,
      weightMissing: !hasWeight,
      overLimit: true,
      reason: overBySize
        ? `세 변의 합 ${sum}cm가 특대형 상한(250cm)을 넘어서 입고할 수 없어요.`
        : `무게 ${weightKg}kg이 특대형 상한(30kg)을 넘어서 입고할 수 없어요.`,
    };
  }
  const idx = Math.max(indexById(bySize), indexById(byWeight));
  const final = RG_SIZES[idx].id;
  const parts = [`세 변의 합 ${sum}cm → ${sizeName(bySize)}`];
  if (hasWeight) parts.push(`무게 ${weightKg}kg → ${sizeName(byWeight)}`);
  const reason = hasWeight
    ? `${parts.join(', ')}${bySize !== byWeight ? ` (둘 중 큰 쪽인 ${sizeName(final)} 적용)` : ''}`
    : `${parts[0]} (무게를 넣으면 더 정확해요 - 무게가 더 크면 큰 쪽이 적용돼요)`;
  return {
    id: final,
    name: RG_SIZES[idx].name,
    sumCm: sum,
    weightKg: hasWeight ? (weightKg as number) : null,
    bySize,
    byWeight,
    weightMissing: !hasWeight,
    overLimit: false,
    reason,
  };
}

// ---------------------------------------------------------------------------
// 요금표
// ---------------------------------------------------------------------------
export interface RgFeeRow {
  inout: number; // 입출고비 (원, 개당)
  delivery: number; // 배송비 (원, 개당)
}
export interface RgFeeTable {
  fees: Record<RgSizeId, RgFeeRow>;
  vat: boolean; // true면 합계에 부가세 10%를 더해서 반영
}

// 쿠팡 공식 패션 카테고리 안내의 "시작 요금"(부가세 별도). 뷰티 안내 등 다른 카테고리는 배송비가 더 높게 표기돼 있어서
// 실제 요금은 윙에서 확인해 고쳐야 한다.
export const RG_DEFAULT_TABLE: RgFeeTable = {
  fees: {
    xs: { inout: 600, delivery: 1125 },
    s: { inout: 650, delivery: 1250 },
    m: { inout: 1250, delivery: 1500 },
    l1: { inout: 1375, delivery: 1700 },
    l2: { inout: 1375, delivery: 2900 },
    xl: { inout: 1375, delivery: 3500 },
  },
  vat: false,
};

// 쿠팡 공식 공개 페이지 두 곳의 "시작 요금"(2026-11-20 확인). 같은 시점인데 배송비 표기가 달라서(카테고리·판매가별 최종 금액은 WING 로그인 안쪽 표에만 있다) 둘 다 프리셋으로 둔다.
//  - 'general': marketplace.coupang.com/rocketgrowth-fee-after-zerocostpromotion ("로켓그로스 비용/수수료")
//  - 'fashion': marketplace.coupang.com/rocket-growth/product-categories/clothes · core-fashion(생활 필수품) 안내
export const RG_PRESETS: { id: 'general' | 'fashion'; name: string; fees: RgFeeTable['fees'] }[] = [
  {
    id: 'fashion',
    name: '패션·생활필수품 안내',
    fees: RG_DEFAULT_TABLE.fees,
  },
  {
    id: 'general',
    name: '일반 비용 안내',
    fees: {
      xs: { inout: 600, delivery: 1350 },
      s: { inout: 650, delivery: 1550 },
      m: { inout: 1250, delivery: 2100 },
      l1: { inout: 1375, delivery: 2200 },
      l2: { inout: 1375, delivery: 4100 },
      xl: { inout: 1375, delivery: 5600 },
    },
  },
];

export function cloneDefaultTable(): RgFeeTable {
  return { fees: Object.fromEntries(RG_SIZES.map((s) => [s.id, { ...RG_DEFAULT_TABLE.fees[s.id] }])) as RgFeeTable['fees'], vat: RG_DEFAULT_TABLE.vat };
}

// 개당 입출고+배송 합계 (부가세 옵션 반영, 원 단위 반올림)
export function rgFeeFor(id: RgSizeId | null, table: RgFeeTable): number | null {
  if (!id) return null;
  const row = table.fees[id];
  if (!row) return null;
  const total = (Number(row.inout) || 0) + (Number(row.delivery) || 0);
  return Math.round(table.vat ? total * 1.1 : total);
}

// 저장된(또는 이상한) 값을 안전하게 요금표로 바꾼다 - 빠진 항목은 기본값으로 채운다
export function normalizeTable(raw: unknown): RgFeeTable {
  const base = cloneDefaultTable();
  const r = raw as any;
  if (!r || typeof r !== 'object') return base;
  for (const s of RG_SIZES) {
    const row = r.fees?.[s.id];
    const inout = Number(row?.inout);
    const delivery = Number(row?.delivery);
    if (Number.isFinite(inout) && inout >= 0) base.fees[s.id].inout = Math.round(inout);
    if (Number.isFinite(delivery) && delivery >= 0) base.fees[s.id].delivery = Math.round(delivery);
  }
  base.vat = r.vat === true;
  return base;
}

// 요금표는 이 브라우저(localStorage)에 저장한다. 접근이 막혀 있으면 기본값만 쓴다.
const TABLE_KEY = 'hion.rocketGrowthFees.v1';

export function loadRgTable(): RgFeeTable {
  try {
    const raw = localStorage.getItem(TABLE_KEY);
    return raw ? normalizeTable(JSON.parse(raw)) : cloneDefaultTable();
  } catch {
    return cloneDefaultTable();
  }
}

export function saveRgTable(table: RgFeeTable): boolean {
  try {
    localStorage.setItem(TABLE_KEY, JSON.stringify(table));
    return true;
  } catch {
    return false;
  }
}

export function clearRgTable(): void {
  try {
    localStorage.removeItem(TABLE_KEY);
  } catch {
    // 지우지 못해도 화면은 기본값으로 돌아가므로 무시
  }
}
