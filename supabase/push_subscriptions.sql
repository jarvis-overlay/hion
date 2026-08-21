-- 웹 푸시(PWA) 알림 구독 정보. 브라우저에서 "알림 받기"를 누르면 생기는
-- PushSubscription을 저장해뒀다가, 새 주문이 들어올 때마다 여기 저장된
-- 모든 기기로 푸시를 보낸다.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label text not null, -- 화면에 표시할 이름 (예: "사장님 폰")
  endpoint text not null unique,
  p256dh text not null,
  auth text not null
);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions_select" on push_subscriptions
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "push_subscriptions_insert" on push_subscriptions
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "push_subscriptions_delete" on push_subscriptions
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
