-- 발주 기록이 없는 상품(반품등급 재판매 등)도 원가를 직접 입력해서
-- 성과 분석 마진 계산에 쓸 수 있게 하는 컬럼. 값이 있으면 발주 기록의
-- 가중평균 매입가보다 이 값을 우선 사용한다.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table products
  add column if not exists manual_cost numeric;
