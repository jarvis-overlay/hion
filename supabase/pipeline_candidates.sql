-- Supabase SQL Editor에서 실행하세요.
-- "자동소싱" 탭 - AI 소싱추천(1단계) → 1688 탐색(2단계) → 발주협의(3단계)
-- → 이미지제작(4단계) → 등록(5단계)으로 이어지는 자동화 플로우 전용
-- 테이블. 기존 소싱리스트(sourcing_items)와 공간을 완전히 분리해서,
-- "자동으로 들어온 탐색 중 후보"와 "내가 직접 깊게 관리하는 상품"이
-- 안 섞이게 한다. 발주까지 실제로 확정되면 소싱리스트로 전환해서
-- 그 이후부터는 공급처 비교/체크리스트 등 기존 기능으로 관리한다.
create table if not exists pipeline_candidates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text,
  stage text not null default 'coupang_search'
    check (stage in ('coupang_search', 'market_1688', 'negotiating', 'image_production', 'listed')),
  title text not null,
  category text,
  coupang_price numeric,
  coupang_review_count int,
  coupang_link text,
  coupang_image_url text,
  market_scale_tier text,
  competition_tier text,
  supplier_link text,
  supplier_price numeric,
  supplier_notes text,
  sourcing_item_id uuid references sourcing_items(id) on delete set null,
  promoted_at timestamptz
);

alter table pipeline_candidates enable row level security;

create policy "pipeline_candidates_select" on pipeline_candidates
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "pipeline_candidates_insert" on pipeline_candidates
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "pipeline_candidates_update" on pipeline_candidates
  for update
  using (auth.jwt() ->> 'email' in (select email from allowed_users))
  with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "pipeline_candidates_delete" on pipeline_candidates
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
