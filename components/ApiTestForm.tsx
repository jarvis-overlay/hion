'use client';

import { useState, useTransition } from 'react';
import { testCoupangApi } from '@/app/dashboard/api-test/actions';

type Field = {
  key: string;
  label: string;
  placeholder?: string;
  // 'date'면 yyyymmdd로, 'datetime'이면 yyyy-MM-ddTHH:mm으로 자동 변환해서
  // 전송한다 - 날짜 형식을 직접 타이핑 안 해도 되게.
  inputType?: 'text' | 'date' | 'datetime';
};

const ENDPOINTS: {
  key: string;
  label: string;
  fields: Field[];
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
      { key: 'paidDateFrom', label: 'paidDateFrom', inputType: 'date' },
      { key: 'paidDateTo', label: 'paidDateTo', inputType: 'date' },
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
      { key: 'createdAtFrom', label: 'createdAtFrom', inputType: 'datetime' },
      { key: 'createdAtTo', label: 'createdAtTo', inputType: 'datetime' },
      { key: 'nextToken', label: 'nextToken (선택)' },
    ],
  },
  {
    key: 'custom',
    label: '직접 입력 (커스텀 URL)',
    fields: [
      { key: 'method', label: 'HTTP 메서드 (기본 GET)', placeholder: 'GET' },
      {
        key: 'url',
        label:
          'path + query (쿠팡 문서의 {vendorId}는 자동 치환됨, ? 뒤에 쿼리스트링까지 한 번에)',
        placeholder:
          '/v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests?searchType=timeFrame&createdAtFrom=2026-08-06T00:00&createdAtTo=2026-08-07T23:59',
      },
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

  function handleClear() {
    setValues({});
    setResult(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      // 커스텀 URL은 path+query를 한 필드에 같이 입력받아서, 예전 endpoint의
      // 남은 query string이 엉뚱하게 같이 전송되는 걸 막는다.
      let sendValues: Record<string, string> = values;
      if (endpointKey === 'custom') {
        const [path, query = ''] = (values.url || '').split('?');
        sendValues = { method: values.method || '', path, query };
      } else {
        // 날짜 선택기(date input)는 "2026-08-06" 형태로 값을 주는데, 쿠팡
        // API는 필드마다 형식이 달라서(yyyymmdd vs yyyy-MM-ddTHH:mm) 여기서
        // 맞춰서 변환한다. datetime-local은 이미 원하는 형식 그대로라 손 안 댐.
        sendValues = { ...values };
        for (const f of endpoint.fields) {
          if (f.inputType === 'date' && sendValues[f.key]) {
            sendValues[f.key] = sendValues[f.key].replace(/-/g, '');
          }
        }
      }
      const res = await testCoupangApi(endpointKey, sendValues);
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
                  type={
                    f.inputType === 'date'
                      ? 'date'
                      : f.inputType === 'datetime'
                      ? 'datetime-local'
                      : 'text'
                  }
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

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {isPending ? '조회 중...' : '조회하기'}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-paperLine hover:bg-paper/60"
          >
            초기화
          </button>
        </div>
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
