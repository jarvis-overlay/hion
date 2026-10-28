-- Supabase SQL Editor에서 실행하세요.
-- 소싱하지 않기로 결정한 항목을 메인 목록에서 숨기고 "보관함"으로
-- 따로 모아볼 수 있게 archived_at 컬럼을 추가한다. null이면 보관 안 한
-- 상태(기본), 값이 있으면 그 시점에 보관 처리된 것.
alter table sourcing_items add column if not exists archived_at timestamptz;
