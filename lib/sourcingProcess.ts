// 소싱 항목의 "진행 단계" - 예전엔 상태(검토중/발주완료/보류/판매중/판매중지)와
// 후보/확정, 우선순위 안의 "발주 대기/진행 중"이 따로 흩어져 있었다. 이제는 아래 6단계
// 하나로 본다.
//
// DB는 바꾸지 않는다(sourcing_items.status는 제약 없는 text). 새 단계 값은 status에
// 그대로 저장하고, 예전 값(checking/ordered/not_set + stage + priority)으로 저장된 항목은
// 읽을 때 아래 규칙으로 같은 단계로 환산한다. 그래서 기존 데이터 이전 작업이 필요 없고,
// 항목의 단계를 한 번 바꾸면 그때부터 새 값으로 저장된다.
//
// 클라이언트/서버 공용 순수 함수.

export type ProcessStep =
  | 'before_review'
  | 'needs_review'
  | 'reviewed'
  | 'sourcing'
  | 'on_sale'
  | 'stopped'
  | 'hold';

export const PROCESS_STEPS: { value: ProcessStep; label: string }[] = [
  { value: 'before_review', label: '검수전' },
  { value: 'needs_review', label: '추가 검토 필요' },
  { value: 'reviewed', label: '검수 완료' },
  { value: 'sourcing', label: '소싱 진행 중' },
  { value: 'on_sale', label: '판매중' },
  { value: 'stopped', label: '판매중지' },
  { value: 'hold', label: '보류' },
];

export const PROCESS_LABEL: Record<ProcessStep, string> = Object.fromEntries(
  PROCESS_STEPS.map((s) => [s.value, s.label])
) as Record<ProcessStep, string>;

// 칩/배지 색 (Tailwind 토큰은 기존 SourcingList가 쓰던 것과 같은 계열)
export const PROCESS_STYLE: Record<ProcessStep, string> = {
  before_review: 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine',
  needs_review: 'bg-red-50 text-red-700',
  reviewed: 'bg-accentBg text-accent ring-1 ring-inset ring-accent/20',
  sourcing: 'bg-warnBg text-warn',
  on_sale: 'bg-profitBg text-profit',
  stopped: 'bg-paperLine text-inkSoft',
  hold: 'bg-paperLine text-inkSoft',
};

export function isProcessStep(v: unknown): v is ProcessStep {
  return typeof v === 'string' && PROCESS_STEPS.some((s) => s.value === v);
}

export function resolveProcess(item: {
  status?: string | null;
  stage?: string | null;
  priority?: string | null;
}): ProcessStep {
  const status = item.status || '';
  // 새 값으로 저장된 항목은 그대로
  if (isProcessStep(status)) return status;
  // 예전 값: 발주완료 / 우선순위의 발주 대기·진행 중 → 소싱 진행 중
  if (status === 'ordered') return 'sourcing';
  if (item.priority === 'waiting' || item.priority === 'ordering') return 'sourcing';
  // 예전 값: 미입력/검토중 → 확정이면 검수 완료, 아니면 검수전
  return item.stage === 'confirmed' ? 'reviewed' : 'before_review';
}

// 우선순위는 1~3순위/미지정만 남긴다. 예전 "발주 대기/진행 중" 값은 미지정으로 본다
// (그 의미는 진행 단계 "소싱 진행 중"으로 옮겨졌다).
export function normalizePriority(p: string | null | undefined): '1' | '2' | '3' | null {
  return p === '1' || p === '2' || p === '3' ? p : null;
}
