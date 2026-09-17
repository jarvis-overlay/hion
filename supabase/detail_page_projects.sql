-- Supabase SQL Editor에서 실행하세요.
-- "판매 > 상세페이지 제작" - 특정 소싱 후보에 종속되지 않는 독립적인
-- 도구다. 프로젝트 하나 = 완성할 상세페이지 하나. 섹션을 순서대로
-- 여러 개 쌓고(이미지+문구), 섹션마다 AI가 이미지를 한 장씩 생성한다
-- (입력 이미지가 있으면 그 사진을 활용한 합성, 없으면 설명만으로
-- 새로 생성). sourcing_item_images와 같은 storage 버킷(detail-images)을
-- 재사용한다 - 새 버킷 필요 없음.
create table if not exists detail_page_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text,              -- 프로젝트 이름 (선택 - 안 적으면 목록에 날짜로 표시)
  author_email text
);

create table if not exists detail_page_sections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references detail_page_projects(id) on delete cascade,
  position int not null,          -- 프로젝트 안에서의 순서
  input_image_url text,           -- 첨부한 원본 상품 이미지 (없으면 null - AI가 이미지도 새로 생성)
  prompt_text text not null,      -- 키워드/분위기/설명
  output_image_url text,          -- 생성 결과 (쿠팡 규격 860px로 리사이즈된 최종본)
  error text                      -- 생성 실패 시 에러 메시지 (재시도 가능하게)
);

alter table detail_page_projects enable row level security;
alter table detail_page_sections enable row level security;

create policy "detail_page_projects_select" on detail_page_projects
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_projects_insert" on detail_page_projects
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_projects_update" on detail_page_projects
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_projects_delete" on detail_page_projects
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "detail_page_sections_select" on detail_page_sections
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_sections_insert" on detail_page_sections
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_sections_update" on detail_page_sections
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_sections_delete" on detail_page_sections
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
