-- Supabase SQL Editor에서 실행하세요.
-- "판매" 대분류의 첫 기능 - 소싱 후보 하나마다 실제 쿠팡 시장 위치 +
-- 이미 입력해둔 공급처/비교 상품군 데이터를 근거로 AI가 판매 전략을
-- 생성해서 저장한다. 다시 생성하면 덮어쓴다(이력 관리는 아직 필요
--없다는 판단 - 필요해지면 나중에 별도 테이블로 분리).
create table if not exists sourcing_item_strategies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null unique references sourcing_items(id) on delete cascade,
  keyword text,                  -- 시장 조회에 쓴 검색어
  market_badges jsonb,           -- 그 시점의 시장규모/경쟁강도 뱃지 스냅샷
  market_verdict text,           -- 뱃지 기반 한줄 결론
  pricing_strategy text,
  review_strategy text,
  ad_strategy text,
  channel_strategy text,
  differentiation text
);

alter table sourcing_item_strategies enable row level security;

create policy "sourcing_item_strategies_select" on sourcing_item_strategies
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_strategies_insert" on sourcing_item_strategies
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_strategies_update" on sourcing_item_strategies
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_strategies_delete" on sourcing_item_strategies
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
