-- Supabase SQL Editor에서 이 파일 전체를 그대로 실행하세요.

-- 1. 접속 허용된 이메일 목록
create table if not exists allowed_users (
  email text primary key
);

-- 2. 마진 계산기 - 저장된 계산 기록
create table if not exists margin_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  name text not null,
  price numeric not null,
  cost numeric not null default 0,
  fee_rate numeric not null default 0,
  shipping numeric not null default 0,
  ad_cost numeric not null default 0,
  etc_cost numeric not null default 0,
  profit numeric not null,
  margin_pct numeric not null
);

-- 3. 소싱 정보 (자유형 노트 - 공급업체 정보, 팁, 관세 정보 등)
create table if not exists sourcing_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  title text not null,
  link text,
  content text
);

-- 4. 소싱 리스트 (구조화된 소싱 후보 상품 관리)
create table if not exists sourcing_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  title text not null,
  source_url text,
  price numeric,
  moq text,
  notes text,
  status text not null default 'checking' -- checking | ordered | hold
);

-- 5. RLS 활성화
alter table allowed_users enable row level security;
alter table margin_entries enable row level security;
alter table sourcing_notes enable row level security;
alter table sourcing_posts enable row level security;

-- 6. allowed_users: 로그인한 사람이면 누구나 조회 가능 (본인 이메일 확인용)
create policy "allowed_users_select" on allowed_users
  for select using (auth.role() = 'authenticated');

-- 7. 허용된 이메일만 각 테이블 CRUD 가능
create policy "margin_select" on margin_entries
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "margin_insert" on margin_entries
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "margin_delete" on margin_entries
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "notes_select" on sourcing_notes
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "notes_insert" on sourcing_notes
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "notes_delete" on sourcing_notes
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "posts_select" on sourcing_posts
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "posts_insert" on sourcing_posts
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "posts_update" on sourcing_posts
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "posts_delete" on sourcing_posts
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- 8. 접속을 허용할 두 사람의 이메일을 여기에 넣고 실행하세요.
insert into allowed_users (email) values
('dnr7350@gmail.com'),
('krispark917@gmail.com');
