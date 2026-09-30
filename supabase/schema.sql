-- ============================================================================
-- HION HUB 통합 스키마 (2026-09-30 기준 최신 스냅샷)
-- ============================================================================
-- 이 파일 하나를 Supabase SQL Editor에서 그대로 실행하면, 지금 운영 중인
-- DB와 동일한 구조(모든 테이블 + 컬럼 + RLS 정책)를 새 프로젝트에도 그대로
-- 만들 수 있습니다. 전부 `if not exists` / `add column if not exists`로
-- 작성돼 있어서, 이미 세팅된 운영 DB에 다시 실행해도 안전합니다(중복 생성
-- 안 됨).
--
-- 이 파일은 supabase/ 폴더에 쌓여있던 35개의 개별 마이그레이션 파일
-- (schema.sql 최초 버전 이후 추가된 모든 alter/create)을 시간순으로 합쳐서
-- 만들었습니다. 개별 마이그레이션 파일들은 "어떤 이유로 이 변경을 했는지"
-- 기록(히스토리)으로서 그대로 남겨뒀고, 앞으로 새 프로젝트를 세팅하거나
-- 재해복구를 할 땐 이 파일 하나만 실행하면 됩니다.
--
-- ⚠️ 예외 1: `product_vendor_items` 테이블은 어떤 마이그레이션 파일에도
-- CREATE TABLE 구문이 없었습니다 (Supabase SQL Editor에서 직접 만들고 파일로
-- 안 남긴 것으로 추정). 아래 정의는 앱 코드(lib/coupangSync.ts,
-- app/dashboard/inventory/products/actions.ts)의 실제 사용 패턴을 보고
-- 역추적해서 재구성한 것이라, 운영 DB의 실제 컬럼과 100% 같은지 한 번
-- Supabase 대시보드에서 대조 확인해보시는 걸 권장합니다.
--
-- ⚠️ 예외 2: `products.coupang_vendor_item_id`에 이름만 다른 동일한 unique
-- 인덱스가 두 번(다른 시점에) 생성된 이력이 있어서, 통합본에는 하나만
-- 남겼습니다. 운영 DB에 중복 인덱스가 남아있어도 동작엔 문제없습니다.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 접속 허용된 이메일 목록 (모든 테이블의 RLS가 이 목록을 기준으로 동작)
-- ----------------------------------------------------------------------------
create table if not exists allowed_users (
  email text primary key
);

alter table allowed_users enable row level security;

create policy "allowed_users_select" on allowed_users
  for select using (auth.role() = 'authenticated');


-- ----------------------------------------------------------------------------
-- 2. 마진 계산기 - 저장된 계산 기록
-- ----------------------------------------------------------------------------
create table if not exists margin_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  name text not null,
  price numeric not null,
  cost numeric not null default 0,
  fee_rate numeric not null default 0,       -- 더 이상 안 씀 (아래 coupang_fee로 대체) - 하위호환용으로 유지
  shipping numeric not null default 0,
  ad_cost numeric not null default 0,
  etc_cost numeric not null default 0,
  profit numeric not null,
  margin_pct numeric not null,
  output_vat numeric,                        -- 매출부가세 (실제 정산 내역 기반 직접입력)
  import_vat numeric,                        -- 매입부가세
  coupang_fee numeric                        -- 쿠팡수수료 (실액)
);

alter table margin_entries enable row level security;

create policy "margin_select" on margin_entries
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "margin_insert" on margin_entries
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "margin_delete" on margin_entries
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));


-- ----------------------------------------------------------------------------
-- 3. 소싱 정보 / 소싱 리스트 (레거시)
-- ----------------------------------------------------------------------------
-- sourcing_items로 통합되면서 앱 코드는 더 이상 이 두 테이블에 쓰지 않지만,
-- 과거 데이터 백업 + 대시보드 홈 통계 카드가 아직 sourcing_posts를 읽고
-- 있어서 삭제하지 않고 유지합니다.
create table if not exists sourcing_notes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  title text not null,
  link text,
  content text
);

create table if not exists sourcing_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  title text not null,
  source_url text,
  price numeric,
  moq text,
  notes text,
  status text not null default 'checking' -- checking | ordered | hold
);

alter table sourcing_notes enable row level security;
alter table sourcing_posts enable row level security;

