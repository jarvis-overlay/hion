'use client';

import { useState, useTransition } from 'react';
import { syncCoupangInventory } from '@/app/dashboard/inventory/channels/actions';

export default function CoupangSyncButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleSync() {
    setMessage(null);
    startTransition(async () => {
      const result: any = await syncCoupangInventory();
      if (result.error) {
        setMessage(`⚠️ ${result.error}`);
      } else {
        const catalogPart = result.catalogSkipped
          ? ` · 카탈로그는 최근에 돌려서 생략(1시간 쿨다운)`
          : result.catalogError
          ? ` · 카탈로그 갱신 실패(${result.catalogError})`
          : ` · 매핑 갱신 ${result.catalogMapped ?? 0}건`;
        setMessage(
          `신규 등록 ${result.registered ?? 0}개 · 재고 변경 ${result.updated ?? 0}건 · 판매기록 ${result.logged ?? 0}건 · 반품 ${result.returnsLogged ?? 0}건${catalogPart}`
        );
      }
    });
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleSync}
          disabled={isPending}
          className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
        >
          {isPending ? '동기화 중...' : '⟳ 쿠팡 동기화'}
        </button>
        {message && (
          <span className="text-xs text-inkSoft whitespace-nowrap">
            {message}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="font-display font-bold mb-2">재고·판매 동기화 (쿠팡)</h3>
      <p className="text-xs text-inkSoft mb-3">
        쿠팡 로켓창고의 실제 재고와 오늘 판매된 상품 내역을 가져와요. 우리
        시스템에 없는 상품이 팔렸으면 <b>자동으로 상품 등록</b>까지 해줘요.
      </p>
      <button
        onClick={handleSync}
        disabled={isPending}
        className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '동기화 중...' : '지금 동기화'}
      </button>
      {message && <p className="text-xs mt-3 text-inkSoft">{message}</p>}
    </div>
  );
}
