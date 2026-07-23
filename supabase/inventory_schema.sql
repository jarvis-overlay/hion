-- 재고관리 기능 추가 스키마
-- Supabase SQL Editor에서 이 파일 전체를 그대로 실행하세요.
-- (기존 schema.sql은 이미 실행했으니 건드리지 않아도 됩니다)

-- 1. 상품 마스터
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  name text not null,
  sku text,
  china_link text,
  notes text
);

-- 2. 중국 발주 기록
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  product_id uuid not null references products(id) on delete cascade,
  order_date date not null,
  quantity integer not null,
  unit_price_cny numeric not null default 0,
  exchange_rate numeric not null default 190, -- 발주 시점 원/위안 환율
  status text not null default 'ordered', -- ordered | received
  note text
);

-- 3. 창고별 현재 재고 (쿠팡 창고 / 자사 물류창고)
create table if not exists warehouse_stock (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  warehouse text not null, -- 'coupang' | 'own'
  quantity integer not null default 0,
  unique (product_id, warehouse)
);

-- 4. 재고 히스토리 (입고 / 이동 / 판매출고 전체 로그)
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  product_id uuid not null references products(id) on delete cascade,
  warehouse text not null, -- 'coupang' | 'own'
  type text not null, -- 'in'(입고) | 'out'(판매출고) | 'move'(창고이동)
  quantity integer not null, -- 입고/유입 시 양수, 출고/유출 시 음수
  channel text, -- 판매출고일 때만: naver | coupang | ohou | ably | toss
  related_order_id uuid references purchase_orders(id) on delete set null,
  note text
);

-- 5. RLS 활성화
alter table products enable row level security;
alter table purchase_orders enable row level security;
alter table warehouse_stock enable row level security;
alter table stock_movements enable row level security;

-- 6. 허용된 이메일만 CRUD 가능 (기존 allowed_users 테이블 재사용)
create policy "products_select" on products
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "products_insert" on products
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "products_update" on products
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "products_delete" on products
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "purchase_orders_select" on purchase_orders
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "purchase_orders_insert" on purchase_orders
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "purchase_orders_update" on purchase_orders
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "purchase_orders_delete" on purchase_orders
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "warehouse_stock_select" on warehouse_stock
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "warehouse_stock_insert" on warehouse_stock
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "warehouse_stock_update" on warehouse_stock
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "stock_movements_select" on stock_movements
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "stock_movements_insert" on stock_movements
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "stock_movements_delete" on stock_movements
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
