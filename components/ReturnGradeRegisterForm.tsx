'use client';

import { useState, useTransition } from 'react';
import { registerReturnGradeProduct } from '@/app/dashboard/inventory/products/actions';

export default function ReturnGradeRegisterForm() {
  const [sellerProductId, setSellerProductId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await registerReturnGradeProduct(sellerProductId);
      if (result.error) {
        setMessage(`⚠️ ${result.error}`);
      } else {
        setMessage(`✅ "${result.productName}" 옵션 ${result.mapped}개 반품등급으로 등록됐어요.`);
        setSellerProductId('');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 mb-6">
      <h3 className="text-sm font-semibold mb-1">반품등급 상품 수동 등록</h3>
      <p className="text-xs text-inkSoft mb-3">
        쿠팡 카탈로그 자동 스캔은 반품등급(회수품) 상품을 못 찾아요. 쿠팡
        판매자센터 재고관리 화면에서 "반품-상/중/최상" 태그가 붙은 상품의
        sellerProductId(옵션ID 옆 숫자)를 여기 넣어서 직접 등록해주세요.
      </p>
      <div className="flex gap-2">
        <input
          value={sellerProductId}
          onChange={(e) => setSellerProductId(e.target.value)}
          placeholder="sellerProductId (예: 16264575752)"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono flex-1"
        />
        <button
          type="submit"
          disabled={isPending || !sellerProductId.trim()}
          className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {isPending ? '등록 중...' : '등록'}
        </button>
      </div>
      {message && <p className="text-xs mt-2 text-inkSoft">{message}</p>}
    </form>
  );
}
