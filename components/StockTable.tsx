'use client';

import { useState } from 'react';

export default function StockTable({
  products,
  stockRows,
}: {
  products: any[];
  stockRows: any[];
}) {
  const [hideOutOfStock, setHideOutOfStock] = useState(true);

  const stockByProduct: Record<string, { coupang: number; own: number }> = {};
  for (const p of products) {
    stockByProduct[p.id] = { coupang: 0, own: 0 };
  }
  for (const row of stockRows) {
    if (!stockByProduct[row.product_id]) {
      stockByProduct[row.product_id] = { coupang: 0, own: 0 };
    }
    if (row.warehouse === 'coupang') {
      stockByProduct[row.product_id].coupang = row.quantity;
    } else if (row.warehouse === 'own') {
      stockByProduct[row.product_id].own = row.quantity;
    }
  }

  const visibleProducts = products.filter((p) => {
    if (!hideOutOfStock) return true;
    const s = stockByProduct[p.id] || { coupang: 0, own: 0 };
    return s.coupang + s.own !== 0;
  });
  const hiddenCount = products.length - visibleProducts.length;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-paperLine">
        <label className="flex items-center gap-2 text-xs text-inkSoft cursor-pointer">
          <input
            type="checkbox"
            checked={hideOutOfStock}
            onChange={(e) => setHideOutOfStock(e.target.checked)}
          />
          품절(재고 0) 상품 숨기기
        </label>
        {hiddenCount > 0 && (
          <span className="text-xs text-inkSoft">{hiddenCount}개 숨김</span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-xs text-inkSoft uppercase tracking-wide">
            <th className="text-left py-2 px-4">상품</th>
            <th className="text-right py-2 px-4">쿠팡 창고</th>
            <th className="text-right py-2 px-4">자사 물류창고</th>
            <th className="text-right py-2 px-4">합계</th>
          </tr>
        </thead>
        <tbody>
          {visibleProducts.map((p) => {
            const s = stockByProduct[p.id] || { coupang: 0, own: 0 };
            const total = s.coupang + s.own;
            return (
              <tr key={p.id} className="border-b border-paperLine last:border-0">
                <td className="py-2 px-4 font-medium">{p.name}</td>
                <td
                  className={`py-2 px-4 text-right font-mono ${
                    s.coupang < 0 ? 'text-red-700' : ''
                  }`}
                >
                  {s.coupang}
                </td>
                <td
                  className={`py-2 px-4 text-right font-mono ${
                    s.own < 0 ? 'text-red-700' : ''
                  }`}
                >
                  {s.own}
                </td>
                <td className="py-2 px-4 text-right font-mono font-bold">
                  {total}
                </td>
              </tr>
            );
          })}
          {!visibleProducts.length && (
            <tr>
              <td colSpan={4} className="py-4 px-4 text-center text-inkSoft">
                {products.length
                  ? '표시할 상품이 없어요 (품절 상품 숨김 처리됨).'
                  : '등록된 상품이 없어요.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
