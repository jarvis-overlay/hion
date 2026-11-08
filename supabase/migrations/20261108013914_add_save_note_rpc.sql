-- saveNote 서버 액션이 "select rev → +1 계산 → update"로 비원자적으로
-- rev를 올리던 걸, 하나의 원자적 UPDATE 문으로 바꾼다. 동시에 두 저장
-- 요청이 들어와도 lost update가 생기지 않도록 Postgres 함수(RPC)로
-- 옮긴다.
--
-- 핵심: UPDATE ... FROM (select ... for update)로 "갱신 전 값(rev,
-- updated_by_email)"과 "갱신"을 한 문장 안에서 처리한다. FROM 서브쿼리와
-- UPDATE 대상 모두 note_id로 1행만 걸리게 필터링해서 다른 행과 교차되지
-- 않게 한다. security invoker라 호출자의 RLS(allowed_users + 소유자/편집
-- 공유 권한)가 그대로 적용된다 - RLS가 막으면 이 함수도 0행을 돌려준다.
create or replace function save_work_note(
  p_note_id uuid,
  p_title text,
  p_body jsonb,
  p_user_id uuid,
  p_user_email text
)
returns table (
  rev integer,
  updated_at timestamptz,
  prev_rev integer,
  prev_updated_by_email text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rev integer;
  v_updated_at timestamptz;
  v_prev_rev integer;
  v_prev_email text;
begin
  update work_notes n
  set rev = n.rev + 1,
      title = p_title,
      body = p_body,
      updated_at = now(),
      updated_by = p_user_id,
      updated_by_email = p_user_email
  from (
    select w.rev as old_rev, w.updated_by_email as old_email
    from work_notes w
    where w.id = p_note_id
    for update
  ) as prev
  where n.id = p_note_id
  returning n.rev, n.updated_at, prev.old_rev, prev.old_email
  into v_rev, v_updated_at, v_prev_rev, v_prev_email;

  -- 업데이트된 행이 없음(노트가 없거나 RLS가 막음, 예: 보기 전용 공유).
  -- 빈 결과를 돌려주면 앱이 "저장 안 됨"으로 처리한다.
  if v_rev is null then
    return;
  end if;

  -- 이력 기록 실패는 저장 자체를 실패시키지 않는다(기존 동작과 동일 -
  -- 드문 이력 insert 오류로 "새 노트" 버튼이나 자동저장이 먹통이 되는
  -- 것보다 나음). 경고만 남기고 넘어간다.
  begin
    insert into work_note_history (note_id, rev, title, body, edited_by, edited_by_email)
    values (p_note_id, v_rev, p_title, p_body, p_user_id, p_user_email);
  exception when others then
    raise warning 'work_note_history insert 실패 (note_id=%): %', p_note_id, sqlerrm;
  end;

  return query select v_rev, v_updated_at, v_prev_rev, v_prev_email;
end;
$$;

grant execute on function save_work_note(uuid, text, jsonb, uuid, text) to authenticated;
