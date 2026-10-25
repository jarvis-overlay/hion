-- Supabase SQL Editor에서 실행하세요.
-- 소싱 아이템 체크리스트 화면의 "자유 번역" 결과가 새로고침하면
-- 사라지는 문제 해결 - 번역한 내용을 아이템별로 저장해둔다.
create table if not exists sourcing_translation_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  author_email text,
  direction text not null, -- 'ko-zh' | 'zh-ko'
  input text not null,
  casual text,
  formal text,
  translation text
);

create index if not exists sourcing_translation_history_item_idx
  on sourcing_translation_history (sourcing_item_id, created_at desc);

alter table sourcing_translation_history enable row level security;

create policy "sourcing_translation_history_select" on sourcing_translation_history
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_translation_history_insert" on sourcing_translation_history
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_translation_history_delete" on sourcing_translation_history
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
