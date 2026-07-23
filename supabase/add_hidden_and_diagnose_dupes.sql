-- 1. 상품 숨김/표시 기능용 컬럼 추가
alter table products add column if not exists is_hidden boolean not null default false;

-- 2. 중복 등록된 상품 진단 (읽기 전용 - 안전하게 실행 가능)
--    결과 캡처해서 Claude한테 보여주면 KEEP_ID/DROP_ID merge SQL 만들어줌
select
  name,
  count(*),
  array_agg(id) as ids,
  array_agg(coupang_vendor_item_id) as vendor_item_ids
from products
group by name
having count(*) > 1;

-- 3. 앞으로 auto-register upsert가 중복 없이 정상 동작하도록 유니크 제약 보장
create unique index if not exists products_coupang_vendor_item_id_key
  on products (coupang_vendor_item_id)
  where coupang_vendor_item_id is not null;
