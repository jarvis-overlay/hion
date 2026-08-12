'use client';

import { useState, useTransition } from 'react';
import {
  registerReturnGradeProduct,
  discoverUnmappedVendorItems,
} from '@/app/dashboard/inventory/products/actions';

const GRADE_OPTIONS = ['최상', '상', '중', '하'];

export default function ReturnGradeRegisterForm() {
  const [sellerProductId, setSellerProductId] = useState('');
  const [returnGrade, setReturnGrade] = useState('최상');
  const [message, setMessage] = useState<string | null>(null);
  const [discoverMessage, setDiscoverMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDiscovering, startDiscovering] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await registerReturnGradeProduct(sellerProductId, returnGrade);
      if (result.error) {
        setMessage(`⚠️ ${result.error}`);
      } else {
        setMessage(`✅ "${result.productName}" 옵션 ${result.mapped}개 반품등급(${returnGrade})으로 등록됐어요.`);
        setSellerProductId('');
      }
    });
  }

  function handleDiscover() {
    setDiscoverMessage(null);
    startDiscovering(async () => {
      const result = await discoverUnmappedVendorItems();
      if (result.error) {
        setDiscoverMessage(`⚠️ ${result.error}`);
      } else {
        setDiscoverMessage(
          `✅ 전체 ${result.totalFound}개 옵션ID 중 매핑 안 된 재고있는 옵션 ${result.unmappedFound}개 발견, ${result.registered}개 임시 등록했어요. 아래 "반품 재판매 상품" 목록에서 상품명·등급을 채워주세요.`
        );
      }
    });
  }

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold mb-1">반품등급 상품 찾기/등록</h3>
          <p className="text-xs text-inkSoft">
            쿠팡 카탈로그 자동 스캔은 반품등급(회수품) 상품을 못 찾아요. 아래
            버튼으로 매핑 안 된 옵션ID를 한 번에 찾아 임시 등록하거나,
            sellerProductId를 알면 직접 등록해주세요.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDiscover}
          disabled={isDiscovering}
          className="btn-primary px-3 py-2 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
        >
          {isDiscovering ? '찾는 중...' : '미매핑 옵션ID 자동 찾기'}
        </button>
      </div>
      {discoverMessage && (
        <p className="text-xs mb-3 text-inkSoft">{discoverMessage}</p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 pt-3 border-t border-paperLine">
        <input
          value={sellerProductId}
          onChange={(e) => setSellerProductId(e.target.value)}
          placeholder="sellerProductId (예: 16264575752)"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono flex-1"
        />
        <select
          value={returnGrade}
          onChange={(e) => setReturnGrade(e.target.value)}
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        >
          {GRADE_OPTIONS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isPending || !sellerProductId.trim()}
          className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {isPending ? '등록 중...' : '등록'}
        </button>
      </form>
      {message && <p className="text-xs mt-2 text-inkSoft">{message}</p>}
    </div>
  );
}
