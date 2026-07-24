alter table products add column if not exists coupang_seller_product_id text;
create unique index if not exists products_coupang_seller_product_id_key
  on products (coupang_seller_product_id);
