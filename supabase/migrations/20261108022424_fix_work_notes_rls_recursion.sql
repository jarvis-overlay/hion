-- work_notes와 work_note_shares의 RLS 정책이 서로를 직접 참조(EXISTS
-- 서브쿼리)하고 있어서, 한쪽을 조회/삽입할 때 다른 쪽 RLS가 평가되고
-- 그게 다시 원래 테이블의 RLS를 평가하는 식으로 무한 순환됐다
-- (Postgres 42P17 infinite recursion detected in policy).
--
-- SECURITY DEFINER 함수로 "소유자인지/공유받았는지"를 조회하면, 그 함수
-- 내부 쿼리는 함수 소유자(테이블 소유자와 동일 - RLS를 우회함) 권한으로
-- 실행돼서 더 이상 RLS 정책을 다시 평가하지 않는다. 정책에서 직접
-- 다른 테이블을 EXISTS로 들여다보는 대신 이 함수들을 호출하도록 바꾼다.

create or replace function work_note_owner_id(p_note_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select owner_id from work_notes where id = p_note_id;
$$;

create or replace function is_work_note_owner(p_note_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from work_notes where id = p_note_id and owner_id = auth.uid()
  );
$$;

create or replace function work_note_share_permission(p_note_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select permission from work_note_shares
  where note_id = p_note_id and target_user_id = auth.uid();
$$;

grant execute on function work_note_owner_id(uuid) to authenticated;
grant execute on function is_work_note_owner(uuid) to authenticated;
grant execute on function work_note_share_permission(uuid) to authenticated;

-- ---------- work_notes: select/update만 work_note_shares를 참조했음 ----------

drop policy "work_notes_select" on work_notes;
create policy "work_notes_select" on work_notes
  for select using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (owner_id = auth.uid() or work_note_share_permission(id) is not null)
  );

drop policy "work_notes_update" on work_notes;
create policy "work_notes_update" on work_notes
  for update using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (owner_id = auth.uid() or work_note_share_permission(id) = 'edit')
  );

-- insert/delete는 work_notes 자신만 보므로 원래부터 재귀 문제 없음 - 그대로 둠.

-- ---------- work_note_shares: 전부 work_notes(owner_id)를 참조했음 ----------

drop policy "work_note_shares_select" on work_note_shares;
create policy "work_note_shares_select" on work_note_shares
  for select using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (target_user_id = auth.uid() or is_work_note_owner(note_id))
  );

drop policy "work_note_shares_insert" on work_note_shares;
create policy "work_note_shares_insert" on work_note_shares
  for insert with check (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and is_work_note_owner(note_id)
    and target_user_id <> work_note_owner_id(note_id)
  );

drop policy "work_note_shares_update" on work_note_shares;
create policy "work_note_shares_update" on work_note_shares
  for update using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and is_work_note_owner(note_id)
  );

drop policy "work_note_shares_delete" on work_note_shares;
create policy "work_note_shares_delete" on work_note_shares
  for delete using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and is_work_note_owner(note_id)
  );

-- ---------- work_note_history: work_notes + work_note_shares 둘 다 참조했음 ----------

drop policy "work_note_history_select" on work_note_history;
create policy "work_note_history_select" on work_note_history
  for select using (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (is_work_note_owner(note_id) or work_note_share_permission(note_id) is not null)
  );

drop policy "work_note_history_insert" on work_note_history;
create policy "work_note_history_insert" on work_note_history
  for insert with check (
    auth.jwt() ->> 'email' in (select email from allowed_users)
    and (is_work_note_owner(note_id) or work_note_share_permission(note_id) = 'edit')
  );
