-- 상품 카드 마진 계산에서 매입부가세를 매입가의 10%로 자동계산하지 않고
-- 직접 입력받기 위한 컬럼.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table products
  add column if not exists import_vat numeric;
