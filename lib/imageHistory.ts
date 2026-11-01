// 결과 이미지를 같은 경로에 덮어쓰기 전에 직전 버전을 `-prev` 파일로 하나 보관해서 "이전으로 되돌리기"를 가능하게 한다.
// 보관은 부가 기능이라 실패해도 본 작업을 막지 않는다. 되돌리기는 현재와 직전 버전을 맞바꾼다(다시 누르면 원래대로).
import { createClient } from '@/lib/supabase/server';

type SupabaseClient = ReturnType<typeof createClient>;

function prevPathOf(path: string): string {
  return path.replace(/-output\.jpg$/, '-prev.jpg');
}

async function readFile(supabase: SupabaseClient, bucket: string, path: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch {
    return null;
  }
}

// 덮어쓰기 직전에 호출한다. 현재 파일이 없으면(처음 생성) 아무것도 안 한다.
export async function archiveOutput(supabase: SupabaseClient, bucket: string, outPath: string): Promise<void> {
  try {
    const current = await readFile(supabase, bucket, outPath);
    if (!current) return;
    await supabase.storage.from(bucket).upload(prevPathOf(outPath), current, { contentType: 'image/jpeg', upsert: true });
  } catch (e) {
    console.error('[imageHistory] 이전 버전 보관 실패:', e);
  }
}

// 현재 결과와 직전 버전을 맞바꾼다. 성공하면 새 공개 URL(캐시 무효화 포함), 직전 버전이 없으면 안내 메시지.
export async function swapWithPrevious(
  supabase: SupabaseClient,
  bucket: string,
  outPath: string
): Promise<{ error: string } | { url: string }> {
  const prev = await readFile(supabase, bucket, prevPathOf(outPath));
  if (!prev) return { error: '되돌릴 이전 버전이 없어요 (수정하거나 다시 만든 적이 있는 이미지만 되돌릴 수 있어요).' };
  const current = await readFile(supabase, bucket, outPath);
  const { error: upErr } = await supabase.storage.from(bucket).upload(outPath, prev, { contentType: 'image/jpeg', upsert: true });
  if (upErr) return { error: `되돌리지 못했어요: ${upErr.message}` };
  if (current) {
    await supabase.storage.from(bucket).upload(prevPathOf(outPath), current, { contentType: 'image/jpeg', upsert: true });
  }
  return { url: `${supabase.storage.from(bucket).getPublicUrl(outPath).data.publicUrl}?v=${Date.now()}` };
}
