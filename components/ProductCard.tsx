'use client';

import { useState, useTransition } from 'react';
import {
  deleteProduct,
  updateCoupangMapping,
} from '@/app/dashboard/inventory/products/actions';

export default function ProductCard({ product }: { product: any }) {
  const [isPending, startTransition] = useTransition();
  const [editingMapping, setEditingMapping] = useState(false);
  const [vendorItemId, setVendorItemId] = useState(
    product.coupang_vendor_item_id || ''
  );

  function saveMapping() {
    startTransition(async () => {
      await updateCoupangMapping(product.id, vendorItemId);
      setEditingMapping(false);
    });
  }

  return (
    <div className="card p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-sm">{product.name}</h3>
        {product.sku && (
          <span className="text-xs font-mono bg-paperLine px-2 py-0.5 rounded-full whitespace-nowrap">
            {product.sku}
          </span>
        )}
      </div>
      {product.china_link && (
        <a
          href={product.china_link}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-profit underline break-all"
        >
          {product.china_link}
        </a>
      )}
      {product.notes && <p className="text-xs text-ink">{product.notes}</p>}

      <div className="pt-2 border-t border-paperLine">
        {!editingMapping ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-inkSoft">
              쿠팡 옵션ID:{' '}
              {product.coupang_vendor_item_id ? (
                <span className="font-mono text-ink">
                  {product.coupang_vendor_item_id}
                </span>
              ) : (
                <span className="text-warn">미등록</span>
              )}
            </span>
            <button
              onClick={() => setEditingMapping(true)}
              className="text-xs text-inkSoft hover:text-ink underline"
            >
              {product.coupang_vendor_item_id ? '수정' : '등록'}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={vendorItemId}
              onChange={(e) => setVendorItemId(e.target.value)}
              placeholder="쿠팡 옵션ID (vendorItemId)"
              className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono flex-1"
            />
            <button
              onClick={saveMapping}
              disabled={isPending}
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
            >
              저장
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-1">
        <button
          onClick={() => startTransition(() => deleteProduct(product.id))}
          disabled={isPending}
          className="text-xs text-inkSoft hover:text-red-700"
        >
          삭제
        </button>
      </div>
    </div>
  );
}
