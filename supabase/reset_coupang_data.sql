-- 쿠팡 재고/판매 데이터 초기화 (여러 번의 테스트로 꼬인 기록을 깨끗하게 정리)
-- Supabase SQL Editor에서 실행하세요. 실행 후 앱에서 "지금 동기화"를 다시 누르면
-- 지금 수정된 코드로 완전히 새로 계산돼요.

-- 1. 쿠팡 관련 히스토리(판매기록 + 재고동기화 기록) 전부 삭제
delete from stock_movements where warehouse = 'coupang';

-- 2. 쿠팡 창고 재고 수치도 초기화 (다음 동기화 때 실제 값으로 다시 채워짐)
delete from warehouse_stock where warehouse = 'coupang';
