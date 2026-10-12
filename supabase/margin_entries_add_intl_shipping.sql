-- Supabase SQL Editor에서 실행하세요.
-- 마진 계산기를 소싱 리스트와 동일한 계산식(해외배송비 항목 포함,
-- 쿠폰 할인 정액/정률 선택)으로 맞추면서 저장 스냅샷에도 두 값을
-- 남기기 위해 컬럼을 추가합니다.
alter table margin_entries add column if not exists intl_shipping numeric;
alter table margin_entries add column if not exists coupon numeric;
