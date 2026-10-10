'use client';

// 재고·판매 현황 화면에서 예기치 못한 에러가 나도 빈 화면 대신 원인과
// 다시 시도 버튼을 보여준다.
export default function StockError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-2xl grid gap-3">
      <h1 className="font-display text-xl font-bold">재고·판매 현황을 불러오지 못했어요</h1>
      <p className="text-sm text-inkSoft">
        잠시 후 다시 시도해보세요. 계속되면 아래 내용을 알려주세요.
      </p>
      <pre className="bg-paper border border-paperLine rounded p-3 text-xs whitespace-pre-wrap break-all">
        {error.message}
        {error.digest ? `\ndigest: ${error.digest}` : ''}
      </pre>
      <button onClick={reset} className="btn-primary px-4 py-2 text-sm justify-self-start">
        다시 시도
      </button>
    </div>
  );
}
