'use client';

import { useTransition } from 'react';
import { deleteProduct } from '@/app/dashboard/inventory/products/actions';

export default function ProductCard({ product }: { product: any }) {
  const [isPending, startTransition] = useTransition();

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
      <div className="flex justify-end mt-1 pt-2 border-t border-paperLine">
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
