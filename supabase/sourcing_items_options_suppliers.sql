-- Supabase SQL Editor에서 이 파일 전체를 그대로 실행하세요.
-- 소싱 후보 하나(sourcing_items)에 두 종류의 하위 목록을 추가한다:
-- 1) 옵션 구성 - 같은 상품의 색상/사이즈 등 옵션마다 가격/원가가
--    달라서 옵션별로 마진을 따로 계산해야 함.
-- 2) 공급처 비교 - 같은 상품을 여러 1688/알리바바 공급처에서 비교
--    하면서 가격을 저장해두고 싶음.

create table if not exists sourcing_item_options (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  name text not null,        -- 옵션명 (예: "블랙 / L", "10cm")
  price numeric,
  cost numeric,
  coupon numeric,
  output_vat numeric,
  import_vat numeric,
  coupang_fee numeric,
  shipping numeric,
  ad_cost numeric,
  etc_cost numeric
);

create table if not exists sourcing_item_suppliers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  link text,
  price numeric,
  currency text not null default 'CNY',  -- CNY | USD | KRW
  notes text
);

alter table sourcing_item_options enable row level security;
alter table sourcing_item_suppliers enable row level security;

create policy "sourcing_item_options_select" on sourcing_item_options
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_options_insert" on sourcing_item_options
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_options_update" on sourcing_item_options
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_options_delete" on sourcing_item_options
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "sourcing_item_suppliers_select" on sourcing_item_suppliers
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_suppliers_insert" on sourcing_item_suppliers
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_suppliers_update" on sourcing_item_suppliers
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_suppliers_delete" on sourcing_item_suppliers
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
