-- 업무수첩 공유에서 "상대 이메일 → 계정 ID(auth uuid)" 변환을 서버의
-- SUPABASE_SERVICE_ROLE_KEY 없이 할 수 있게 하는 DB 함수. 지금까진 그 키로
-- auth.admin.listUsers()를 호출했는데, 맥북 .env.local에 키가 없으면 공유 자체가
-- "공유 기능이 아직 설정되지 않았어요"로 막혔다.
--
-- security definer로 auth.users를 읽되, 아무 이메일이나 조회할 수는 없게 막는다:
--   1) 호출한 사람이 allowed_users에 있어야 하고
--   2) 조회 대상도 allowed_users에 있는 이메일이어야 한다.
-- (이 프로젝트의 다른 RLS 보조 함수들과 같은 방식 - 20261108022424 참고)
create or replace function lookup_allowed_user_id(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
    and exists (select 1 from public.allowed_users a where lower(a.email) = lower(u.email))
    and exists (select 1 from public.allowed_users c where lower(c.email) = lower(auth.jwt() ->> 'email'))
  limit 1;
$$;

revoke all on function lookup_allowed_user_id(text) from public, anon;
grant execute on function lookup_allowed_user_id(text) to authenticated;
