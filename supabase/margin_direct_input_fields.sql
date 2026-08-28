-- Supabase SQL Editor에서 이 파일 전체를 그대로 실행하세요.
-- 마진 계산을 수수료율(%) 자동계산 대신, 실제 정산 내역을 보고 사용자가
-- 직접 입력하는 방식으로 바꾼다 (매출부가세/매입부가세/쿠팡수수료는
-- 환차·프로모션 등으로 공식과 실제 값이 달라질 수 있어서). 기존 fee_rate
-- 컬럼은 지우지 않고 그냥 더 이상 안 쓴다.

alter table margin_entries add column if not exists output_vat numeric;
alter table margin_entries add column if not exists import_vat numeric;
alter table margin_entries add column if not exists coupang_fee numeric;

alter table sourcing_items add column if not exists output_vat numeric;
alter table sourcing_items add column if not exists import_vat numeric;
alter table sourcing_items add column if not exists coupang_fee numeric;
