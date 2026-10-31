# 실행 대기 중인 SQL 마이그레이션

Supabase SQL Editor에서 아직 실행했는지 확인 안 된 `.sql` 파일 체크리스트.
다른 PC에서 `git pull` 받으면 이 파일도 같이 내려오니, 여기 체크 안 된
항목만 Supabase SQL Editor에 순서대로 복붙해서 실행하면 됨.

실행 확인되면 아래에서 체크(`[x]`)하고, 다음에 `schema.sql`에도 합쳐서
정리할 것(README 5번 항목 참고).

## 체크리스트

- [x] `supabase/ai_product_recommendations.sql` — AI 소싱추천 결과를 자동소싱 탭 안에서 바로 담을 수 있게 하는 캐시 테이블 (2026-10-31, 커밋 b10b10c)
- [x] `supabase/sales_category_learning.sql` — 썸네일/상세페이지 제작 시 "인기상품 참고"용 카테고리 컬럼 추가 (2026-10-31, 커밋 97cc624)
- [x] `supabase/thumbnail_color_label.sql` — 썸네일 일괄생성 색상별 완전 별도 세트 생성용 컬럼 추가 (2026-10-31, 커밋 2a6629a)
- [x] `supabase/pipeline_candidates.sql` — 자동소싱 탭 단계별 후보 테이블 (커밋 7ba816a, 위 체크리스트에서 빠져 있던 것)

## 오늘(2026-10-31) 추가된 SQL 전체 내용 (순서대로 실행)

```sql
-- 1) ai_product_recommendations.sql
create table if not exists ai_product_recommendations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_email text,
  item text not null,
  category text,
  coupang_price numeric,
  coupang_review_count numeric,
  coupang_link text,
  coupang_image_url text,
  market_scale_tier text,
  competition_tier text,
  supplier_link text,
  supplier_notes text
);

alter table ai_product_recommendations enable row level security;

create policy "ai_product_recommendations_select" on ai_product_recommendations
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "ai_product_recommendations_insert" on ai_product_recommendations
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "ai_product_recommendations_delete" on ai_product_recommendations
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));

-- 2) sales_category_learning.sql
alter table thumbnail_projects add column if not exists category text;
alter table detail_page_projects add column if not exists category text;

-- 3) thumbnail_color_label.sql
alter table thumbnail_images add column if not exists color_label text;
```

## 규칙 (Claude Code가 지킬 것)

- `supabase/` 밑에 새 `.sql` 파일을 추가할 때마다 이 파일의 체크리스트에도
  한 줄 추가하고, 그 SQL 전체 내용을 위 "오늘 추가된 SQL" 섹션 형식으로
  같이 기록한다.
- 사용자가 "Supabase에서 실행했다"고 확인하면 해당 체크박스를 `[x]`로
  바꾸고, 가능하면 `schema.sql`에도 반영해서 최신 상태로 합친다.
- 이 파일은 항상 git에 커밋해서 다른 PC에서 `git pull`만 받으면 바로
  보이게 유지한다 (별도로 사용자에게 복붙해서 전달할 필요 없음).
