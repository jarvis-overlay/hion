-- 중복 자동등록 상품 정리 + 재발 방지
-- Supabase SQL Editor에서 이 파일 전체를 순서대로 실행하세요.
-- (여러 번 실행해도 안전하게 설계되어 있어요)

-- 1. 중복 상품(같은 쿠팡 옵션ID)의 재고를 대표 상품(가장 먼저 등록된 것) 쪽으로 합산
with dupes as (
  select coupang_vendor_item_id, min(id) as keep_id
  from products
  where coupang_vendor_item_id is not null
  group by coupang_vendor_item_id
  having count(*) > 1
)
insert into warehouse_stock (product_id, warehouse, quantity)
select d.keep_id, ws.warehouse, ws.quantity
from warehouse_stock ws
join products p on p.id = ws.product_id
join dupes d on d.coupang_vendor_item_id = p.coupang_vendor_item_id
where p.id <> d.keep_id
on conflict (product_id, warehouse)
do update set quantity = warehouse_stock.quantity + excluded.quantity;

-- 2. 중복 상품 쪽의 원래 재고 행 삭제 (방금 대표 상품 쪽으로 옮겼으니)
with dupes as (
  select coupang_vendor_item_id, min(id) as keep_id
  from products
  where coupang_vendor_item_id is not null
  group by coupang_vendor_item_id
  having count(*) > 1
)
delete from warehouse_stock ws
using products p, dupes d
where ws.product_id = p.id
  and p.coupang_vendor_item_id = d.coupang_vendor_item_id
  and p.id <> d.keep_id;

-- 3. 중복 상품 쪽에 쌓여있던 히스토리(판매기록 등)를 대표 상품 쪽으로 이관
with dupes as (
  select coupang_vendor_item_id, min(id) as keep_id
  from products
  where coupang_vendor_item_id is not null
  group by coupang_vendor_item_id
  having count(*) > 1
)
update stock_movements sm
set product_id = d.keep_id
from products p, dupes d
where sm.product_id = p.id
  and p.coupang_vendor_item_id = d.coupang_vendor_item_id
  and p.id <> d.keep_id;

-- 4. 이제 빈 껍데기가 된 중복 상품 삭제
with dupes as (
  select coupang_vendor_item_id, min(id) as keep_id
  from products
  where coupang_vendor_item_id is not null
  group by coupang_vendor_item_id
  having count(*) > 1
)
delete from products p
using dupes d
where p.coupang_vendor_item_id = d.coupang_vendor_item_id
  and p.id <> d.keep_id;

-- 5. 앞으로 같은 쿠팡 옵션ID로 상품이 두 번 등록되는 것 자체를 DB에서 막기
create unique index if not exists products_coupang_vendor_item_id_idx
  on products (coupang_vendor_item_id)
  where coupang_vendor_item_id is not null;
