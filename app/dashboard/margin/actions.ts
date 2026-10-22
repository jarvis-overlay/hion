'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

interface MarginEntryInput {
  name: string;
  price: number; // 쿠폰 적용 후 실제 판매가
  coupon: number;
  cost: number;
  output_vat: number;
  import_vat: number;
  coupang_fee: number;
  shipping: number; // 쿠팡 국내 배송비
  intl_shipping: number; // 해외배송비(CBM)
  ad_cost: number;
  etc_cost: number;
  profit: number;
  margin_pct: number;
}

// coupon/intl_shipping 컬럼은 마이그레이션(supabase/margin_entries_add_intl_shipping.sql)을
// 돌려야 생긴다. 아직 안 돌렸어도 저장이 실패하지 않도록, 컬럼이 없다는 에러면
// 해외배송비를 배송비에 합산한 예전 형태로 다시 저장한다 (총마진 값은 동일).
function isMissingColumnError(message: string) {
  return /could not find the .* column|column .* does not exist/i.test(message);
}

export async function addMarginEntry(
  data: MarginEntryInput
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };
  if (!data.name.trim() || data.price <= 0) return { error: '상품명과 판매가를 입력해주세요.' };

  let { error } = await supabase.from('margin_entries').insert({
    ...data,
    author_email: user.email,
  });

  if (error && isMissingColumnError(error.message)) {
    const { coupon: _coupon, intl_shipping, ...legacy } = data;
    ({ error } = await supabase.from('margin_entries').insert({
      ...legacy,
      shipping: legacy.shipping + intl_shipping,
      author_email: user.email,
    }));
  }

  if (error) return { error: error.message };

  revalidatePath('/dashboard/margin');
  return { success: true };
}

export async function deleteMarginEntry(id: string) {
  const supabase = createClient();
  await supabase.from('margin_entries').delete().eq('id', id);
  revalidatePath('/dashboard/margin');
}
