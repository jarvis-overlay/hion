-- Supabase SQL Editor에서 실행하세요.
-- "배송비"(쿠팡이 정산에서 떼는 국내 배송비)와 "해외배송비"(중국->한국
-- CBM 운임)는 서로 다른 비용인데 하나의 shipping 컬럼을 같이 쓰고 있어서,
-- CBM 계산기로 채우면 기존 쿠팡 배송비 값을 덮어쓰던 문제를 고친다.
-- intl_shipping_calc는 CBM 계산기에 입력한 원본 값(박스크기/수량/부가
-- 서비스 목록)을 저장해서, 폼을 다시 열었을 때 복원하기 위한 용도다.
alter table sourcing_items add column if not exists intl_shipping numeric;
alter table sourcing_items add column if not exists intl_shipping_calc jsonb;
