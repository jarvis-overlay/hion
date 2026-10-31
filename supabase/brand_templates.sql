-- Supabase SQL Editor에서 실행하세요.
-- 상세페이지 "브랜드 템플릿" - 우리 브랜드의 색상/로고/머리글/바닥글(안내사항)을 저장해두고,
-- 어떤 상세페이지든 마지막에 고른 템플릿으로 내보낼 때 적용한다.
-- 안 돌려도 상세페이지 제작/다운로드는 되지만(기본 제공 색상 템플릿만 사용), 돌려야 내 브랜드 템플릿을 저장할 수 있다.
create table if not exists brand_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_name text not null default '',
  tagline text not null default '',
  logo_url text,
  primary_color text not null default '#1c1c1c',
  accent_color text not null default '#7c4fd1',
  apply_colors boolean not null default true,
  header_enabled boolean not null default true,
  footer_enabled boolean not null default true,
  footer_title text not null default '안내사항',
  footer_notice text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  author_email text
);

alter table brand_templates enable row level security;
drop policy if exists "brand_templates_select" on brand_templates;
drop policy if exists "brand_templates_insert" on brand_templates;
drop policy if exists "brand_templates_update" on brand_templates;
drop policy if exists "brand_templates_delete" on brand_templates;
create policy "brand_templates_select" on brand_templates
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "brand_templates_insert" on brand_templates
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "brand_templates_update" on brand_templates
  for update
  using (auth.jwt() ->> 'email' in (select email from allowed_users))
  with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "brand_templates_delete" on brand_templates
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

notify pgrst, 'reload schema';