create policy "notes_select" on sourcing_notes
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "notes_insert" on sourcing_notes
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "notes_delete" on sourcing_notes
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "posts_select" on sourcing_posts
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "posts_insert" on sourcing_posts
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "posts_update" on sourcing_posts
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "posts_delete" on sourcing_posts
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));


-- ----------------------------------------------------------------------------
-- 4. 소싱 리스트 (통합 테이블) - 지금 "소싱 리스트" 화면이 실제로 쓰는 테이블
-- ----------------------------------------------------------------------------
create table if not exists sourcing_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  title text not null,
  link text,
  content text,
  price numeric,        -- 참고 판매가 (마진 계산용)
  cost numeric,          -- 매입 원가 (마진 계산용)
  moq text,
  status text not null default 'checking',    -- checking | ordered | hold
  stage text not null default 'candidate',    -- candidate | confirmed
  coupon numeric,
  fee_rate numeric not null default 10.8,
  shipping numeric,
  ad_cost numeric,
  etc_cost numeric,
  output_vat numeric,
  import_vat numeric,
  coupang_fee numeric,
  input_status text not null default 'not_entered'  -- entered | not_entered (카드에서 수동 토글)
    constraint sourcing_items_input_status_check check (input_status in ('entered', 'not_entered'))
);

alter table sourcing_items enable row level security;

create policy "sourcing_items_select" on sourcing_items
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_items_insert" on sourcing_items
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_items_update" on sourcing_items
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_items_delete" on sourcing_items
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- 4-1. 소싱 후보의 옵션 구성 (색상/사이즈 등 옵션별 마진 계산)
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

-- 4-2. 소싱 후보의 공급처 비교 (1688/알리바바 여러 공급처 가격 비교)
create table if not exists sourcing_item_suppliers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  title text,                -- 공급처/상품 구분용 이름
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

-- 4-3. 소싱 후보의 비교 상품군 (쿠팡/네이버에서 관찰한 가격대·시장규모)
create table if not exists sourcing_item_comparisons (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  title text,                -- 비교 상품군 구분용 이름
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

-- 4-4. 소싱 후보의 AI 판매 전략 (재생성하면 덮어씀, 이력 관리 없음)
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

-- 4-5. 소싱 후보의 원본 사진 가공 결과 (번역/누끼/리사이즈)
create table if not exists sourcing_item_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sourcing_item_id uuid not null references sourcing_items(id) on delete cascade,
  original_url text not null,
  translated_url text,  -- 중국어->한국어 텍스트 합성 결과
  cutout_url text,      -- 배경 제거(누끼) 결과
  resized_url text       -- 쿠팡 상세페이지 규격(가로 860px) 리사이즈 결과
);

alter table sourcing_item_images enable row level security;

create policy "sourcing_item_images_select" on sourcing_item_images
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_images_insert" on sourcing_item_images
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_images_update" on sourcing_item_images
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_item_images_delete" on sourcing_item_images
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));


-- ----------------------------------------------------------------------------
-- 5. 재고관리 - 상품 마스터 / 발주 / 창고 재고 / 재고 히스토리
-- ----------------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text not null,
  name text not null,
  sku text,
  china_link text,
  notes text,
  coupang_vendor_item_id text,          -- (레거시, 지금은 동기화 로직에서 안 읽음 - product_vendor_items로 대체됨)
  is_hidden boolean not null default false,
  coupang_seller_product_id text,        -- 쿠팡 "등록상품ID" (카탈로그 동기화 기준)
  coupon_discount numeric not null default 0,   -- 상품별 쿠팡 쿠폰 할인액 (원 단위, 개당)
  shipping_cost numeric not null default 0,      -- 고정 배송비 (성과 분석 마진 계산용)
  manual_cost numeric,                            -- 발주 기록 없는 상품(반품등급 재판매 등)용 직접입력 원가
  sale_price numeric,                             -- 상품 카드 마진 계산기용 판매가
  fee_rate numeric not null default 10.8,         -- 상품 카드 마진 계산기용 쿠팡수수료율
  prev_stock_snapshot integer,                    -- 일단위 재고 대사(반품 추정)용 스냅샷
  prev_stock_snapshot_at timestamptz,
  return_grade text,                              -- 반품등급(회수품) 등급 표시
  import_vat numeric                              -- 매입부가세 직접입력
);

create unique index if not exists products_coupang_vendor_item_id_key
  on products (coupang_vendor_item_id)
  where coupang_vendor_item_id is not null;

