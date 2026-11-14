-- 쿠팡 실데이터로 조사해서 저장한 비교 상품에 사진 주소 / 개별 가격 / 리뷰 수도 같이 남긴다.
-- (예전에 저장한 항목과 직접 입력한 항목은 비어 있다 - null이면 화면에서 그냥 표시하지 않음)
alter table sourcing_item_comparisons
  add column if not exists image_url text,
  add column if not exists item_price integer,
  add column if not exists review_count integer;
