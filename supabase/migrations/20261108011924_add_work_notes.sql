-- 업무수첩(work_notes): 개인 노트 + 공유(보기/편집) + 저장할 때마다 이력 기록.
-- 설계는 .claude/agents/architect.md 검토를 거쳐 확정됨 (2026-11-08).
--
-- 테이블 3개를 먼저 전부 만들고 나서 RLS 정책을 건다 (work_notes의 정책이
-- work_note_shares를 참조하므로, 정책 생성 시점엔 참조 대상 테이블이 이미
-- 있어야 함).

create table if not exists work_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_email text not null,
  title text not null default '',
  body jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  rev integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_by_email text
);

create index if not exists work_notes_owner_idx on work_notes (owner_id, updated_at desc);

create table if not exists work_note_shares (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references work_notes(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_email text not null,
  permission text not null check (permission in ('view', 'edit')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (note_id, target_user_id)
);

create index if not exists work_note_shares_target_idx on work_note_shares (target_user_id);

create table if not exists work_note_history (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references work_notes(id) on delete cascade,
  rev integer not null,
  title text not null,
  body jsonb not null,
  edited_by uuid references auth.users(id),
  edited_by_email text,
  edited_at timestamptz not null default now()
);

create index if not exists work_note_history_note_idx on work_note_history (note_id, edited_at desc);

-- ---------- RLS ----------

alter table work_notes enable row level security;

create policy "work_notes_select" on work_notes
  for select using (
    owner_id = auth.uid()
    or exists (
      select 1 from work_note_shares s
      where s.note_id = work_notes.id and s.target_user_id = auth.uid()
    )
  );

create policy "work_notes_insert" on work_notes
  for insert with check (owner_id = auth.uid());

create policy "work_notes_update" on work_notes
  for update using (
    owner_id = auth.uid()
    or exists (
      select 1 from work_note_shares s
      where s.note_id = work_notes.id and s.target_user_id = auth.uid() and s.permission = 'edit'
    )
  );

create policy "work_notes_delete" on work_notes
  for delete using (owner_id = auth.uid());

alter table work_note_shares enable row level security;

create policy "work_note_shares_select" on work_note_shares
  for select using (
    target_user_id = auth.uid()
    or exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );
create policy "work_note_shares_insert" on work_note_shares
  for insert with check (
    exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );
create policy "work_note_shares_update" on work_note_shares
  for update using (
    exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );
create policy "work_note_shares_delete" on work_note_shares
  for delete using (
    exists (select 1 from work_notes n where n.id = work_note_shares.note_id and n.owner_id = auth.uid())
  );

alter table work_note_history enable row level security;

create policy "work_note_history_select" on work_note_history
  for select using (
    exists (
      select 1 from work_notes n
      where n.id = work_note_history.note_id
        and (n.owner_id = auth.uid()
             or exists (select 1 from work_note_shares s where s.note_id = n.id and s.target_user_id = auth.uid()))
    )
  );
create policy "work_note_history_insert" on work_note_history
  for insert with check (
    exists (
      select 1 from work_notes n
      where n.id = work_note_history.note_id
        and (n.owner_id = auth.uid()
             or exists (select 1 from work_note_shares s where s.note_id = n.id and s.target_user_id = auth.uid() and s.permission = 'edit'))
    )
  );
-- update/delete 정책 없음 = 이력은 불변. work_notes 삭제 시 FK cascade로 shares/history도 같이 삭제됨.
