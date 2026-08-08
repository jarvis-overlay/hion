-- 발주 등록 시 위안 단가 대신, 부가세/관세 등 다 포함한 최종 원화
-- 매입단가를 직접 입력할 수 있게 컬럼 추가. 값이 있으면 이걸 우선 쓰고,
-- 없으면 기존처럼 unit_price_cny * exchange_rate로 계산한다.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table purchase_orders
  add column if not exists unit_price_krw numeric;
