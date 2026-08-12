'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  deleteProduct,
  updateCouponDiscount,
  updateShippingCost,
  updateManualCost,
  updateMarginInputs,
  updateReturnGrade,
} from '@/app/dashboard/inventory/products/actions';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ko-KR');
const GRADE_OPTIONS = ['최상', '상', '중', '하', '미개봉'];

export default function ProductCard({
  product,
  vendorItemIds = [],
  isReturnGrade = false,
}: {
  product: any;
  vendorItemIds?: string[];
  isReturnGrade?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [editingGrade, setEditingGrade] = useState(false);
  const [returnGrade, setReturnGrade] = useState(product.return_grade || '최상');

  function saveGrade() {
    startTransition(async () => {
      await updateReturnGrade(product.id, returnGrade);
      setEditingGrade(false);
    });
  }
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [discount, setDiscount] = useState(String(product.coupon_discount || 0));
  const [editingShipping, setEditingShipping] = useState(false);
  const [shipping, setShipping] = useState(String(product.shipping_cost || 0));
  const [editingCost, setEditingCost] = useState(false);
  const [manualCost, setManualCost] = useState(
    product.manual_cost != null ? String(product.manual_cost) : ''
  );
  const [editingMargin, setEditingMargin] = useState(false);
  const [salePrice, setSalePrice] = useState(
    product.sale_price != null ? String(product.sale_price) : ''
  );
  const [feeRate, setFeeRate] = useState(String(product.fee_rate ?? 10.8));

  function saveDiscount() {
    startTransition(async () => {
      await updateCouponDiscount(product.id, Number(discount) || 0);
      setEditingDiscount(false);
    });
  }

  function saveShipping() {
    startTransition(async () => {
      await updateShippingCost(product.id, Number(shipping) || 0);
      setEditingShipping(false);
    });
  }

  function saveManualCost() {
    startTransition(async () => {
      const trimmed = manualCost.trim();
      await updateManualCost(product.id, trimmed === '' ? null : Number(trimmed));
      setEditingCost(false);
    });
  }

  function saveMargin() {
    startTransition(async () => {
      const trimmed = salePrice.trim();
      await updateMarginInputs(
        product.id,
        trimmed === '' ? null : Number(trimmed),
        Number(feeRate) || 0
      );
      setEditingMargin(false);
    });
  }

  // 마진 계산기(components/MarginCalculator.tsx)와 동일한 공식.
  // 판매가는 쿠폰 할인이 이미 적용된 실제 판매가를 넣는 걸 전제로 한다.
  const margin = useMemo(() => {
    const p = product.sale_price != null ? Number(product.sale_price) : 0;
    const c = product.manual_cost != null ? Number(product.manual_cost) : 0;
    const fr = Number(product.fee_rate ?? 10.8);
    const s = Number(product.shipping_cost || 0);
    const fee = p * (fr / 100);
    const outputVat = p * 0.1;
    const importVat = c * 0.1;
    const profit = p - outputVat - c + importVat - fee - s;
    const marginPct = p > 0 ? (profit / p) * 100 : 0;
    return { p, c, fr, s, fee, outputVat, importVat, profit, marginPct };
  }, [product.sale_price, product.manual_cost, product.fee_rate, product.shipping_cost]);

  const marginTone =
    margin.p <= 0
      ? 'text-inkSoft'
      : margin.marginPct < 0
      ? 'text-red-700'
      : margin.marginPct < 15
      ? 'text-warn'
      : 'text-profit';

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

      {isReturnGrade && (
        <div className="pt-2 border-t border-paperLine">
          {!editingGrade ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-inkSoft">
                반품등급 (쿠팡 전용):{' '}
                <span className="font-mono text-ink">
                  {product.return_grade || '미입력'}
                </span>
              </span>
              <button
                onClick={() => setEditingGrade(true)}
                className="text-xs text-inkSoft hover:text-ink underline"
              >
                수정
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={returnGrade}
                onChange={(e) => setReturnGrade(e.target.value)}
                list="grade-options"
                placeholder="등급"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
              />
              <datalist id="grade-options">
                {GRADE_OPTIONS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <button
                onClick={saveGrade}
                disabled={isPending}
                className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                저장
              </button>
            </div>
          )}
        </div>
      )}

      <div className="pt-2 border-t border-paperLine">
        <span className="text-xs text-inkSoft">
          쿠팡 옵션ID:{' '}
          {vendorItemIds.length > 0 ? (
            <span className="font-mono text-ink">
              {vendorItemIds.join(', ')}
            </span>
          ) : (
            <span className="text-warn">
              미매핑 (카탈로그 동기화가 아직 안 찾았거나 대상이 아님)
            </span>
          )}
        </span>
      </div>

      <div className="pt-2 border-t border-paperLine">
        {!editingDiscount ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-inkSoft">
              쿠폰 할인액 (정상 재고 판매에만 적용):{' '}
              <span className="font-mono text-ink">{fmt(product.coupon_discount || 0)}원</span>
            </span>
            <button
              onClick={() => setEditingDiscount(true)}
              className="text-xs text-inkSoft hover:text-ink underline"
            >
              수정
            </button>
          </div>
        ) : (
          <div>
            <label className="text-xs text-inkSoft">
              쿠폰 할인액 입력 (원, 정상 재고 판매에만 적용됨)
            </label>
            <div className="flex gap-2 mt-1">
              <input
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                type="number"
                placeholder="0"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono flex-1"
              />
              <button
                onClick={saveDiscount}
                disabled={isPending}
                className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-paperLine">
        {!editingShipping ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-inkSoft">
              건당 배송비:{' '}
              <span className="font-mono text-ink">{fmt(product.shipping_cost || 0)}원</span>
            </span>
            <button
              onClick={() => setEditingShipping(true)}
              className="text-xs text-inkSoft hover:text-ink underline"
            >
              수정
            </button>
          </div>
        ) : (
          <div>
            <label className="text-xs text-inkSoft">건당 배송비 입력 (원)</label>
            <div className="flex gap-2 mt-1">
              <input
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
                type="number"
                placeholder="0"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono flex-1"
              />
              <button
                onClick={saveShipping}
                disabled={isPending}
                className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-paperLine">
        {!editingCost ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-inkSoft">
              직접 입력 원가 (발주기록 없을 때 사용):{' '}
              <span className="font-mono text-ink">
                {product.manual_cost != null ? `${fmt(product.manual_cost)}원` : '미입력'}
              </span>
            </span>
            <button
              onClick={() => setEditingCost(true)}
              className="text-xs text-inkSoft hover:text-ink underline"
            >
              수정
            </button>
          </div>
        ) : (
          <div>
            <label className="text-xs text-inkSoft">
              원가 직접 입력 (원, 비우면 발주 기록 평균으로 계산)
            </label>
            <div className="flex gap-2 mt-1">
              <input
                value={manualCost}
                onChange={(e) => setManualCost(e.target.value)}
                type="number"
                placeholder="비우면 발주기록 사용"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono flex-1"
              />
              <button
                onClick={saveManualCost}
                disabled={isPending}
                className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-paperLine">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-inkSoft">마진 계산</span>
          <button
            onClick={() => setEditingMargin((v) => !v)}
            className="text-xs text-inkSoft hover:text-ink underline"
          >
            {editingMargin ? '닫기' : '판매가·수수료율 수정'}
          </button>
        </div>

        {editingMargin && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="text-xs text-inkSoft">판매가 (쿠폰 적용 후)</label>
              <input
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                type="number"
                placeholder="0"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono w-full mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-inkSoft">쿠팡수수료율 (%)</label>
              <input
                value={feeRate}
                onChange={(e) => setFeeRate(e.target.value)}
                type="number"
                step="0.1"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono w-full mt-1"
              />
            </div>
            <button
              onClick={saveMargin}
              disabled={isPending}
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50 col-span-2"
            >
              저장
            </button>
          </div>
        )}

        {margin.p > 0 ? (
          <div className="text-xs grid gap-1 mt-2">
            <MarginLine label="판매가" value={fmt(margin.p)} />
            <MarginLine label="매출부가세" value={'-' + fmt(margin.outputVat)} />
            <MarginLine label="매입가" value={'-' + fmt(margin.c)} />
            <MarginLine label="매입부가세" value={'+' + fmt(margin.importVat)} />
            <MarginLine label="쿠팡수수료" value={'-' + fmt(margin.fee)} />
            <MarginLine label="배송비" value={'-' + fmt(margin.s)} />
            <div className="flex justify-between pt-1 mt-1 border-t border-paperLine font-bold">
              <span>총마진</span>
              <span className={marginTone}>
                {fmt(margin.profit)}원 ({fmt1(margin.marginPct)}%)
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-inkSoft mt-2">
            판매가를 입력하면 마진이 계산돼요.
          </p>
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

function MarginLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-inkSoft">
      <span>{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}
