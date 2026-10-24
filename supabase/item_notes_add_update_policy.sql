-- Supabase SQL Editor에서 실행하세요.
-- item_notes 테이블에 처음 select/insert/delete 정책만 만들고 update
-- 정책을 빠뜨려서, 메모 수정/고정 토글이 에러 없이 "성공"으로만 뜨고
-- 실제로는 DB에 반영이 안 되던 버그 수정.
drop policy if exists "item_notes_update" on item_notes;
create policy "item_notes_update" on item_notes
  for update
  using (auth.jwt() ->> 'email' in (select email from allowed_users))
  with check (auth.jwt() ->> 'email' in (select email from allowed_users));
