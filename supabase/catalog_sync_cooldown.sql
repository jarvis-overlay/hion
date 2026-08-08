-- 카탈로그 전체 재스캔(상품마다 상세조회+옵션마다 재고조회)이 얼마나 자주
-- 호출되든 상관없이 과도하게 반복 실행되는 걸 막기 위한 쿨다운 타임스탬프.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table channel_credentials
  add column if not exists catalog_synced_at timestamptz;
