'use client';

import { useRef, useTransition } from 'react';
import { addSourcingNote } from '@/app/dashboard/sourcing/info/actions';

export default function InfoForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await addSourcingNote(fd);
          formRef.current?.reset();
        })
      }
      className="card p-5 mb-6 grid gap-3"
    >
      <input
        name="title"
        placeholder="제목 (예: 공급업체 협상 팁, 관세 관련 정보 등)"
        required
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <input
        name="link"
        placeholder="참고 링크 (선택)"
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <textarea
        name="content"
        placeholder="내용"
        rows={3}
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '등록 중...' : '정보 등록'}
      </button>
    </form>
  );
}
