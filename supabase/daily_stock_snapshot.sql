-- 하루 단위 재고 대사(반품 추정)를 위한 스냅샷 컬럼.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table products
  add column if not exists prev_stock_snapshot integer;

alter table products
  add column if not exists prev_stock_snapshot_at timestamptz;
