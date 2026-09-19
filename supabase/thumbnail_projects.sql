-- Supabase SQL Editor에서 실행하세요.
-- "판매 > 썸네일 제작" - 상세페이지 제작과 비슷한 프로젝트 구조지만
-- 목적이 다르다: 쿠팡 등록에 쓰는 "메인 썸네일"(검색결과에 노출되는
-- 대표 이미지, 1장) + "추가 이미지"(상세 갤러리에 들어가는 나머지
-- 이미지, 여러 장)를 구분해서 관리한다. detail-images와 같은 storage
-- 버킷을 재사용한다 - 새 버킷 필요 없음.
create table if not exists thumbnail_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text,
  author_email text
);

create table if not exists thumbnail_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references thumbnail_projects(id) on delete cascade,
  kind text not null default 'additional',   -- 'main' | 'additional'
  position int not null default 0,           -- 추가 이미지끼리의 순서 (메인은 항상 0)
  input_image_url text not null,             -- 원본 상품 사진 (필수 - 누끼를 따야 하므로)
  product_position text not null default 'center', -- 'center' | 'top' | 'bottom' | 'left' | 'right'
  effect_prompt text,                        -- 효과 추가 프롬프트 (선택)
  output_image_url text,                     -- 1000x1000 완성본
  error text
);

alter table thumbnail_projects enable row level security;
alter table thumbnail_images enable row level security;

create policy "thumbnail_projects_select" on thumbnail_projects
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_projects_insert" on thumbnail_projects
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_projects_update" on thumbnail_projects
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_projects_delete" on thumbnail_projects
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "thumbnail_images_select" on thumbnail_images
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_images_insert" on thumbnail_images
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_images_update" on thumbnail_images
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_images_delete" on thumbnail_images
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
