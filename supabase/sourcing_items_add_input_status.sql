-- Supabase SQL Editor에서 실행하세요.
-- 입력/미입력을 판매가·원가 여부로만 자동 판정하지 말고, 카드에서
-- 수동으로도 바꿀 수 있게 해달라는 요청으로 실제 컬럼을 추가한다.
-- 기존 행은 지금 판매가·원가가 둘 다 있으면 '입력', 아니면 '미입력'으로
-- 채워 넣어서(백필) 마이그레이션 전후로 화면에 보이던 값이 갑자기
-- 바뀌지 않게 한다. 이후로는 순수 수동 값 - 판매가·원가를 나중에
-- 고쳐도 이 값은 자동으로 안 바뀐다.
alter table sourcing_items add column if not exists input_status text;

update sourcing_items
set input_status = case when price is not null and cost is not null then 'entered' else 'not_entered' end
where input_status is null;

alter table sourcing_items alter column input_status set default 'not_entered';
alter table sourcing_items alter column input_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sourcing_items_input_status_check'
  ) then
    alter table sourcing_items
      add constraint sourcing_items_input_status_check check (input_status in ('entered', 'not_entered'));
  end if;
end $$;