create unique index if not exists products_coupang_seller_product_id_key
  on products (coupang_seller_product_id);

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
  note text,
  unit_price_krw numeric   -- 부가세/관세 포함 최종 원화 매입단가 직접입력 (있으면 이걸 우선 사용)
);

create table if not exists warehouse_stock (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  warehouse text not null, -- 'coupang' | 'own'
  quantity integer not null default 0,
  unique (product_id, warehouse)
);

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
  note text,
  external_ref text,               -- 쿠팡 주문 동기화 중복 방지용 외부 참조값 ('coupang-order:주문번호:옵션ID')
  amount numeric,                  -- 매출금액
  occurred_at timestamptz not null default now()  -- 실제 발생 시각 (동기화 시각과 구분)
);

create unique index if not exists stock_movements_external_ref_idx
  on stock_movements (external_ref)
  where external_ref is not null;

-- 5-1. 상품 ↔ 쿠팡 옵션ID(vendorItemId) 매핑 (1:N - 판매자배송/로켓그로스 등
-- 옵션ID가 여러 개인 경우 대응). 쿠팡 재고/판매 동기화가 실제로 기준으로
-- 삼는 테이블. ⚠️ 파일 상단 안내 참고 - 컬럼 구성은 앱 코드 기준 역추적.
create table if not exists product_vendor_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product_id uuid not null references products(id) on delete cascade,
  vendor_item_id text not null unique,
  is_return_grade boolean not null default false  -- 반품 재판매(회수품) 등급 여부 - true면 매출 계산 시 쿠폰 할인 미적용
);

alter table products enable row level security;
alter table purchase_orders enable row level security;
alter table warehouse_stock enable row level security;
alter table stock_movements enable row level security;
alter table product_vendor_items enable row level security;

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

create policy "product_vendor_items_select" on product_vendor_items
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "product_vendor_items_insert" on product_vendor_items
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "product_vendor_items_update" on product_vendor_items
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "product_vendor_items_delete" on product_vendor_items
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));


-- ----------------------------------------------------------------------------
-- 6. 채널 연동 (쿠팡/네이버 API 키)
-- ----------------------------------------------------------------------------
create table if not exists channel_credentials (
  channel text primary key, -- 'coupang' | 'naver'
  vendor_id text,
  access_key text,
  secret_key text,
  client_id text,
  client_secret text,
  connected boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  catalog_synced_at timestamptz   -- 카탈로그 전체 재스캔 쿨다운용
);

alter table channel_credentials enable row level security;

create policy "channel_credentials_select" on channel_credentials
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "channel_credentials_insert" on channel_credentials
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "channel_credentials_update" on channel_credentials
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "channel_credentials_delete" on channel_credentials
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));


-- ----------------------------------------------------------------------------
-- 7. 알림 - 카카오톡 "나에게 보내기" 수신자 / 웹푸시(PWA) 구독
-- ----------------------------------------------------------------------------
create table if not exists kakao_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label text not null, -- 화면에 표시할 이름 (예: "사장님", "매니저")
  kakao_user_id text not null unique,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  connected boolean not null default true
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  label text not null, -- 화면에 표시할 이름 (예: "사장님 폰")
  endpoint text not null unique,
  p256dh text not null,
  auth text not null
);

alter table kakao_notification_recipients enable row level security;
alter table push_subscriptions enable row level security;

create policy "kakao_recipients_select" on kakao_notification_recipients
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "kakao_recipients_insert" on kakao_notification_recipients
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "kakao_recipients_update" on kakao_notification_recipients
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "kakao_recipients_delete" on kakao_notification_recipients
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "push_subscriptions_select" on push_subscriptions
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "push_subscriptions_insert" on push_subscriptions
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "push_subscriptions_delete" on push_subscriptions
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));


-- ----------------------------------------------------------------------------
-- 8. 판매 - 상세페이지 제작 / 썸네일 제작
-- ----------------------------------------------------------------------------
-- 두 기능 모두 같은 storage 버킷(detail-images)을 재사용합니다.
insert into storage.buckets (id, name, public)
values ('detail-images', 'detail-images', true)
on conflict (id) do nothing;

drop policy if exists "detail_images_select" on storage.objects;
create policy "detail_images_select" on storage.objects
  for select using (bucket_id = 'detail-images');

