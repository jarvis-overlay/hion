-- Supabase SQL Editor에서 실행하세요.
-- AI 소싱추천(트렌드 탭)에서 실데이터로 검증된 추천이 나올 때마다 여기
-- 임시로 적재해둔다. "자동소싱" 탭을 AI 추천 탭과 별도로 열어야만 후보를
-- 담을 수 있는 게 불편하다는 요청으로 추가 - 자동소싱 탭 자체에서 바로
-- 리스트를 보고 타이핑 없이 담을 수 있게 한다. 자동소싱 후보(pipeline_
-- candidates)로 전환되거나 사용자가 숨기면 이 테이블에서는 삭제된다 -
-- 계속 쌓이는 로그가 아니라 "아직 자동소싱에 안 담은 추천" 임시 보관함.
create table if not exists ai_product_recommendations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text,
  item text not null,
  category text,
  coupang_price numeric,
  coupang_review_count numeric,
  coupang_link text,
  coupang_image_url text,
  market_scale_tier text,
  competition_tier text,
  supplier_link text,
  supplier_notes text
);

alter table ai_product_recommendations enable row level security;

create policy "ai_product_recommendations_select" on ai_product_recommendations
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "ai_product_recommendations_insert" on ai_product_recommendations
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "ai_product_recommendations_delete" on ai_product_recommendations
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
