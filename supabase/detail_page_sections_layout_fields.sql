-- Supabase SQL Editor에서 실행하세요.
-- 향수 브랜드 레퍼런스 수준의 레이아웃(그라데이션 배경, 계층형 문구,
-- 브랜드명/통계 강조)을 지원하기 위해 섹션당 입력 필드를 확장한다.
-- 전부 선택 항목이라 기존 섹션(값이 전부 null)은 그대로 'white'
-- 레이아웃으로 동작한다.
alter table detail_page_sections add column if not exists eyebrow text;
alter table detail_page_sections add column if not exists accent_title text;
alter table detail_page_sections add column if not exists accent_subtitle text;
alter table detail_page_sections add column if not exists stat text;
alter table detail_page_sections add column if not exists stat_caption text;
alter table detail_page_sections add column if not exists layout_style text not null default 'white';
alter table detail_page_sections add column if not exists theme text not null default 'dark';
