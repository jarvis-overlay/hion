-- Supabase SQL Editor에서 실행하세요.
-- 비교 상품군이 여러 개면 [링크]만으로는 뭐가 뭔지 구분이 안 된다는
-- 요청으로, 비교 상품마다 이름(제목)을 붙일 수 있게 컬럼을 추가한다.
alter table sourcing_item_comparisons add column if not exists title text;
