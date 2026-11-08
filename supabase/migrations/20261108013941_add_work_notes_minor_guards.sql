-- 사소한 DB 레벨 가드 2개 추가 (reviewer 지적 중 우선순위 낮은 항목).

-- 1) 제목 길이 제한 - body(50만자)처럼 서버 코드에서도 300자로 막지만,
--    DB에도 같은 한도를 둬서 코드 경로를 우회해도 막히게 한다.
alter table work_notes
  add constraint work_notes_title_length check (char_length(title) <= 300);

-- 2) 본인에게 공유 금지를 DB 레벨에서도 막는다. 지금은
--    setNoteShare()에서 이메일 비교로 막고 있지만, RLS 정책에도 같은
--    조건을 추가해 애플리케이션 코드를 신뢰하지 않아도 막히게 한다.
drop policy if exists "work_note_shares_insert" on work_note_shares;
create policy "work_note_shares_insert" on work_note_shares
  for insert with check (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and target_user_id <> (select owner_id from work_notes where id = work_note_shares.note_id)
    and exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );
