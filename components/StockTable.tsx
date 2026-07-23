'use client';

import { useState } from 'react';
import { toggleProductVisibility } from '@/app/dashboard/inventory/stock/actions';

export default function StockTable({
  products,
  stockRows,
}: {
  products: any[]; // id, name, is_hidden
  stockRows: any[];
}) {
  const [hideOutOfStock, setHideOutOfStock] = useState(true);
  const [showHidden, setShowHidden] = useState(false);

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
    if (!showHidden && p.is_hidden) return false;
    if (!hideOutOfStock) return true;
    const s = stockByProduct[p.id] || { coupang: 0, own: 0 };
    return s.coupang + s.own !== 0;
  });
  const hiddenCount = products.length - visibleProducts.length;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-paperLine flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-inkSoft cursor-pointer">
            <input
              type="checkbox"
              checked={hideOutOfStock}
              onChange={(e) => setHideOutOfStock(e.target.checked)}
            />
            품절(재고 0) 상품 숨기기
          </label>
          <label className="flex items-center gap-2 text-xs text-inkSoft cursor-pointer">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            숨긴 상품도 보기
          </label>
        </div>
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
            <th className="text-right py-2 px-4">관리</th>
          </tr>
        </thead>
        <tbody>
          {visibleProducts.map((p) => {
            const s = stockByProduct[p.id] || { coupang: 0, own: 0 };
            const total = s.coupang + s.own;
            return (
              <tr
                key={p.id}
                className={`border-b border-paperLine last:border-0 ${p.is_hidden ? 'opacity-50' : ''}`}
              >
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
                <td className="py-2 px-4 text-right font-mono font-bold">{total}</td>
                <td className="py-2 px-4 text-right">
                  <button
                    onClick={() => toggleProductVisibility(p.id, !p.is_hidden)}
                    className="text-xs underline text-inkSoft hover:text-ink"
                  >
                    {p.is_hidden ? '다시 보이기' : '숨기기'}
                  </button>
                </td>
              </tr>
            );
          })}
          {!visibleProducts.length && (
            <tr>
              <td colSpan={5} className="py-4 px-4 text-center text-inkSoft">
                {products.length
                  ? '표시할 상품이 없어요.'
                  : '등록된 상품이 없어요.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
