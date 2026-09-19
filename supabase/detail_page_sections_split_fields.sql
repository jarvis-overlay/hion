-- Supabase SQL Editor에서 실행하세요.
-- 한글 문구를 AI가 그리게 하면 깨진 글자가 나오는 문제(실측 확인)를
-- 해결하기 위해, 이제 AI는 "문구 없는 배경/상품 이미지"만 생성하고
-- 문구(설명)는 서버에서 실제 폰트로 직접 합성한다. 재시도 시에도
-- 같은 입력을 재사용할 수 있게 키워드/분위기/설명을 각각 컬럼으로
-- 따로 저장한다 (prompt_text는 화면 표시용으로 계속 유지).
alter table detail_page_sections add column if not exists keyword text;
alter table detail_page_sections add column if not exists mood text;
alter table detail_page_sections add column if not exists description text;
