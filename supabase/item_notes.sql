-- Supabase SQL Editor에서 실행하세요.
-- 소싱 아이템/공급처 메모를 하나만 남기고 덮어쓰는 대신, 날짜별로 여러
-- 건(+사진)을 계속 쌓아갈 수 있는 메모 타임라인 테이블.
-- entity_type/entity_id로 어떤 대상에 달린 메모인지 구분한다 (폴리모픽
-- 연결 - sourcing_item, supplier 등 여러 종류의 대상에 같은 테이블을
-- 재사용하기 위함. PostgREST 자동 조인은 안 되니 화면에서는 따로
-- select해서 entity_type/entity_id로 직접 매칭한다).
create table if not exists item_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entity_type text not null,
  entity_id uuid not null,
  author_email text,
  body text,
  image_url text,
  constraint item_notes_body_or_image check (body is not null or image_url is not null)
);

create index if not exists item_notes_entity_idx on item_notes (entity_type, entity_id, created_at desc);

alter table item_notes enable row level security;

create policy "item_notes_select" on item_notes
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "item_notes_insert" on item_notes
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "item_notes_delete" on item_notes
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- 사진은 기존 detail-images 버킷을 재사용한다 (schema.sql에 이미
-- 버킷+정책이 있음 - 새 버킷을 또 안 만들어도 됨).
