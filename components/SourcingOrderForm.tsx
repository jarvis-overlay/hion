'use client';

import { useState, useTransition, type MutableRefObject } from 'react';
import { addSourcingOrder, updateSourcingOrder, deleteSourcingOrder } from '@/app/dashboard/sourcing/list/orderActions';
import { useMarginFields } from '@/lib/useMarginFields';
import { marginInitFromRow } from '@/lib/marginRow';
import MarginFormBody from '@/components/MarginFormBody';

// 발주 회차 하나를 입력/수정하는 폼. 새 회차(order 없음)는 prefill 값(직전 회차 또는 카드 기본 마진 정보)으로 시작한다.
// 수량은 이 폼의 qty state 하나만 쓰고, 해외배송 계산기의 수량 입력창도 같은 값을 쓴다(제어 모드).
export default function SourcingOrderForm({
  itemId,
  order,
  newId,
  prefill,
  dirtyRef,
  onClose,
}: {
  itemId: string;
  order?: any; // 수정할 회차 (없으면 새 회차)
  newId?: string; // 새 회차용 uuid (저장 요청이 두 번 가도 한 번만 들어가게 하는 멱등 키)
  prefill?: { source: 'prev' | 'item'; values: Record<string, any>; fromRound: number | null };
  dirtyRef?: MutableRefObject<boolean>; // 입력이 바뀌면 true로 표시 (다른 폼으로 바꿀 때 확인창용)
  onClose: () => void;
}) {
  const isNew = !order;
  const base: any = order ?? prefill?.values ?? {};
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [orderedAt, setOrderedAt] = useState<string>(order?.ordered_at ?? '');
  const [note, setNote] = useState<string>(order?.note ?? '');
  const [qty, setQty] = useState<string>(() => {
    if (order?.quantity != null) return String(order.quantity);
    if (order) {
      const q = parseInt(order.intl_shipping_calc?.quantity);
      return q > 0 ? String(q) : '';
    }
    return '';
  });
  const [copiedShown, setCopiedShown] = useState(isNew);
  const f = useMarginFields(marginInitFromRow(base));

  function submit(fd: FormData) {
    setError(null);
    const hasCalc = String(fd.get('intl_shipping_calc') ?? '') !== '';
    if (hasCalc && String(fd.get('quantity') ?? '').trim() === '') {
      if (!window.confirm('수량 없이 저장하면 해외배송비·총 마진이 비어요. 그대로 저장할까요?')) return;
    }
    startTransition(async () => {
      try {
        const res = isNew ? await addSourcingOrder(itemId, fd) : await updateSourcingOrder(order.id, fd);
        if (!res || 'error' in res) {
          setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
          return;
        }
        onClose();
      } catch {
        setError('저장 중 오류가 났어요. 네트워크를 확인하고 다시 시도해주세요.');
      }
    });
  }

  function remove() {
    if (!order) return;
    if (!window.confirm(`${order.round_no}차 발주 기록을 삭제할까요?`)) return;
    startTransition(async () => {
      try {
        const res = await deleteSourcingOrder(order.id);
        if (!res || 'error' in res) {
          setError(res?.error ?? '삭제하지 못했어요. 다시 시도해주세요.');
          return;
        }
        onClose();
      } catch {
        setError('삭제 중 오류가 났어요. 네트워크를 확인하고 다시 시도해주세요.');
      }
    });
  }

  const inputCls = 'border border-paperLine bg-white px-3 py-2 text-sm font-mono';
  return (
    <form action={submit} onChange={() => { if (dirtyRef) dirtyRef.current = true; }} className="grid gap-3 border border-paperLine rounded-md p-3 bg-[#FAFAFB]">
      {isNew && newId && <input type="hidden" name="id" value={newId} />}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-ink">{isNew ? '새 발주 (회차는 저장 시 자동)' : `${order.round_no}차 발주 수정`}</span>
        {isNew && copiedShown && (
          <span className="text-[10px] font-semibold bg-warnBg text-warn px-1.5 py-0.5 rounded">복사됨</span>
        )}
      </div>
      {isNew && copiedShown && prefill && (
        <p className="text-[11px] text-inkSoft bg-warnBg px-3 py-2 max-w-3xl">
          {prefill.source === 'prev' ? `${prefill.fromRound}차 발주` : '기본 마진 정보'}에서 복사했어요. 수량·발주일을 확인하세요. 부가서비스의 전체금액 항목(통관료 등)과 해외배송비를 수량에 맞게 확인하세요.{' '}
          <button type="button" onClick={() => setCopiedShown(false)} className="underline">
            알겠어요
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">발주일</span>
          <input name="ordered_at" type="date" value={orderedAt} onChange={(e) => setOrderedAt(e.target.value)} className={inputCls} />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">수량 (개)</span>
          <input
            name="quantity"
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="예: 500"
            className={inputCls}
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">메모 (500자까지)</span>
          <input
            name="note"
            type="text"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 포장 변경"
            className={inputCls}
          />
        </label>
      </div>

      <MarginFormBody f={f} item={base} quantity={qty} onQuantityChange={setQty} />

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={isPending} className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50">
          {isPending ? '저장 중...' : isNew ? '발주 저장' : '수정 저장'}
        </button>
        <button type="button" onClick={onClose} disabled={isPending} className="px-3 py-2 text-xs border border-paperLine text-inkSoft hover:text-ink">
          취소
        </button>
        {!isNew && (
          <button type="button" onClick={remove} disabled={isPending} className="ml-auto px-3 py-2 text-xs text-red-700 hover:underline">
            삭제
          </button>
        )}
      </div>
    </form>
  );
}
