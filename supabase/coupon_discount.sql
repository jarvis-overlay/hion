-- 상품별 쿠팡 쿠폰 할인액을 설정해서, 매출 동기화 시 정가가 아니라
-- 할인 반영된 실제 판매가로 계산되게 하기 위한 컬럼들.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

-- 상품별 쿠폰 할인액 (원 단위, 개당)
alter table products
  add column if not exists coupon_discount numeric not null default 0;

-- 이 옵션ID(vendorItemId)가 반품 재판매(회수품) 등급인지 여부.
-- 반품 재판매 상품은 쿠폰 할인이 적용 안 되므로 매출 계산에서 할인을 빼면 안 된다.
alter table product_vendor_items
  add column if not exists is_return_grade boolean not null default false;
