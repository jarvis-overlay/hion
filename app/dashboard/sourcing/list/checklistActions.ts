'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { translateToChineseForSourcing, type SourcingZhTranslation } from '@/lib/ai';

const PATH = '/dashboard/sourcing/list';

// 템플릿 항목이든 커스텀 항목이든, 처음 체크하거나 메모를 남기는 순간
// 행을 하나 만든다(upsert) - 손 안 댄 항목은 DB에 아예 없고 화면에서
// 템플릿 기본값(미체크)으로만 보여준다.
export async function upsertChecklistItem(
  sourcingItemId: string,
  itemKey: string,
  label: string,
  patch: { checked?: boolean; note?: string }
) {
  const supabase = createClient();
  const { error } = await supabase
    .from('sourcing_item_checklist')
    .upsert(
      {
        sourcing_item_id: sourcingItemId,
        item_key: itemKey,
        label,
        ...patch,
      },
      { onConflict: 'sourcing_item_id,item_key' }
    );
  if (error) console.error('[sourcing checklist] upsert 실패:', error.message);
  revalidatePath(PATH);
}

export async function addCustomChecklistItem(sourcingItemId: string, label: string) {
  if (!label.trim()) return;
  const supabase = createClient();
  const itemKey = `custom-${randomUUID()}`;
  const { error } = await supabase.from('sourcing_item_checklist').insert({
    sourcing_item_id: sourcingItemId,
    item_key: itemKey,
    label: label.trim(),
    checked: false,
  });
  if (error) console.error('[sourcing checklist] 커스텀 항목 추가 실패:', error.message);
  revalidatePath(PATH);
}

export async function deleteChecklistItem(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_item_checklist').delete().eq('id', id);
  if (error) console.error('[sourcing checklist] 삭제 실패:', error.message);
  revalidatePath(PATH);
}

// 라벨(한국어)만 받아서 중국어 문구를 자동으로 만든다 - 기본 항목을
// 추가/수정할 때마다 직접 중국어를 입력할 필요 없게 하기 위함. 번역
// 실패해도(키 문제 등) 항목 추가/수정 자체는 막지 않고 zh_hint만
// null로 둔다 - 나중에 라벨을 다시 저장하면 그때 재시도된다.
async function translateLabelToZhHint(label: string): Promise<string | null> {
  try {
    const translated = await translateToChineseForSourcing(label);
    return translated.formal || translated.casual || null;
  } catch (e) {
    console.error('[sourcing checklist] 중국어 자동 번역 실패:', e);
    return null;
  }
}

// 기본 체크리스트 항목(모든 소싱 아이템에 공통 적용) 관리 - 개별
// 아이템에만 붙는 커스텀 항목(addCustomChecklistItem)과 달리, 여기서
// 추가/삭제/수정하면 모든 상품의 체크리스트에 반영된다.
export async function addChecklistTemplateItem(label: string) {
  if (!label.trim()) return;
  const supabase = createClient();
  const { data: maxRow } = await supabase
    .from('sourcing_checklist_templates')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? -1) + 1;
  const zhHint = await translateLabelToZhHint(label.trim());
  const { error } = await supabase.from('sourcing_checklist_templates').insert({
    item_key: `tpl-${randomUUID()}`,
    label: label.trim(),
    zh_hint: zhHint,
    position: nextPosition,
  });
  if (error) console.error('[sourcing checklist] 기본 항목 추가 실패:', error.message);
  revalidatePath(PATH);
}

export async function updateChecklistTemplateItem(id: string, label: string) {
  if (!label.trim()) return;
  const supabase = createClient();
  const zhHint = await translateLabelToZhHint(label.trim());
  const { error } = await supabase
    .from('sourcing_checklist_templates')
    .update({ label: label.trim(), zh_hint: zhHint })
    .eq('id', id);
  if (error) console.error('[sourcing checklist] 기본 항목 수정 실패:', error.message);
  revalidatePath(PATH);
}

export async function deleteChecklistTemplateItem(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_checklist_templates').delete().eq('id', id);
  if (error) console.error('[sourcing checklist] 기본 항목 삭제 실패:', error.message);
  revalidatePath(PATH);
}

// 체크한 항목들의 한글 라벨을 번호 매겨서 모은 뒤, 공장에 바로 보낼 수
// 있는 하나의 중국어 메시지로 번역한다 (번역기와 같은 함수 재사용 -
// 여러 조건을 자연스럽게 하나로 엮어주는 로직이 똑같이 필요함).
export async function generateChecklistMessage(
  labels: string[]
): Promise<{ error: string } | { success: true; data: SourcingZhTranslation }> {
  if (labels.length === 0) return { error: '먼저 보낼 항목을 체크해주세요.' };
  const combined = labels.map((l, i) => `${i + 1}. ${l}`).join('\n');
  try {
    const data = await translateToChineseForSourcing(combined);
    return { success: true, data };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
