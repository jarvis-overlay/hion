'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { marginRowFromFormData, feeCategoryFromFormData } from '@/lib/formData';

type Result = { error: string } | { success: true };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING_RE = /PGRST205|42P01|schema cache|relation .* does not exist/i;
const MISSING_MSG = '발주 이력 기능 준비 중이라 저장할 수 없어요.';

// 회차 공통 입력(수량·발주일·메모·마진 컬럼)을 읽어 검증한다. 실패하면 error 문구를 돌려준다.
function parseOrderForm(fd: FormData): { error: string } | { row: Record<string, any> } {
  const qtyRaw = String(fd.get('quantity') ?? '').trim();
  let quantity: number | null = null;
  if (qtyRaw !== '') {
    if (!/^\d+$/.test(qtyRaw) || Number(qtyRaw) < 1 || Number(qtyRaw) > 2_000_000_000) {
      return { error: '수량은 1 이상의 정수로 입력해주세요.' };
    }
    quantity = Number(qtyRaw);
  }
  const dateRaw = String(fd.get('ordered_at') ?? '').trim();
  let orderedAt: string | null = null;
  if (dateRaw !== '') {
    const d = new Date(dateRaw + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateRaw) {
      return { error: '발주일은 날짜 형식(YYYY-MM-DD)으로 입력해주세요.' };
    }
    orderedAt = dateRaw;
  }
  const note = String(fd.get('note') ?? '').trim();
  if (note.length > 500) return { error: '메모는 500자 이내로 입력해주세요.' };

  const row: Record<string, any> = {
    ...marginRowFromFormData(fd),
    fee_category: feeCategoryFromFormData(fd),
    quantity,
    ordered_at: orderedAt,
    note: note || null,
  };
  // 계산기 JSON 안의 수량은 회차 수량과 항상 같게 맞춘다
  if (row.intl_shipping_calc && typeof row.intl_shipping_calc === 'object') {
    row.intl_shipping_calc = { ...row.intl_shipping_calc, quantity: quantity != null ? String(quantity) : '' };
  }
  return { row };
}

// DB 오류를 사용자가 읽을 수 있는 한국어로 바꾼다 (영어 원문은 마지막 수단으로만 보여준다)
function dbErrorMessage(err: { code?: string; message?: string } | null | undefined, verb: '저장' | '삭제', missingMsg: string): string {
  const message = err?.message ?? '';
  if (err?.code === '23503') return '이 상품이 이미 삭제된 것 같아요. 새로고침 해주세요.';
  if (err?.code === '42501') return '권한이 없어요. 다시 로그인해 주세요.';
  if (err?.code === 'PGRST205' || err?.code === '42P01' || MISSING_RE.test(message)) return missingMsg;
  return `${verb} 실패: ${message || '알 수 없는 오류'}`;
}
function failMessage(e: unknown): string {
  return dbErrorMessage({ message: (e as any)?.message ?? String(e) }, '저장', MISSING_MSG);
}

// 로그인 확인 (기존 addSourcingItem과 같은 방식)
async function requireUser(supabase: ReturnType<typeof createClient>): Promise<{ error: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? null : { error: '로그인이 필요해요.' };
}

// 새 회차 추가. round_no는 보내지 않는다(DB 트리거가 최대 회차 + 1을 넣는다).
// fd의 id(uuid)를 PK로 쓰므로 같은 요청이 두 번 와도(더블클릭·재시도) 한 번만 들어간다.
export async function addSourcingOrder(sourcingItemId: string, fd: FormData): Promise<Result> {
  try {
    if (!UUID_RE.test(sourcingItemId)) return { error: '상품 정보가 올바르지 않아요. 새로고침 후 다시 시도해주세요.' };
    const id = String(fd.get('id') ?? '').trim();
    if (id && !UUID_RE.test(id)) return { error: '요청 정보가 올바르지 않아요. 새로고침 후 다시 시도해주세요.' };
    const parsed = parseOrderForm(fd);
    if ('error' in parsed) return parsed;

    const supabase = createClient();
    const authErr = await requireUser(supabase);
    if (authErr) return authErr;
    const payload = { ...(id ? { id } : {}), sourcing_item_id: sourcingItemId, ...parsed.row };
    let { error } = await supabase.from('sourcing_item_orders').insert(payload);
    if (error && error.code === '23505') {
      if (/sourcing_item_orders_pkey|\(id\)/.test(error.message + ' ' + (error.details ?? ''))) {
        // 같은 id가 이미 저장됨 = 앞선 요청이 성공했던 것
        error = null;
      } else {
        // 동시에 다른 회차가 들어가 번호가 겹친 경우 - 한 번만 다시 시도
        ({ error } = await supabase.from('sourcing_item_orders').insert(payload));
        if (error && error.code === '23505' && /sourcing_item_orders_pkey|\(id\)/.test(error.message + ' ' + (error.details ?? ''))) error = null;
      }
    }
    if (error) return { error: dbErrorMessage(error, '저장', MISSING_MSG) };

    revalidatePath('/dashboard/sourcing/list');
    return { success: true };
  } catch (e: any) {
    return { error: failMessage(e) };
  }
}

export async function updateSourcingOrder(orderId: string, fd: FormData): Promise<Result> {
  try {
    if (!UUID_RE.test(orderId)) return { error: '발주 기록 정보가 올바르지 않아요. 새로고침 후 다시 시도해주세요.' };
    const parsed = parseOrderForm(fd);
    if ('error' in parsed) return parsed;

    const supabase = createClient();
    const authErr = await requireUser(supabase);
    if (authErr) return authErr;
    const { data, error } = await supabase
      .from('sourcing_item_orders')
      .update({ ...parsed.row, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select('id');
    if (error) return { error: dbErrorMessage(error, '저장', MISSING_MSG) };
    if (!data || data.length === 0) return { error: '저장할 발주 기록을 찾지 못했어요. 새로고침 후 다시 시도해주세요.' };

    revalidatePath('/dashboard/sourcing/list');
    return { success: true };
  } catch (e: any) {
    return { error: failMessage(e) };
  }
}

export async function deleteSourcingOrder(orderId: string): Promise<Result> {
  try {
    if (!UUID_RE.test(orderId)) return { error: '발주 기록 정보가 올바르지 않아요. 새로고침 후 다시 시도해주세요.' };
    const supabase = createClient();
    const authErr = await requireUser(supabase);
    if (authErr) return authErr;
    const { data, error } = await supabase.from('sourcing_item_orders').delete().eq('id', orderId).select('id');
    if (error) return { error: dbErrorMessage(error, '삭제', '발주 이력 기능 준비 중이라 삭제할 수 없어요.') };
    if (!data || data.length === 0) return { error: '이미 삭제됐거나 권한이 없어요.' };

    revalidatePath('/dashboard/sourcing/list');
    return { success: true };
  } catch (e: any) {
    return { error: dbErrorMessage({ message: e?.message ?? String(e) }, '삭제', '발주 이력 기능 준비 중이라 삭제할 수 없어요.') };
  }
}
