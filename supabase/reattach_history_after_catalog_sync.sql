-- ⚠️ 반드시 카탈로그 동기화(/api/cron/sync-coupang-catalog) 실행 후에 돌릴 것.

-- 1. 과거 판매기록(stock_movements)을, external_ref에 들어있는 옵션ID를 기준으로
--    "지금 그 옵션ID가 실제로 매핑돼 있는 상품"으로 재배치한다.
--    (이름이 달라서 예전엔 다른 상품으로 쪼개져 기록됐던 것들이 여기서 합쳐짐)
update stock_movements sm
set product_id = pvi.product_id
from product_vendor_items pvi
where sm.external_ref like 'coupang-order:%'
  and pvi.vendor_item_id = split_part(sm.external_ref, ':', 3)
  and sm.product_id <> pvi.product_id;

-- 2. 이제 옵션ID 매핑도 없고 판매/재고 이력도 하나도 안 남은 상품(=완전히 고아가 된
--    예전 중복 상품)을 정리한다. 재고행은 어차피 다음 재고동기화 때 올바른 상품
--    기준으로 새로 채워지므로 그냥 지워도 안전함.
delete from warehouse_stock
where product_id in (
  select id from products
  where id not in (select distinct product_id from product_vendor_items)
    and id not in (select distinct product_id from stock_movements)
);

delete from products
where id not in (select distinct product_id from product_vendor_items)
  and id not in (select distinct product_id from stock_movements);

-- 3. 확인: 지금 남아있는 상품과, 각 상품에 매핑된 옵션ID 개수
select p.id, p.name, p.coupang_seller_product_id,
       count(pvi.vendor_item_id) as vendor_item_count
from products p
left join product_vendor_items pvi on pvi.product_id = p.id
group by p.id, p.name, p.coupang_seller_product_id
order by p.name;
