-- 소싱 상품의 추가 발주 이력 (1차, 2차 ...). 회차마다 그 시점의 마진 값(판매가 포함)을 따로 저장한다.
-- 기존 sourcing_items 값은 건드리지 않는다. 재실행해도 안전.
create table if not exists public.sourcing_item_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sourcing_item_id uuid not null references public.sourcing_items(id) on delete cascade,
  round_no integer not null,
  ordered_at date,
  quantity integer check (quantity is null or quantity > 0),
  note text,
  price numeric,
  cost numeric,
  coupon numeric,
  coupang_fee numeric,
  ad_cost numeric,
  shipping numeric,
  intl_shipping numeric,
  intl_shipping_calc jsonb,
  import_vat numeric,
  output_vat numeric,
  etc_cost numeric,
  cost_fx_currency text,
  cost_fx_amount numeric,
  cost_fx_rate numeric,
  fee_category text,
  unique (sourcing_item_id, round_no)
);

-- round_no를 안 보내면 그 상품의 최대 회차 + 1 (동시 입력은 advisory lock으로 직렬화)
create or replace function public.sourcing_item_orders_set_round()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.round_no is null then
    perform pg_advisory_xact_lock(hashtext('sio:' || new.sourcing_item_id::text));
    select coalesce(max(round_no), 0) + 1 into new.round_no
      from public.sourcing_item_orders
      where sourcing_item_id = new.sourcing_item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sourcing_item_orders_set_round on public.sourcing_item_orders;
create trigger sourcing_item_orders_set_round
  before insert on public.sourcing_item_orders
  for each row execute function public.sourcing_item_orders_set_round();

alter table public.sourcing_item_orders enable row level security;
drop policy if exists "sourcing_item_orders_select" on public.sourcing_item_orders;
drop policy if exists "sourcing_item_orders_insert" on public.sourcing_item_orders;
drop policy if exists "sourcing_item_orders_update" on public.sourcing_item_orders;
drop policy if exists "sourcing_item_orders_delete" on public.sourcing_item_orders;
create policy "sourcing_item_orders_select" on public.sourcing_item_orders
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_orders_insert" on public.sourcing_item_orders
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_orders_update" on public.sourcing_item_orders
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_orders_delete" on public.sourcing_item_orders
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

notify pgrst, 'reload schema';
