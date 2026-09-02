'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

function numOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 비교 상품군 링크 하나 - 쿠팡/네이버에서 관찰한 가격대·시장규모를 각각
// 여러 건 남길 수 있다(같은 플랫폼 안에서도 가격대별 시장규모가 다르게
// 형성돼 있을 수 있어서).
export interface ComparisonPriceInput {
  platform: 'coupang' | 'naver';
  priceRange: string;
  marketSize: 'high' | 'mid' | 'low' | '';
}
export interface ComparisonInput {
  title: string;
  link: string;
  prices: ComparisonPriceInput[];
}

async function insertComparisons(
  supabase: ReturnType<typeof createClient>,
  sourcingItemId: string,
  comparisons: ComparisonInput[]
): Promise<string | null> {
  for (const c of comparisons) {
    const { data: comp, error: compErr } = await supabase
      .from('sourcing_item_comparisons')
      .insert({ sourcing_item_id: sourcingItemId, title: c.title || null, link: c.link || null })
      .select('id')
      .single();
    if (compErr) return compErr.message;

    if (c.prices.length > 0) {
      const { error: priceErr } = await supabase.from('sourcing_comparison_prices').insert(
        c.prices.map((p) => ({
          comparison_id: (comp as { id: string }).id,
          platform: p.platform,
          price_range: p.priceRange || null,
          market_size: p.marketSize || null,
        }))
      );
      if (priceErr) return priceErr.message;
    }
  }
  return null;
}