drop policy if exists "detail_images_insert" on storage.objects;
create policy "detail_images_insert" on storage.objects
  for insert with check (
    bucket_id = 'detail-images'
    and auth.jwt() ->> 'email' in (select email from allowed_users)
  );

drop policy if exists "detail_images_update" on storage.objects;
create policy "detail_images_update" on storage.objects
  for update using (
    bucket_id = 'detail-images'
    and auth.jwt() ->> 'email' in (select email from allowed_users)
  );

drop policy if exists "detail_images_delete" on storage.objects;
create policy "detail_images_delete" on storage.objects
  for delete using (
    bucket_id = 'detail-images'
    and auth.jwt() ->> 'email' in (select email from allowed_users)
  );

-- 8-1. 상세페이지 제작 (프로젝트 하나 = 완성할 상세페이지 하나, 섹션을 순서대로 쌓음)
create table if not exists detail_page_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text,              -- 프로젝트 이름 (선택 - 안 적으면 목록에 날짜로 표시)
  author_email text
);

create table if not exists detail_page_sections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references detail_page_projects(id) on delete cascade,
  position int not null,          -- 프로젝트 안에서의 순서
  input_image_url text,           -- 첨부한 원본 상품 이미지 (없으면 null - AI가 이미지도 새로 생성)
  prompt_text text not null,      -- 키워드/분위기/설명 (화면 표시용 요약)
  output_image_url text,          -- 생성 결과 (쿠팡 규격 860px로 리사이즈된 최종본)
  error text,                     -- 생성 실패 시 에러 메시지 (재시도 가능하게)
  -- 재시도 시 같은 입력을 재사용하기 위한 개별 필드 (문구는 서버에서 폰트로 직접 합성)
  keyword text,
  mood text,
  description text,
  -- 향수 브랜드 레퍼런스 스타일 레이아웃용 확장 필드 (전부 선택)
  eyebrow text,
  accent_title text,
  accent_subtitle text,
  stat text,
  stat_caption text,
  layout_style text not null default 'white',   -- white | overlay | typography
  theme text not null default 'dark',            -- dark | purple | light
  -- 색상 변경 프롬프트 / 뱃지·문단·리스트 문구 타이어 / 제품 사양 표
  color_prompt text,
  badge text,
  body_text text,
  list_items text,
  spec_title text,
  spec_rows jsonb
);

alter table detail_page_projects enable row level security;
alter table detail_page_sections enable row level security;

create policy "detail_page_projects_select" on detail_page_projects
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_projects_insert" on detail_page_projects
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_projects_update" on detail_page_projects
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_projects_delete" on detail_page_projects
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "detail_page_sections_select" on detail_page_sections
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_sections_insert" on detail_page_sections
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_sections_update" on detail_page_sections
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "detail_page_sections_delete" on detail_page_sections
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- 8-2. 썸네일 제작 (메인 썸네일 1장 + 추가 이미지 여러 장)
create table if not exists thumbnail_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text,
  author_email text
);

create table if not exists thumbnail_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references thumbnail_projects(id) on delete cascade,
  kind text not null default 'additional',   -- 'main' | 'additional'
  position int not null default 0,           -- 추가 이미지끼리의 순서 (메인은 항상 0)
  input_image_url text not null,             -- 원본 상품 사진 (필수 - 누끼를 따야 하므로)
  product_position text not null default 'center', -- 'center' | 'top' | 'bottom' | 'left' | 'right'
  effect_prompt text,                        -- 효과 추가 프롬프트 (선택)
  output_image_url text,                     -- 1000x1000 완성본
  error text
);

alter table thumbnail_projects enable row level security;
alter table thumbnail_images enable row level security;

create policy "thumbnail_projects_select" on thumbnail_projects
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_projects_insert" on thumbnail_projects
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_projects_update" on thumbnail_projects
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_projects_delete" on thumbnail_projects
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

create policy "thumbnail_images_select" on thumbnail_images
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_images_insert" on thumbnail_images
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_images_update" on thumbnail_images
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "thumbnail_images_delete" on thumbnail_images
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));


-- ----------------------------------------------------------------------------
-- 9. 접속을 허용할 이메일 등록 (새 프로젝트 세팅 시 본인 이메일로 실행)
-- ----------------------------------------------------------------------------
insert into allowed_users (email) values
  ('dnr7350@gmail.com'),
  ('krispark917@gmail.com')
on conflict (email) do nothing;
