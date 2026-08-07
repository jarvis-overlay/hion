'use client';

import { useState, useTransition } from 'react';
import { testCoupangApi } from '@/app/dashboard/api-test/actions';

const ENDPOINTS: {
  key: string;
  label: string;
  fields: { key: string; label: string; placeholder?: string }[];
}[] = [
  {
    key: 'productList',
    label: '상품 목록 조회',
    fields: [{ key: 'nextToken', label: 'nextToken (선택)' }],
  },
  {
    key: 'productDetail',
    label: '상품 상세 조회',
    fields: [{ key: 'sellerProductId', label: 'sellerProductId' }],
  },
  {
    key: 'inventory',
    label: '재고 조회',
    fields: [{ key: 'vendorItemId', label: 'vendorItemId (옵션ID)' }],
  },
  {
    key: 'orderList',
    label: '주문 목록 조회 (rg/orders)',
    fields: [
      { key: 'paidDateFrom', label: 'paidDateFrom', placeholder: '20260806' },
      { key: 'paidDateTo', label: 'paidDateTo', placeholder: '20260807' },
      { key: 'nextToken', label: 'nextToken (선택)' },
    ],
  },
  {
    key: 'orderById',
    label: '주문 단건 조회 (orderId)',
    fields: [{ key: 'orderId', label: 'orderId' }],
  },
  {
    key: 'returnList',
    label: '반품/취소 목록 조회',
    fields: [
      {
        key: 'createdAtFrom',
        label: 'createdAtFrom',
        placeholder: '2026-08-01T00:00',
      },
      {
        key: 'createdAtTo',
        label: 'createdAtTo',
        placeholder: '2026-08-07T23:59',
      },
      { key: 'nextToken', label: 'nextToken (선택)' },
    ],
  },
];

export default function ApiTestForm() {
  const [endpointKey, setEndpointKey] = useState(ENDPOINTS[0].key);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const endpoint = ENDPOINTS.find((e) => e.key === endpointKey)!;

  function handleEndpointChange(key: string) {
    setEndpointKey(key);
    setValues({});
    setResult(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await testCoupangApi(endpointKey, values);
      setResult(JSON.stringify(res, null, 2));
    });
  }

  return (
    <div className="card p-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-medium text-inkSoft mb-1">
            API 종류
          </label>
          <select
            value={endpointKey}
            onChange={(e) => handleEndpointChange(e.target.value)}
            className="border border-paperLine bg-white px-3 py-2 text-sm w-full rounded-lg"
          >
            {ENDPOINTS.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </select>
        </div>

        {endpoint.fields.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {endpoint.fields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-inkSoft mb-1">
                  {f.label}
                </label>
                <input
                  type="text"
                  value={values[f.key] || ''}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                  className="border border-paperLine bg-white px-3 py-2 text-sm w-full rounded-lg"
                />
              </div>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50 self-start"
        >
          {isPending ? '조회 중...' : '조회하기'}
        </button>
      </form>

      {result && (
        <div className="mt-5">
          <div className="text-xs font-medium text-inkSoft mb-1">
            원본 응답
          </div>
          <pre className="bg-paper/60 border border-paperLine rounded-lg p-3 text-xs overflow-auto max-h-[600px] whitespace-pre-wrap break-all">
            {result}
          </pre>
        </div>
      )}
    </div>
  );
}
