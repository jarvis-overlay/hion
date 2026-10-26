-- Supabase SQL Editor에서 실행하세요.
-- 판매중/판매중지를 우선순위가 아니라 상태(status) 필터로 옮기기로
-- 해서, 우선순위 컬럼의 허용값을 원래대로(1/2/3만) 되돌린다. status
-- 컬럼은 애초에 체크 제약이 없는 text라 별도 마이그레이션이 필요 없다.
alter table sourcing_items drop constraint if exists sourcing_items_priority_check;

alter table sourcing_items
  add constraint sourcing_items_priority_check
  check (priority is null or priority in ('1', '2', '3'));
