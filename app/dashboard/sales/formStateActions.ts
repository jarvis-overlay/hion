'use server';

// 입력칸에 적어둔 내용(현재 입력 + 돌릴 때마다 남긴 기록)을 서버(Supabase 저장소의 작은 JSON 파일)에 보관한다.
// 이 브라우저의 저장만으로는 다른 PC에서 안 보이고 브라우저 데이터를 지우면 사라지기 때문이다.
// DB 테이블을 새로 만들 필요가 없고(= SQL 실행 불필요), 실패해도 화면은 이 브라우저 저장으로 계속 동작한다.
import { createClient } from '@/lib/supabase/server';

const BUCKET = 'detail-images';
const KEY_RE = /^(detail|thumb):[A-Za-z0-9_-]{1,80}$/;
const MAX_BYTES = 300_000;

export interface FormStatePayload {
  current: { at: number; values: Record<string, unknown> } | null;
  history: { at: number; values: Record<string, unknown> }[];
}

const pathOf = (key: string) => `form-state/${key.replace(':', '-')}.json`;

function clean(raw: any): FormStatePayload {
  const isRec = (r: any) => r && typeof r.at === 'number' && r.values && typeof r.values === 'object' && !Array.isArray(r.values);
  return {
    current: isRec(raw?.current) ? { at: raw.current.at, values: raw.current.values } : null,
    history: (Array.isArray(raw?.history) ? raw.history : [])
      .filter(isRec)
      .slice(0, 10)
      .map((r: any) => ({ at: r.at, values: r.values })),
  };
}

export async function loadFormState(key: string): Promise<{ error: string } | ({ success: true } & FormStatePayload)> {
  if (!KEY_RE.test(key || '')) return { error: '저장 위치가 올바르지 않아요.' };
  try {
    const supabase = createClient();
    const { data, error } = await supabase.storage.from(BUCKET).download(pathOf(key));
    // 처음이라 저장된 게 없는 경우도 오류로 오지만 정상이다
    if (error || !data) return { success: true, current: null, history: [] };
    const parsed = JSON.parse(await data.text());
    return { success: true, ...clean(parsed) };
  } catch (e: any) {
    return { error: e?.message || '저장된 입력을 불러오지 못했어요.' };
  }
}

export async function saveFormState(key: string, payload: FormStatePayload): Promise<{ error: string } | { success: true }> {
  if (!KEY_RE.test(key || '')) return { error: '저장 위치가 올바르지 않아요.' };
  try {
    const body = JSON.stringify(clean(payload));
    if (body.length > MAX_BYTES) return { error: '저장할 입력이 너무 커요.' };
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(pathOf(key), Buffer.from(body, 'utf8'), { contentType: 'application/json', upsert: true });
    if (error) return { error: error.message };
    return { success: true };
  } catch (e: any) {
    return { error: e?.message || '입력을 서버에 저장하지 못했어요.' };
  }
}
