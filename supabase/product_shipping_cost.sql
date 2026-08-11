-- 상품별 고정 배송비 (원 단위). 성과 분석 마진 계산에 반영하기 위한 컬럼.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table products
  add column if not exists shipping_cost numeric not null default 0;
