-- 반품등급(회수품)의 등급(최상/상/중 등) 표시용. 쿠팡에만 있는 개념이라
-- 다른 채널과 무관하게 상품 단위로 자유 텍스트로 저장한다.
-- Supabase SQL Editor에서 이 파일만 추가로 실행하세요.

alter table products
  add column if not exists return_grade text;
