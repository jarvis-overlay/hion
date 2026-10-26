-- Supabase SQL Editor에서 실행하세요.
-- AI 소싱 추천 "조건 모드"에서 제외할 카테고리를 매번 다시 입력하지
-- 않도록 저장해두는 테이블 (체크리스트 기본 항목과 같은 패턴 - 화면
-- 에서 직접 추가/삭제).
create table if not exists sourcing_excluded_categories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label text not null unique
);

alter table sourcing_excluded_categories enable row level security;

create policy "sourcing_excluded_categories_select" on sourcing_excluded_categories
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_excluded_categories_insert" on sourcing_excluded_categories
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_excluded_categories_delete" on sourcing_excluded_categories
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
