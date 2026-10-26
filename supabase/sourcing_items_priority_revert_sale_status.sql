-- Supabase SQL Editor에서 실행하세요.
-- 판매중/판매중지를 우선순위가 아니라 상태(status) 필터로 옮기기로
-- 해서, 우선순위 컬럼의 허용값을 원래대로(1/2/3만) 되돌린다. 그 사이에
-- priority='on_sale'/'stopped'로 이미 설정해둔 항목이 있을 수 있으니,
-- 제약을 걸기 전에 그 값을 status 컬럼으로 옮기고 priority는 비운다
-- (안 그러면 기존 데이터가 새 제약에 걸려서 ALTER TABLE 자체가 실패함).
update sourcing_items
set status = priority, priority = null
where priority in ('on_sale', 'stopped');

alter table sourcing_items drop constraint if exists sourcing_items_priority_check;

alter table sourcing_items
  add constraint sourcing_items_priority_check
  check (priority is null or priority in ('1', '2', '3'));
