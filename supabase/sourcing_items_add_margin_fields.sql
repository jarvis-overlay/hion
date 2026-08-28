-- Supabase SQL Editor에서 이 파일 전체를 그대로 실행하세요.
-- 소싱 리스트의 마진 계산을 마진 계산기(margin_entries)와 동일한
-- 공식으로 정확하게 계산하기 위해 세부 항목을 추가한다.

alter table sourcing_items add column if not exists coupon numeric;
alter table sourcing_items add column if not exists fee_rate numeric not null default 10.8;
alter table sourcing_items add column if not exists shipping numeric;
alter table sourcing_items add column if not exists ad_cost numeric;
alter table sourcing_items add column if not exists etc_cost numeric;
