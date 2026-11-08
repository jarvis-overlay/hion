-- work_notes/work_note_shares/work_note_history의 RLS 정책에
-- allowed_users 검사가 빠져있던 치명적 보안 구멍을 막는다.
--
-- 20261108011924_add_work_notes.sql이 만든 정책들은 owner_id = auth.uid()
-- / target_user_id = auth.uid()만 검사했다. 이 저장소의 다른 모든 테이블
-- (20261105005639_baseline.sql 참고)은 그 조건에 더해 반드시
-- `auth.jwt() ->> 'email' in (select email from allowed_users)`도 같이
-- 검사한다 - 로그인은 아무 구글 계정이나 가능하고(도메인 제한 없음),
-- app/dashboard/layout.tsx가 화면 접근은 막아주지만 Server Action은
-- 레이아웃을 거치지 않아서 이 조건이 없으면 허용 안 된 계정이 Server
-- Action을 직접 호출해 노트를 만들고/저장하고/지우고/공유할 수 있었다.
--
-- 이미 운영에 적용된 20261108011924 파일 자체는 고치지 않고(마이그레이션
-- 불변 원칙), 여기서 정책을 drop 후 조건을 추가해 재생성한다.

-- ---------- work_notes ----------

drop policy if exists "work_notes_select" on work_notes;
create policy "work_notes_select" on work_notes
  for select using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from work_note_shares s
        where s.note_id = work_notes.id and s.target_user_id = auth.uid()
      )
    )
  );

drop policy if exists "work_notes_insert" on work_notes;
create policy "work_notes_insert" on work_notes
  for insert with check (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and owner_id = auth.uid()
  );

drop policy if exists "work_notes_update" on work_notes;
create policy "work_notes_update" on work_notes
  for update using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from work_note_shares s
        where s.note_id = work_notes.id and s.target_user_id = auth.uid() and s.permission = 'edit'
      )
    )
  );

drop policy if exists "work_notes_delete" on work_notes;
create policy "work_notes_delete" on work_notes
  for delete using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and owner_id = auth.uid()
  );

-- ---------- work_note_shares ----------

drop policy if exists "work_note_shares_select" on work_note_shares;
create policy "work_note_shares_select" on work_note_shares
  for select using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (
      target_user_id = auth.uid()
      or exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
    )
  );

drop policy if exists "work_note_shares_insert" on work_note_shares;
create policy "work_note_shares_insert" on work_note_shares
  for insert with check (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );

drop policy if exists "work_note_shares_update" on work_note_shares;
create policy "work_note_shares_update" on work_note_shares
  for update using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );

drop policy if exists "work_note_shares_delete" on work_note_shares;
create policy "work_note_shares_delete" on work_note_shares
  for delete using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );

-- ---------- work_note_history ----------

drop policy if exists "work_note_history_select" on work_note_history;
create policy "work_note_history_select" on work_note_history
  for select using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and exists (
      select 1 from work_notes n
      where n.id = work_note_history.note_id
        and (n.owner_id = auth.uid()
             or exists (select 1 from work_note_shares s where s.note_id = n.id and s.target_user_id = auth.uid()))
    )
  );

drop policy if exists "work_note_history_insert" on work_note_history;
create policy "work_note_history_insert" on work_note_history
  for insert with check (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and exists (
      select 1 from work_notes n
      where n.id = work_note_history.note_id
        and (n.owner_id = auth.uid()
             or exists (select 1 from work_note_shares s where s.note_id = n.id and s.target_user_id = auth.uid() and s.permission = 'edit'))
    )
  );
