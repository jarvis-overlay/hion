'use client';

import { useRef, useTransition } from 'react';
import { addSourcingPost } from '@/app/dashboard/sourcing/list/actions';

export default function SourcingForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await addSourcingPost(fd);
          formRef.current?.reset();
        })
      }
      className="card p-5 mb-6 grid gap-3"
    >
      <input
        name="title"
        placeholder="상품명 / 후보 이름"
        required
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          name="source_url"
          placeholder="소싱 링크 (1688, 알리바바 등)"
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        />
        <input
          name="price"
          type="number"
          step="0.01"
          placeholder="단가 (참고용)"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
      </div>
      <input
        name="moq"
        placeholder="최소주문수량 (MOQ)"
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <textarea
        name="notes"
        placeholder="메모 (품질, 배송, 협상 상황 등)"
        rows={2}
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '등록 중...' : '소싱 후보 등록'}
      </button>
    </form>
  );
}
