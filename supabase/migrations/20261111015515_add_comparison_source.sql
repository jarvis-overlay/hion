-- 비교 상품을 수동으로 입력했는지, "쿠팡 실데이터로 조사" 기능으로
-- 자동 저장했는지 구분해서 보여주기 위한 컬럼.
alter table sourcing_item_comparisons
  add column if not exists source text not null default 'manual' check (source in ('manual', 'coupang_auto'));