export async function addSourcingItem(
  formData: FormData,
  comparisons: ComparisonInput[] = []
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  const title = String(formData.get('title') || '').trim();
  const link = String(formData.get('link') || '').trim();
  const content = String(formData.get('content') || '').trim();
  const moq = String(formData.get('moq') || '').trim();

  if (!title) return { error: '상품명을 입력해주세요.' };

  const { data: item, error } = await supabase
    .from('sourcing_items')
    .insert({
      title,
      link: link || null,
      content: content || null,
      moq: moq || null,
      price: numOrNull(formData, 'price'),
      cost: numOrNull(formData, 'cost'),
      coupon: numOrNull(formData, 'coupon'),
      output_vat: numOrNull(formData, 'output_vat'),
      import_vat: numOrNull(formData, 'import_vat'),
      coupang_fee: numOrNull(formData, 'coupang_fee'),
      shipping: numOrNull(formData, 'shipping'),
      ad_cost: numOrNull(formData, 'ad_cost'),
      etc_cost: numOrNull(formData, 'etc_cost'),
      author_email: user.email,
    })
    .select('id')
    .single();

  if (error) return { error: error.message };

  if (comparisons.length > 0 && item) {
    const compErr = await insertComparisons(supabase, (item as { id: string }).id, comparisons);
    if (compErr) return { error: compErr };
  }

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

// 이미 등록된 소싱 후보에 비교 상품군을 나중에 추가 (옵션 구성/공급처
// 비교와 같은 패턴 - 카드 안에서 펼쳐서 즉시 추가).
export async function addSourcingComparison(
  sourcingItemId: string,
  comparison: ComparisonInput
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const err = await insertComparisons(supabase, sourcingItemId, [comparison]);
  if (err) return { error: err };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

// 비교 상품 하나를 수정 - 가격/시장규모 관측치는 개별로 diff하지 않고
// 통째로 지우고 새로 넣는 게 단순하고 안전하다 (편집 중 추가/삭제/수정이
// 뒤섞여도 항상 최종 상태만 반영하면 됨).
export async function updateSourcingComparison(
  comparisonId: string,
  comparison: ComparisonInput
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();

  const { error: updateErr } = await supabase
    .from('sourcing_item_comparisons')
    .update({ title: comparison.title || null, link: comparison.link || null })
    .eq('id', comparisonId);
  if (updateErr) return { error: updateErr.message };

  const { error: delErr } = await supabase
    .from('sourcing_comparison_prices')
    .delete()
    .eq('comparison_id', comparisonId);
  if (delErr) return { error: delErr.message };

  if (comparison.prices.length > 0) {
    const { error: insErr } = await supabase.from('sourcing_comparison_prices').insert(
      comparison.prices.map((p) => ({
        comparison_id: comparisonId,
        platform: p.platform,
        price_range: p.priceRange || null,
        market_size: p.marketSize || null,
      }))
    );
    if (insErr) return { error: insErr.message };
  }

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function deleteSourcingComparison(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_comparisons').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingComparison 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// 카드 인라인 수정 - 상태/후보-확정 말고 나머지 항목(상품명, 링크,
// 메모, 마진 관련 수치 전체)까지 한번에 고칠 수 있어야 한다는 요청으로
// 추가함.
export async function updateSourcingItem(
  id: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const title = String(formData.get('title') || '').trim();
  if (!title) return { error: '상품명을 입력해주세요.' };

  const { error } = await supabase
    .from('sourcing_items')
    .update({
      title,
      link: String(formData.get('link') || '').trim() || null,
      content: String(formData.get('content') || '').trim() || null,
      moq: String(formData.get('moq') || '').trim() || null,
      price: numOrNull(formData, 'price'),
      cost: numOrNull(formData, 'cost'),
      coupon: numOrNull(formData, 'coupon'),
      output_vat: numOrNull(formData, 'output_vat'),
      import_vat: numOrNull(formData, 'import_vat'),
      coupang_fee: numOrNull(formData, 'coupang_fee'),
      shipping: numOrNull(formData, 'shipping'),
      ad_cost: numOrNull(formData, 'ad_cost'),
      etc_cost: numOrNull(formData, 'etc_cost'),
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function updateSourcingStatus(id: string, status: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_items').update({ status }).eq('id', id);
  if (error) console.error('[sourcing] updateSourcingStatus 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

export async function updateSourcingStage(id: string, stage: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_items').update({ stage }).eq('id', id);
  if (error) console.error('[sourcing] updateSourcingStage 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

export async function deleteSourcingItem(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_items').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingItem 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// 같은 상품이라도 색상/사이즈 등 옵션마다 가격·원가가 달라서 마진을
// 따로 계산해야 한다는 요청으로 추가함 - sourcing_items 1건에 여러
// 옵션을 붙일 수 있음.
export async function addSourcingOption(
  sourcingItemId: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const name = String(formData.get('name') || '').trim();
  if (!name) return { error: '옵션명을 입력해주세요.' };

  const { error } = await supabase.from('sourcing_item_options').insert({
    sourcing_item_id: sourcingItemId,
    name,
    price: numOrNull(formData, 'price'),
    cost: numOrNull(formData, 'cost'),
    coupon: numOrNull(formData, 'coupon'),
    output_vat: numOrNull(formData, 'output_vat'),
    import_vat: numOrNull(formData, 'import_vat'),
    coupang_fee: numOrNull(formData, 'coupang_fee'),
    shipping: numOrNull(formData, 'shipping'),
    ad_cost: numOrNull(formData, 'ad_cost'),
    etc_cost: numOrNull(formData, 'etc_cost'),
  });

  if (error) return { error: error.message };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function deleteSourcingOption(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_options').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingOption 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}

// 하나의 상품을 소싱할 때 여러 1688/알리바바 공급처를 가격 비교하면서
// 찾는 경우가 있다는 요청으로 추가함 - sourcing_items 1건에 여러
// 공급처 후보(링크+가격)를 붙일 수 있음.
export async function addSourcingSupplier(
  sourcingItemId: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const link = String(formData.get('link') || '').trim();
  const price = numOrNull(formData, 'price');
  if (!link && price == null) return { error: '링크나 가격 중 하나는 입력해주세요.' };

  const { error } = await supabase.from('sourcing_item_suppliers').insert({
    sourcing_item_id: sourcingItemId,
    link: link || null,
    price,
    currency: String(formData.get('currency') || 'CNY'),
    notes: String(formData.get('notes') || '').trim() || null,
  });

  if (error) return { error: error.message };

  revalidatePath('/dashboard/sourcing/list');
  return { success: true };
}

export async function deleteSourcingSupplier(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_suppliers').delete().eq('id', id);
  if (error) console.error('[sourcing] deleteSourcingSupplier 실패:', error.message);
  revalidatePath('/dashboard/sourcing/list');
}
