-- Supabase SQL Editor에서 실행하세요.
-- "색상마다 완전히 별도 세트(메인+추가)로 생성해달라"는 요청으로 추가.
-- 색상 라벨이 같은 사진끼리 그룹으로 묶여서 그룹별로 메인 1장 +
-- 추가 이미지를 만든다. 라벨을 안 붙이면(null) 기존처럼 프로젝트
-- 전체가 하나의 그룹으로 동작한다.
alter table thumbnail_images add column if not exists color_label text;
