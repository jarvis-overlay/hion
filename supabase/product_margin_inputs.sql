-- 상품 카드에서 바로 마진 계산기 공식(판매가-매출부가세-매입가+매입부가세
-- -쿠팡수수료-배송비)을 보여주기 위한 입력값들.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table products
  add column if not exists sale_price numeric;

alter table products
  add column if not exists fee_rate numeric not null default 10.8;
