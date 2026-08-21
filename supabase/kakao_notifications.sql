-- 카카오톡 "나에게 보내기" 알림 수신자 테이블. 각 사람이 본인 카카오
-- 계정으로 로그인 인증을 한 번 하면, 그 사람의 access/refresh 토큰을
-- 저장해뒀다가 새 주문이 들어올 때마다 그 토큰으로 "나에게 보내기" API를
-- 호출해서 각자의 카카오톡에 알림을 보낸다.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

create table if not exists kakao_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label text not null, -- 화면에 표시할 이름 (예: "사장님", "매니저")
  kakao_user_id text not null unique,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  connected boolean not null default true
);

alter table kakao_notification_recipients enable row level security;

create policy "kakao_recipients_select" on kakao_notification_recipients
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "kakao_recipients_insert" on kakao_notification_recipients
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "kakao_recipients_update" on kakao_notification_recipients
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "kakao_recipients_delete" on kakao_notification_recipients
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
