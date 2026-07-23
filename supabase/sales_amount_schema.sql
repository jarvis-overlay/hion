-- 판매 히스토리에 매출금액을 같이 기록하기 위한 컬럼 추가
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table stock_movements add column if not exists amount numeric;
