-- 히스토리에 "실제 발생 시각"을 별도로 저장 (동기화 시각과 구분하기 위함)
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table stock_movements add column if not exists occurred_at timestamptz not null default now();
