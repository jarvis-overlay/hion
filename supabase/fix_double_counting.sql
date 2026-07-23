-- 판매 집계 버그 수정을 위한 정리 SQL
-- Supabase SQL Editor에서 이 파일 전체를 실행하세요.

-- 1. 재고 동기화 기록(external_ref 없음)에 잘못 붙어있던 channel 태그 제거
--    -> "채널별 판매 현황" 표에서 재고동기화 기록이 판매로 잘못 집계되던 문제 해결
update stock_movements
set channel = null
where external_ref is null
  and note like '%재고 동기화%';

-- 2. 혹시 동시 실행으로 같은 주문이 중복 저장됐다면 정리
--    (external_ref가 같은 행 중 가장 오래된 것 하나만 남기고 삭제)
delete from stock_movements a
using stock_movements b
where a.external_ref is not null
  and a.external_ref = b.external_ref
  and a.id > b.id;

-- 3. 중복 방지 유니크 제약이 확실히 걸려있는지 재확인 (이미 있으면 무시됨)
create unique index if not exists stock_movements_external_ref_idx
  on stock_movements (external_ref)
  where external_ref is not null;
