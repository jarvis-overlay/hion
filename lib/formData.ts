// FormData에서 값을 읽는 순수 함수들 ('use server' 파일에서는 async 함수만 export할 수 있어서 따로 둠).

export function numOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ShippingCostCalculator가 hidden input에 JSON 문자열로 담아 보낸다 -
// jsonb 컬럼에는 파싱한 객체로 넣어야 나중에 읽을 때(Supabase가 자동
// 파싱) 다시 그대로 쓸 수 있다.
export function jsonOrNull(fd: FormData, key: string): unknown | null {
  const v = fd.get(key);
  if (v == null || v === '') return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

// 마진 입력 컬럼 묶음 (updateSourcingMargin이 읽는 것과 같다). fee_category는 따로 다룬다(기존 액션이 컬럼 유무에 따라 분기).
export function marginRowFromFormData(fd: FormData): Record<string, any> {
  return {
    price: numOrNull(fd, 'price'),
    cost: numOrNull(fd, 'cost'),
    coupon: numOrNull(fd, 'coupon'),
    output_vat: numOrNull(fd, 'output_vat'),
    import_vat: numOrNull(fd, 'import_vat'),
    coupang_fee: numOrNull(fd, 'coupang_fee'),
    shipping: numOrNull(fd, 'shipping'),
    intl_shipping: numOrNull(fd, 'intl_shipping'),
    intl_shipping_calc: jsonOrNull(fd, 'intl_shipping_calc'),
    ad_cost: numOrNull(fd, 'ad_cost'),
    etc_cost: numOrNull(fd, 'etc_cost'),
    cost_fx_currency: String(fd.get('cost_fx_currency') || '').trim() || null,
    cost_fx_amount: numOrNull(fd, 'cost_fx_amount'),
    cost_fx_rate: numOrNull(fd, 'cost_fx_rate'),
  };
}

// 쿠팡 수수료 카테고리 (최대 60자, 빈칸이면 null)
export function feeCategoryFromFormData(fd: FormData): string | null {
  return String(fd.get('fee_category') || '').trim().slice(0, 60) || null;
}
