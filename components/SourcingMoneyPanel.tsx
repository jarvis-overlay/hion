'use client';

import { useState, useTransition } from 'react';
import { updateSourcingMargin } from '@/app/dashboard/sourcing/list/actions';
import { useMarginFields } from '@/lib/useMarginFields';
import MarginFormBody from '@/components/MarginFormBody';
import { marginInitFromRow } from '@/lib/marginRow';

// 소싱 카드의 "마진·배송" 탭: 상품 "수정"을 열지 않고 금액 정보(판매가·원가·수수료·배송비·해외배송비)만 따로 입력·저장한다.
export default function SourcingMoneyPanel({
  item,
  onDone,
  orderCount,
  onGoOrders,
}: {
  item: any;
  onDone?: () => void;
  orderCount?: number; // 발주 이력이 있으면 맨 위에 "이 값은 기준(견적)" 안내를 보여준다
  onGoOrders?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const f = useMarginFields(marginInitFromRow(item));

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          setSaved(false);
          const res = await updateSourcingMargin(item.id, fd);
          if (!res || 'error' in res) {
            setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
            return;
          }
          setSaved(true);
          onDone?.();
        })
      }
      className="grid gap-3"
    >
      {orderCount != null && orderCount > 0 && (
        <p className="text-[11px] text-inkSoft bg-paper px-3 py-2 max-w-3xl">
          이 값은 기준(견적)이에요. 실제 발주 기록은 발주 이력 탭에서 보세요.{' '}
          {onGoOrders && (
            <button type="button" onClick={onGoOrders} className="text-accent underline font-semibold">
              발주 이력 탭으로 ({orderCount}회)
            </button>
          )}
        </p>
      )}
      <MarginFormBody f={f} item={item} />

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">저장 실패: {error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={isPending} className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50">
          {isPending ? '저장 중...' : '금액 정보 저장'}
        </button>
        {saved && !isPending && <span className="text-xs text-profit">저장했어요</span>}
      </div>
    </form>
  );
}
