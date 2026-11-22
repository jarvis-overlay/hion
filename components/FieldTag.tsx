// 마진 입력칸 이름 옆에 붙는 작은 구분 표시: 필수(꼭 입력) / 자동(자동으로 채워짐, 직접 수정 가능) / 선택(필요할 때만)
const STYLES = {
  required: 'bg-accent text-white',
  auto: 'bg-profitBg text-profit border border-profit/30',
  optional: 'bg-paper text-inkSoft border border-paperLine',
} as const;
const TEXT = { required: '필수', auto: '자동', optional: '선택' } as const;

export function FieldTag({ kind }: { kind: keyof typeof STYLES }) {
  return (
    <span className={`ml-1 px-1 py-px text-[9px] font-semibold leading-none align-middle ${STYLES[kind]}`}>{TEXT[kind]}</span>
  );
}

// 폼 맨 위에 한 번 보여주는 범례
export function FieldLegend() {
  return (
    <p className="text-[11px] text-inkSoft flex flex-wrap items-center gap-x-3 gap-y-1">
      <span><FieldTag kind="required" /> 꼭 입력해야 마진이 계산돼요</span>
      <span><FieldTag kind="auto" /> 자동으로 채워져요 (초록 칸, 직접 고쳐도 돼요)</span>
      <span><FieldTag kind="optional" /> 있을 때만 입력</span>
    </p>
  );
}
