-- Supabase SQL Editor에서 실행하세요.
-- 소싱 리스트 카드에 1순위/2순위/3순위 뱃지를 붙이고, 그 기준으로
-- 필터링할 수 있게 컬럼을 추가한다. 기존 항목은 전부 null(미지정)로
-- 시작하고, null은 "우선순위 미지정"으로 취급한다.
alter table sourcing_items add column if not exists priority text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sourcing_items_priority_check'
  ) then
    alter table sourcing_items
      add constraint sourcing_items_priority_check check (priority is null or priority in ('1', '2', '3'));
  end if;
end $$;
