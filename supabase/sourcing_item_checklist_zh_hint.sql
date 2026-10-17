-- Supabase SQL Editor에서 실행하세요.
-- 커스텀 체크리스트 항목(상품별)도 기본 항목처럼 중국어 문구를 자동
-- 번역해서 보여주기 위한 컬럼.
alter table sourcing_item_checklist add column if not exists zh_hint text;
