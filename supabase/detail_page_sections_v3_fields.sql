-- Supabase SQL Editor에서 실행하세요.
-- 1) 제품 색상 변경 프롬프트, 2) 뱃지/문단/번호리스트 문구 타이어,
-- 3) 제품 사양 표 섹션(별도 데이터 모양: 라벨/값 배열)을 위한 컬럼 추가.
-- 전부 선택 항목이라 기존 섹션은 그대로 동작한다.
alter table detail_page_sections add column if not exists color_prompt text;
alter table detail_page_sections add column if not exists badge text;
alter table detail_page_sections add column if not exists body_text text;
alter table detail_page_sections add column if not exists list_items text;
alter table detail_page_sections add column if not exists spec_title text;
alter table detail_page_sections add column if not exists spec_rows jsonb;
