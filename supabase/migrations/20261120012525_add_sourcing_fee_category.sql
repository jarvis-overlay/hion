-- 소싱 후보의 쿠팡 판매수수료 카테고리 (예: 생활용품). 카테고리를 고르면 수수료율이 자동 입력되고, 다시 열어도 그 선택이 유지된다.
-- 빈칸 허용(기존 행은 null) - 기존 데이터·화면에 영향 없음.
alter table public.sourcing_items add column if not exists fee_category text;
