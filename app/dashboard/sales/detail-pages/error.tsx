'use client';

export default function DetailPagesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-2xl grid gap-3">
      <h1 className="font-display text-xl font-bold">상세페이지 화면에서 에러가 났어요</h1>
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
