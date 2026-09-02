-- Supabase SQL Editor에서 이 파일 전체를 그대로 실행하세요.
-- 소싱 후보 하나(sourcing_items)에 "비교 상품군 링크"를 여러 개 추가할 수
-- 있게 한다. 비교 상품 하나마다 쿠팡/네이버에서 관찰한 가격대·시장규모를
-- 각각 여러 건 기록할 수 있음(같은 플랫폼 안에서도 가격대별로 시장규모가
-- 다르게 형성돼 있을 수 있어서, 관찰 값을 여러 건 남길 수 있게 함).

create table if not exists sourcing_item_comparisons (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  link text
);

create table if not exists sourcing_comparison_prices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  comparison_id uuid not null references sourcing_item_comparisons(id) on delete cascade,
  platform text not null check (platform in ('coupang', 'naver')),
  price_range text,          -- 형성 가격대 (직접입력, 예: "8,000~12,000원")
  market_size text check (market_size in ('high', 'mid', 'low'))  -- 상/중/하
);

alter table sourcing_item_comparisons enable row level security;
alter table sourcing_comparison_prices enable row level security;

create policy "sourcing_item_comparisons_select" on sourcing_item_comparisons
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_comparisons_insert" on sourcing_item_comparisons
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_comparisons_update" on sourcing_item_comparisons
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_comparisons_delete" on sourcing_item_comparisons
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "sourcing_comparison_prices_select" on sourcing_comparison_prices
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_comparison_prices_insert" on sourcing_comparison_prices
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_comparison_prices_update" on sourcing_comparison_prices
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_comparison_prices_delete" on sourcing_comparison_prices
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
