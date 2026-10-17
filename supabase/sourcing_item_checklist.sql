-- Supabase SQL Editor에서 실행하세요.
-- 소싱 아이템(공장)별로 "꼭 물어봐야/확인해야 하는 항목" 체크리스트를
-- 추적한다. 표준 항목(lib/sourcingChecklist.ts의 템플릿)은 DB에 미리
-- 안 넣어두고 화면에서만 기본 목록으로 보여주다가, 사용자가 체크하거나
-- 메모를 남긴 순간에만 행을 만든다(item_key + sourcing_item_id로
-- upsert) - 손 안 댄 항목까지 미리 수백 개 insert할 필요가 없음.
-- item_key가 'custom-...'으로 시작하면 템플릿에 없는 사용자 추가 항목.
create table if not exists sourcing_item_checklist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  item_key text not null,
  label text not null,
  checked boolean not null default false,
  note text,
  unique (sourcing_item_id, item_key)
);

alter table sourcing_item_checklist enable row level security;

create policy "sourcing_item_checklist_select" on sourcing_item_checklist
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_checklist_insert" on sourcing_item_checklist
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_checklist_update" on sourcing_item_checklist
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_checklist_delete" on sourcing_item_checklist
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
