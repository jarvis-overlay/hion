-- Supabase SQL Editor에서 실행하세요.
-- 체크리스트 기본 항목(모든 소싱 아이템에 공통 적용)을 코드에 고정하지
-- 않고 화면에서 추가/삭제할 수 있도록 DB 테이블로 옮긴다.
-- item_key는 기존 lib/sourcingChecklist.ts에 있던 키와 똑같이 맞춰서,
-- 이미 체크해둔 sourcing_item_checklist 데이터가 끊기지 않게 한다.
create table if not exists sourcing_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  item_key text not null unique,
  label text not null,
  zh_hint text,
  position int not null default 0
);

insert into sourcing_checklist_templates (item_key, label, zh_hint, position) values
  ('made_in_china', 'MADE IN CHINA 스티커 부착 (제품 본체 + 포장박스)', '产品本体和单独包装盒上都需要贴"MADE IN CHINA"标签，请确认是否可以操作，以及是否需要额外费用。', 0),
  ('unit_price', '최종 단가 확정 (수량별 할인 가능 여부 포함)', '请确认这个数量的最终单价，是否还有优惠空间。', 1),
  ('stock_leadtime', '현재 재고 여부 + 결제 후 출고까지 소요일', '请问目前是否有现货，付款后大概几天可以发货？', 2),
  ('unit_package', '개별 포장 크기 / 중량', '请提供单个产品包装后的尺寸和重量。', 3),
  ('outer_box', '외박스 크기 / 총중량 / 박스당 수량 (CBM 계산용)', '请问外箱的尺寸是多少？长、宽、高分别是多少厘米，总重量多少，每箱装多少个？', 4),
  ('barcode', '바코드 스티커 부착 가능 여부 + 비용', '如果我们提供条形码文件，是否可以帮我们贴条形码标签？如有费用，请告知。', 5),
  ('qc', '출고 전 검수 (파손 / 스크래치 / 변형 확인)', '发货前请帮我们检查产品，尽量避免破损、划痕或变形。', 6),
  ('manual', '조립설명서 / 조립영상 제공 여부 (조립형 제품)', '请问产品里面是否有安装说明书？如果没有，可以提供安装说明或安装视频吗？', 7),
  ('payment', '결제수단 안내 (신용카드 / WorldFirst / 1688 결제)', '我们这边需要用信用卡或者WorldFirst进行付款，可以吗？', 8),
  ('bulk_price', '본발주(대량) 시 단가 유지 조건', '如果这次样品确认没有问题，后续我们会考虑追加订购。请确认到时是否可以按照之前提供的价格合作。', 9)
on conflict (item_key) do nothing;

alter table sourcing_checklist_templates enable row level security;

create policy "sourcing_checklist_templates_select" on sourcing_checklist_templates
  for select using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_checklist_templates_insert" on sourcing_checklist_templates
  for insert with check (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_checklist_templates_update" on sourcing_checklist_templates
  for update using (auth.jwt() ->> 'email' in (select email from allowed_users));
create policy "sourcing_checklist_templates_delete" on sourcing_checklist_templates
  for delete using (auth.jwt() ->> 'email' in (select email from allowed_users));
