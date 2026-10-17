// 1688 공장 담당자와 샘플~본발주 단계에서 반복적으로 확인해야 하는
// 표준 질문 목록. 실제 소싱 채팅에서 자주 빠뜨려서 나중에 문제가 되는
// 항목들(원산지 표시, 박스 규격, 검수 등)을 정리해둔 것 - zhHint는
// 바로 복사해서 쓸 수 있는 중국어 문구(실제 채팅에서 쓰인 표현 기반).
export interface ChecklistTemplateItem {
  key: string;
  label: string;
  zhHint: string;
}

export const SOURCING_CHECKLIST_TEMPLATE: ChecklistTemplateItem[] = [
  {
    key: 'made_in_china',
    label: 'MADE IN CHINA 스티커 부착 (제품 본체 + 포장박스)',
    zhHint: '产品本体和单独包装盒上都需要贴"MADE IN CHINA"标签，请确认是否可以操作，以及是否需要额外费用。',
  },
  {
    key: 'unit_price',
    label: '최종 단가 확정 (수량별 할인 가능 여부 포함)',
    zhHint: '请确认这个数量的最终单价，是否还有优惠空间。',
  },
  {
    key: 'stock_leadtime',
    label: '현재 재고 여부 + 결제 후 출고까지 소요일',
    zhHint: '请问目前是否有现货，付款后大概几天可以发货？',
  },
  {
    key: 'unit_package',
    label: '개별 포장 크기 / 중량',
    zhHint: '请提供单个产品包装后的尺寸和重量。',
  },
  {
    key: 'outer_box',
    label: '외박스 크기 / 총중량 / 박스당 수량 (CBM 계산용)',
    zhHint: '请问外箱的尺寸是多少？长、宽、高分别是多少厘米，总重量多少，每箱装多少个？',
  },
  {
    key: 'barcode',
    label: '바코드 스티커 부착 가능 여부 + 비용',
    zhHint: '如果我们提供条形码文件，是否可以帮我们贴条形码标签？如有费用，请告知。',
  },
  {
    key: 'qc',
    label: '출고 전 검수 (파손 / 스크래치 / 변형 확인)',
    zhHint: '发货前请帮我们检查产品，尽量避免破损、划痕或变形。',
  },
  {
    key: 'manual',
    label: '조립설명서 / 조립영상 제공 여부 (조립형 제품)',
    zhHint: '请问产品里面是否有安装说明书？如果没有，可以提供安装说明或安装视频吗？',
  },
  {
    key: 'payment',
    label: '결제수단 안내 (신용카드 / WorldFirst / 1688 결제)',
    zhHint: '我们这边需要用信用卡或者WorldFirst进行付款，可以吗？',
  },
  {
    key: 'bulk_price',
    label: '본발주(대량) 시 단가 유지 조건',
    zhHint: '如果这次样品确认没有问题，后续我们会考虑追加订购。请确认到时是否可以按照之前提供的价格合作。',
  },
];
