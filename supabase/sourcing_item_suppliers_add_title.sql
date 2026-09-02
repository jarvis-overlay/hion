-- Supabase SQL Editor에서 실행하세요.
-- 공급처 비교도 비교 상품군처럼 여러 개면 [링크]만으론 구분이 안 되니
-- 상품명을 붙일 수 있게 컬럼을 추가한다.
alter table sourcing_item_suppliers add column if not exists title text;
