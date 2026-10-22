-- Supabase SQL Editor에서 실행하세요.
-- 메모 카테고리(가격/재고/품질 등)를 코드에 고정하지 않고, 체크리스트
-- 기본 항목처럼 화면에서 직접 추가/삭제할 수 있게 DB 테이블로 둔다.
-- 발주 과정 위주로 쓰기 좋게 기본값을 가볍게 깔아두되, 전부 자유롭게
-- 바꿀 수 있다.
create table if not exists item_note_categories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label text not null unique,
  position int not null default 0
);

insert into item_note_categories (label, position) values
  ('문의/답변', 0),
  ('샘플', 1),
  ('발주확정', 2),
  ('결제', 3),
  ('선적', 4),
  ('기타', 5)
on conflict (label) do nothing;

alter table item_note_categories enable row level security;

create policy "item_note_categories_select" on item_note_categories
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "item_note_categories_insert" on item_note_categories
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "item_note_categories_delete" on item_note_categories
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- item_notes.category는 이제 고정된 enum이 아니라 위 테이블에서 고른
-- 라벨 텍스트를 그대로 저장한다 (카테고리를 나중에 지워도 이미 남긴
-- 메모의 글자는 그대로 남음 - FK로 안 묶는 이유).
alter table item_notes drop constraint if exists item_notes_category_check;
