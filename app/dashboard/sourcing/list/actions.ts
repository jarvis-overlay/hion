'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

function numOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function addSourcingItem(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const title = String(formData.get('title') || '').trim();
  const link = String(formData.get('link') || '').trim();
  const content = String(formData.get('content') || '').trim();
  const moq = String(formData.get('moq') || '').trim();

  if (!title) return;

  await supabase.from('sourcing_items').insert({
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
  });

  revalidatePath('/dashboard/sourcing/list');
}

// 카드 인라인 수정 - 상태/후보-확정 말고 나머지 항목(상품명, 링크,
// 메모, 마진 관련 수치 전체)까지 한번에 고칠 수 있어야 한다는 요청으로
// 추가함.
export async function updateSourcingItem(id: string, formData: FormData) {
  const supabase = createClient();
  const title = String(formData.get('title') || '').trim();
  if (!title) return;

  await supabase
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

  revalidatePath('/dashboard/sourcing/list');
}

export async function updateSourcingStatus(id: string, status: string) {
  const supabase = createClient();
  await supabase.from('sourcing_items').update({ status }).eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}

export async function updateSourcingStage(id: string, stage: string) {
  const supabase = createClient();
  await supabase.from('sourcing_items').update({ stage }).eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}

export async function deleteSourcingItem(id: string) {
  const supabase = createClient();
  await supabase.from('sourcing_items').delete().eq('id', id);
  revalidatePath('/dashboard/sourcing/list');
}
