-- Supabase SQL Editor에서 실행하세요.
-- 썸네일/상세페이지 제작 시 "요즘 잘 팔리는 상품"을 참고해서 퀄리티를
-- 높여달라는 요청으로 추가. 프로젝트에 카테고리/검색어를 입력해두면
-- 쿠팡에서 그 검색어로 실제 잘 팔리는 경쟁 상품 사진을 가져와서, AI
-- 생성 시 "스타일 참고용"으로 같이 넣어준다 (복사가 아니라 구도/분위기
-- 참고 - lib/imageProcessing.ts의 referenceRule 지시문 참고).
alter table thumbnail_projects add column if not exists category text;
alter table detail_page_projects add column if not exists category text;
