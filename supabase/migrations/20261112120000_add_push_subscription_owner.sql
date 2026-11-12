-- 앱 푸시 구독에 "누구 기기인지"(user_email)를 기록한다. 업무수첩을 공유할 때
-- 공유받은 사람의 기기로만 알림을 보내려면 기기 주인을 알아야 한다(지금까진
-- 등록된 모든 기기로 한꺼번에 보내서 공유한 본인에게도 갔을 것).
-- 이미 등록돼 있던 기기는 user_email이 비어있다 - 그 기기에서 알림 설정 화면의
-- "이 기기 등록하기"를 다시 누르면 주인이 연결된다.
alter table push_subscriptions add column if not exists user_email text;

create index if not exists push_subscriptions_user_email_idx
  on push_subscriptions (user_email);

-- upsert(endpoint 충돌 시 갱신)로 기존 기기에 주인을 연결하려면 UPDATE 정책이
-- 필요한데 원래 없었다 (select/insert/delete만 있었음).
drop policy if exists "push_subscriptions_update" on push_subscriptions;
create policy "push_subscriptions_update" on push_subscriptions
  for update
  using (auth.jwt() ->> 'email' in (select email from allowed_users))
  with check (auth.jwt() ->> 'email' in (select email from allowed_users));
