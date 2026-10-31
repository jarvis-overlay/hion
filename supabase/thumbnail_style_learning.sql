-- Supabase SQL Editor에서 실행하세요.
-- 썸네일 "인기상품 스타일 학습" - 카테고리별로 쿠팡 인기상품 이미지를 분석한
-- 결과(공통 배경/소품/조명 + 추가 이미지 컷 구성)를 저장해두고 재사용한다.
-- 안 돌려도 썸네일 생성은 되지만(스타일을 저장 못 하고 매번 새로 학습), 돌려두면
-- 14일간 저장된 스타일을 재사용해서 빠르고 비용이 절약된다.
create table if not exists category_style_briefs (
  id uuid primary key default gen_random_uuid(),
  category text not null unique,
  brief jsonb not null,
  source_count int not null default 0,
  learned_at timestamptz not null default now(),
  author_email text
);

alter table category_style_briefs enable row level security;
drop policy if exists "category_style_briefs_select" on category_style_briefs;
drop policy if exists "category_style_briefs_insert" on category_style_briefs;
drop policy if exists "category_style_briefs_update" on category_style_briefs;
drop policy if exists "category_style_briefs_delete" on category_style_briefs;
create policy "category_style_briefs_select" on category_style_briefs
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "category_style_briefs_insert" on category_style_briefs
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "category_style_briefs_update" on category_style_briefs
  for update
  using (auth.jwt() ->> 'email' in (select email from allowed_users))
  with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "category_style_briefs_delete" on category_style_briefs
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- 스타일 적용 추가 이미지가 어떤 컷/문구로 만들어졌는지 (실패해서 "다시 생성"할 때
-- 같은 컷으로 재현하기 위함). 일반(누끼) 이미지는 null.
alter table thumbnail_images add column if not exists style_spec jsonb;

notify pgrst, 'reload schema';
