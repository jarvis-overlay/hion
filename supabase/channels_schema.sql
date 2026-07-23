-- 채널 연동(쿠팡/네이버 API 키) 저장용 테이블
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.
-- (기존 schema.sql, inventory_schema.sql은 이미 실행했으니 건드리지 않아도 됩니다)

create table if not exists channel_credentials (
  channel text primary key, -- 'coupang' | 'naver'
  vendor_id text,
  access_key text,
  secret_key text,
  client_id text,
  client_secret text,
  connected boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table channel_credentials enable row level security;

create policy "channel_credentials_select" on channel_credentials
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "channel_credentials_insert" on channel_credentials
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "channel_credentials_update" on channel_credentials
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "channel_credentials_delete" on channel_credentials
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
