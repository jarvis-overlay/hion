'use client';

import { useRef, useTransition } from 'react';
import { addProduct } from '@/app/dashboard/inventory/products/actions';

export default function ProductForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await addProduct(fd);
          formRef.current?.reset();
        })
      }
      className="card p-5 mb-6 grid gap-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <input
          name="name"
          placeholder="상품명"
          required
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        />
        <input
          name="sku"
          placeholder="SKU / 내부 코드 (선택)"
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        />
      </div>
      <input
        name="china_link"
        placeholder="중국 소싱 링크 (선택)"
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <textarea
        name="notes"
        placeholder="메모"
        rows={2}
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '등록 중...' : '상품 등록'}
      </button>
    </form>
  );
}
