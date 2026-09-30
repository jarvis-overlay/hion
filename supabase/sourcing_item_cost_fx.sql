-- Supabase SQL Editor에서 실행하세요.
-- 소싱 리스트에서 "환율로 매입 원가 계산하기"로 넣은 현지 금액/환율이
-- 계산 결과(매입 원가, KRW)만 저장되고 원본 입력값은 안 남아서, 수정
-- 폼을 다시 열면 매번 빈 칸부터 다시 입력해야 하던 문제를 고친다.
alter table sourcing_items add column if not exists cost_fx_currency text;
alter table sourcing_items add column if not exists cost_fx_amount numeric;
alter table sourcing_items add column if not exists cost_fx_rate numeric;
