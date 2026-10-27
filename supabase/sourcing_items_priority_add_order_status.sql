-- Supabase SQL Editor에서 실행하세요.
-- 우선순위 드롭다운에 "발주 대기 중"/"발주 진행 중"도 선택할 수 있게
-- 허용값을 넓힌다.
alter table sourcing_items drop constraint if exists sourcing_items_priority_check;

alter table sourcing_items
  add constraint sourcing_items_priority_check
  check (priority is null or priority in ('1', '2', '3', 'waiting', 'ordering'));
