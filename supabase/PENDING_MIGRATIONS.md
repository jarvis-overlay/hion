# 실행 대기 중인 SQL 마이그레이션

Supabase SQL Editor에서 아직 실행했는지 확인 안 된 `.sql` 파일 체크리스트.
다른 PC에서 `git pull` 받으면 이 파일도 같이 내려오니, 여기 체크 안 된
항목만 Supabase SQL Editor에 순서대로 복붙해서 실행하면 됨.

실행 확인되면 아래에서 체크(`[x]`)하고, `schema.sql`에도 합쳐서 정리할 것
(README 5번 항목 참고).

## 대기 중

없음 (2026-11-01 기준 아래 항목 전부 실행 확인됨)

## 실행 완료 (2026-11-01 확인, schema.sql 10번 섹션에 합침)

- [x] `supabase/ai_product_recommendations.sql` — AI 소싱추천 결과를 자동소싱 탭 안에서 바로 담을 수 있게 하는 캐시 테이블 (2026-10-31, 커밋 b10b10c)
- [x] `supabase/sales_category_learning.sql` — 썸네일/상세페이지 제작 시 "인기상품 참고"용 카테고리 컬럼 추가 (2026-10-31, 커밋 97cc624)
- [x] `supabase/thumbnail_color_label.sql` — 썸네일 일괄생성 색상별 완전 별도 세트 생성용 컬럼 추가 (2026-10-31, 커밋 2a6629a)
- [x] `supabase/pipeline_candidates.sql` — 자동소싱 탭 단계별 후보 테이블 (커밋 7ba816a, 이전 체크리스트에서 빠져 있어서 이번에 추가)
- [x] `supabase/sourcing_items_add_archived.sql` — 소싱 보관함 (archived_at)
- [x] `supabase/sourcing_items_add_priority.sql` + `*_priority_*` 3개 — 우선순위. 최종 허용값은 1/2/3/waiting/ordering
- [x] `supabase/item_notes*.sql`, `item_note_categories.sql` — 메모 타임라인
- [x] `supabase/sourcing_translation_history.sql`, `sourcing_excluded_categories.sql`
- [x] `supabase/sourcing_checklist_templates.sql`, `sourcing_item_checklist*.sql` — 소싱 체크리스트
- [x] `supabase/margin_entries_add_intl_shipping.sql` — 마진 계산기 쿠폰/해외배송비 컬럼

## 규칙 (Claude Code가 지킬 것)

- `supabase/` 밑에 새 `.sql` 파일을 추가할 때마다 이 파일의 "대기 중"에
  체크리스트 한 줄을 추가하고, 그 SQL 전체 내용도 같이 기록한다. 개별
  파일은 `create policy`처럼 두 번 실행하면 에러 나는 문장이 있으니, 복붙용
  SQL은 `drop policy if exists`를 붙여 여러 번 실행해도 안전하게 적는다.
- 사용자가 "Supabase에서 실행했다"고 확인하면 해당 항목을 `[x]`로 바꿔
  "실행 완료"로 옮기고, `schema.sql`에도 반영해서 최신 상태로 합친다.
- 새 `.sql` 파일을 추가했는지 확인할 때는 체크리스트만 믿지 말고
  `git diff --name-only --diff-filter=A <이전커밋>..HEAD -- supabase`로 실제
  새 파일 목록과 대조한다 (자동소싱용 `pipeline_candidates.sql`이 체크리스트에서
  빠졌던 적이 있음).
- 이 파일은 항상 git에 커밋해서 다른 PC에서 `git pull`만 받으면 바로
  보이게 유지한다 (별도로 사용자에게 복붙해서 전달할 필요 없음).
