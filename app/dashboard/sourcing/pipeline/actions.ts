'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const PATH = '/dashboard/sourcing/pipeline';

function numOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function addPipelineCandidate(
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  const title = String(formData.get('title') || '').trim();
  if (!title) return { error: '상품명을 입력해주세요.' };

  const { error } = await supabase.from('pipeline_candidates').insert({
    title,
    category: String(formData.get('category') || '').trim() || null,
    coupang_price: numOrNull(formData, 'coupang_price'),
    coupang_review_count: numOrNull(formData, 'coupang_review_count'),
    coupang_link: String(formData.get('coupang_link') || '').trim() || null,
    coupang_image_url: String(formData.get('coupang_image_url') || '').trim() || null,
    author_email: user.email,
  });

  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: true };
}

// 카드 인라인 수정 - 쿠팡 후보 정보(1단계)와 1688 공급처 정보(2단계)를
// 한 번에 고칠 수 있어야 해서 필드를 나누지 않고 한 폼으로 처리한다.
export async function updatePipelineCandidate(
  id: string,
  formData: FormData
): Promise<{ error: string } | { success: true }> {
  const supabase = createClient();
  const title = String(formData.get('title') || '').trim();
  if (!title) return { error: '상품명을 입력해주세요.' };

  const { error } = await supabase
    .from('pipeline_candidates')
    .update({
      title,
      category: String(formData.get('category') || '').trim() || null,
      coupang_price: numOrNull(formData, 'coupang_price'),
      coupang_review_count: numOrNull(formData, 'coupang_review_count'),
      coupang_link: String(formData.get('coupang_link') || '').trim() || null,
      coupang_image_url: String(formData.get('coupang_image_url') || '').trim() || null,
      supplier_link: String(formData.get('supplier_link') || '').trim() || null,
      supplier_price: numOrNull(formData, 'supplier_price'),
      supplier_notes: String(formData.get('supplier_notes') || '').trim() || null,
    })
    .eq('id', id);

  if (error) return { error: error.message };

  revalidatePath(PATH);
  return { success: true };
}

export async function updatePipelineStage(id: string, stage: string) {
  const supabase = createClient();
  const { error } = await supabase.from('pipeline_candidates').update({ stage }).eq('id', id);
  if (error) console.error('[pipeline] updatePipelineStage 실패:', error.message);
  revalidatePath(PATH);
}

export async function deletePipelineCandidate(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('pipeline_candidates').delete().eq('id', id);
  if (error) console.error('[pipeline] deletePipelineCandidate 실패:', error.message);
  revalidatePath(PATH);
}

// 발주까지 실제로 확정된 후보를 소싱리스트(사람이 깊게 관리하는 곳 -
// 공급처 비교/체크리스트/메모 등)로 넘긴다. 복사만 하고 이 파이프라인
// 카드는 지우지 않는다 - "여기서 나온 게 결국 그 소싱리스트 항목이다"
// 라는 연결 기록(sourcing_item_id)을 남겨둬야 나중에 추적할 수 있다.
export async function promoteToSourcingList(
  id: string
): Promise<{ error: string } | { success: true; sourcingItemId: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: '로그인이 필요해요.' };

  const { data: candidate, error: fetchErr } = await supabase
    .from('pipeline_candidates')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchErr || !candidate) return { error: fetchErr?.message || '후보를 찾을 수 없어요.' };

  const contentLines = [
    candidate.category ? `카테고리: ${candidate.category}` : null,
    candidate.coupang_link ? `쿠팡 후보 링크: ${candidate.coupang_link}` : null,
    candidate.supplier_link ? `1688 공급처: ${candidate.supplier_link}` : null,
    candidate.supplier_price != null ? `1688 가격: ${candidate.supplier_price}` : null,
    candidate.supplier_notes || null,
  ].filter(Boolean);

  const { data: item, error: insertErr } = await supabase
    .from('sourcing_items')
    .insert({
      title: candidate.title,
      link: candidate.coupang_link || candidate.supplier_link || null,
      content: contentLines.length > 0 ? contentLines.join('\n') : null,
      price: candidate.coupang_price,
      author_email: user.email,
    })
    .select('id')
    .single();
  if (insertErr || !item) return { error: insertErr?.message || '소싱리스트 등록에 실패했어요.' };

  const { error: updateErr } = await supabase
    .from('pipeline_candidates')
    .update({ sourcing_item_id: item.id, promoted_at: new Date().toISOString() })
    .eq('id', id);
  if (updateErr) return { error: updateErr.message };

  revalidatePath(PATH);
  revalidatePath('/dashboard/sourcing/list');
  return { success: true, sourcingItemId: item.id };
}
