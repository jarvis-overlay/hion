'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const PATH = '/dashboard/sourcing/list';

// 체크리스트 화면의 "자유 번역" 결과를 아이템별로 저장 - 안 하면
// 새로고침할 때마다 번역했던 내용이 다 날아가서 불편하다는 요청으로
// 추가함. id는 화면에서 낙관적으로 미리 만든 값을 그대로 받아서 저장한다
// (DB가 새로 id를 만들면, 저장 직후 바로 삭제를 누를 때 화면의 임시
// id와 실제 DB id가 달라서 삭제가 안 먹는 문제가 생기기 때문).
export async function saveChecklistTranslation(
  id: string,
  sourcingItemId: string,
  entry: {
    direction: 'ko-zh' | 'zh-ko';
    input: string;
    casual?: string;
    formal?: string;
    translation?: string;
  }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from('sourcing_translation_history').insert({
    id,
    sourcing_item_id: sourcingItemId,
    author_email: user?.email || null,
    direction: entry.direction,
    input: entry.input,
    casual: entry.casual || null,
    formal: entry.formal || null,
    translation: entry.translation || null,
  });
  if (error) console.error('[번역 기록] 저장 실패:', error.message);
  revalidatePath(PATH);
}

export async function deleteChecklistTranslation(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from('sourcing_translation_history').delete().eq('id', id);
  if (error) console.error('[번역 기록] 삭제 실패:', error.message);
  revalidatePath(PATH);
}
