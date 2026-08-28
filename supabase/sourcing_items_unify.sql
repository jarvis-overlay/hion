-- Supabase SQL Editor에서 이 파일 전체를 그대로 실행하세요.
-- 소싱 정보(sourcing_notes) + 소싱 리스트(sourcing_posts)를 하나의
-- 테이블로 통합한다. 기존 두 테이블은 삭제하지 않고 그대로 둔다
-- (백업 겸 롤백용) - 앱 코드는 이제 sourcing_items만 사용한다.

-- 1. 통합 테이블
create table if not exists sourcing_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  title text not null,
  link text,
  content text,
  price numeric,       -- 참고 판매가 (마진 계산용)
  cost numeric,        -- 매입 원가 (마진 계산용)
  moq text,
  status text not null default 'checking',   -- checking | ordered | hold
  stage text not null default 'candidate'    -- candidate | confirmed
);

alter table sourcing_items enable row level security;

create policy "sourcing_items_select" on sourcing_items
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_items_insert" on sourcing_items
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_items_update" on sourcing_items
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_items_delete" on sourcing_items
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- 2. 기존 데이터 이관 (이미 이관됐으면 중복 방지를 위해 id 기준으로 건너뜀)
insert into sourcing_items (id, created_at, author_email, title, link, content, status, stage)
select id, created_at, author_email, title, link, content, 'checking', 'candidate'
from sourcing_notes
where not exists (select 1 from sourcing_items si where si.id = sourcing_notes.id);

insert into sourcing_items (id, created_at, author_email, title, link, content, price, moq, status, stage)
select
  id, created_at, author_email, title, source_url, notes, price, moq, status,
  case when status = 'ordered' then 'confirmed' else 'candidate' end
from sourcing_posts
where not exists (select 1 from sourcing_items si where si.id = sourcing_posts.id);
