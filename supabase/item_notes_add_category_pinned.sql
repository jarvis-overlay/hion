-- Supabase SQL Editor에서 실행하세요.
-- 메모가 쌓일수록 원하는 정보를 찾기 어려워지는 문제 해결용:
-- 1) category - 가격/재고/품질/결제/일정/기타로 분류해서 필터링
-- 2) pinned - 결론급 메모는 날짜 상관없이 맨 위에 고정 표시
alter table item_notes add column if not exists category text;
alter table item_notes add column if not exists pinned boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'item_notes_category_check'
  ) then
    alter table item_notes
      add constraint item_notes_category_check
      check (category is null or category in ('price', 'stock', 'quality', 'payment', 'schedule', 'etc'));
  end if;
end $$;
