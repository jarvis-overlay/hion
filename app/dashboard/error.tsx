'use client';

// 대시보드 전체에 걸리는 공용 에러 화면 - 각 화면마다 따로 error.tsx를
// 추가하지 않아도, 처리 안 된 에러가 나면 사용자에게 "Application
// error"라는 의미 없는 기본 화면 대신 실제 에러 메시지를 보여준다
// (더 구체적인 error.tsx가 있는 하위 경로는 그쪽이 우선 적용됨 -
// app/dashboard/sales/detail-pages, app/dashboard/inventory/stock).
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-2xl grid gap-3">
      <h1 className="font-display text-xl font-bold">화면에서 에러가 났어요</h1>
      <pre className="bg-paper border border-paperLine rounded p-3 text-xs whitespace-pre-wrap break-all">
        {error.name}: {error.message}
        {error.digest ? `\ndigest: ${error.digest}` : ''}
        {error.stack ? `\n\n${error.stack.split('\n').slice(0, 8).join('\n')}` : ''}
      </pre>
      <button onClick={reset} className="btn-primary px-4 py-2 text-sm justify-self-start">
        다시 시도
      </button>
    </div>
  );
}
