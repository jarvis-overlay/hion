-- Supabase SQL Editor에서 실행하세요.
-- 우선순위(1/2/3순위) 드롭다운에 "판매중"/"판매중지"도 선택할 수 있게
-- 허용값을 넓힌다. 기존 체크 제약을 지우고 다시 건다.
alter table sourcing_items drop constraint if exists sourcing_items_priority_check;

alter table sourcing_items
  add constraint sourcing_items_priority_check
  check (priority is null or priority in ('1', '2', '3', 'on_sale', 'stopped'));
