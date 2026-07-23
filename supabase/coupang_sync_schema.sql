-- 쿠팡 주문 동기화 기능용 추가 컬럼
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

-- 상품에 쿠팡 옵션ID(vendorItemId) 저장
alter table products add column if not exists coupang_vendor_item_id text;

-- 히스토리에 외부 주문 참조값 저장 (중복 동기화 방지용)
alter table stock_movements add column if not exists external_ref text;

create unique index if not exists stock_movements_external_ref_idx
  on stock_movements (external_ref)
  where external_ref is not null;
