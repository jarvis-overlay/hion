'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  deleteProduct,
  updateProductName,
  updateCouponDiscount,
  updateShippingCost,
  updateManualCost,
  updateMarginInputs,
  updateReturnGrade,
  splitVendorItemToNewProduct,
} from '@/app/dashboard/inventory/products/actions';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ko-KR');
const GRADE_OPTIONS = ['최상', '상', '중', '하', '미개봉'];

export default function ProductCard({
  product,
  vendorItemIds = [],
  isReturnGrade = false,
  stock,
}: {
  product: any;
  vendorItemIds?: string[];
  isReturnGrade?: boolean;
  stock?: { coupang: number; own: number };
}) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(product.name);

  function saveName() {
    startTransition(async () => {
      await updateProductName(product.id, name);
      setEditingName(false);
    });
  }

  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [splitName, setSplitName] = useState('');
  const [splitMessage, setSplitMessage] = useState<string | null>(null);

  function saveSplit() {
    if (!splittingId) return;
    startTransition(async () => {
      const result = await splitVendorItemToNewProduct(splittingId, splitName);
      if (result.error) {
        setSplitMessage(`⚠️ ${result.error}`);
      } else {
        setSplitMessage(
          `✅ "${splitName}"(으)로 분리 완료 (과거 기록 ${result.movedMovements}건 이동됨)`
        );
        setSplittingId(null);
        setSplitName('');
      }
    });
  }

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
        {!editingName ? (
          <h3
            className="font-semibold text-sm cursor-pointer hover:underline"
            onClick={() => setEditingName(true)}
            title="클릭해서 상품명 수정"
          >
            {product.name}
          </h3>
        ) : (
          <div className="flex gap-2 flex-1">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="border border-paperLine bg-white px-2 py-1 text-sm font-semibold flex-1"
            />
            <button
              onClick={saveName}
              disabled={isPending}
              className="btn-primary px-2 py-1 text-xs disabled:opacity-50"
            >
              저장
            </button>
            <button
              onClick={() => {
                setName(product.name);
                setEditingName(false);
              }}
              className="text-xs text-inkSoft px-1"
            >
              취소
            </button>
          </div>
        )}
        {product.sku && (
          <span className="text-xs font-mono bg-paperLine px-2 py-0.5 rounded-full whitespace-nowrap">
            {product.sku}
          </span>
        )}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between gap-3 text-left"
      >
        <span className="text-xs text-inkSoft flex gap-3">
          <span>
            쿠팡 재고{' '}
            <span className="font-mono font-semibold text-ink">
              {stock?.coupang ?? 0}
            </span>
          </span>
          <span>
            자사 재고{' '}
            <span className="font-mono font-semibold text-ink">
              {stock?.own ?? 0}
            </span>
          </span>
        </span>
        <span className="text-xs text-inkSoft underline">
          {expanded ? '접기 ▲' : '자세히 ▼'}
        </span>
      </button>

      {expanded && (
        <>
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
        <div className="text-xs text-inkSoft mb-1">쿠팡 옵션ID</div>
        {vendorItemIds.length > 0 ? (
          <div className="flex flex-col gap-1">
            {vendorItemIds.map((vid) => (
              <div key={vid} className="flex items-center gap-2">
                <span className="font-mono text-ink text-xs">{vid}</span>
                {vendorItemIds.length > 1 && (
                  <button
                    onClick={() => {
                      setSplittingId(vid);
                      setSplitName('');
                      setSplitMessage(null);
                    }}
                    className="text-xs text-inkSoft hover:text-ink underline"
                  >
                    별도 상품으로 분리
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-xs text-warn">
            미매핑 (카탈로그 동기화가 아직 안 찾았거나 대상이 아님)
          </span>
        )}

        {splittingId && (
          <div className="mt-2 p-2 border border-paperLine rounded-lg">
            <p className="text-xs text-inkSoft mb-1">
              옵션ID {splittingId}를 새 상품으로 분리 (과거 판매 기록도 같이
              옮겨져요)
            </p>
            <div className="flex gap-2">
              <input
                value={splitName}
                onChange={(e) => setSplitName(e.target.value)}
                placeholder="새 상품명 (예: 베이비커넥트 핑크)"
                className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
              />
              <button
                onClick={saveSplit}
                disabled={isPending || !splitName.trim()}
                className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              >
                분리
              </button>
              <button
                onClick={() => setSplittingId(null)}
                className="text-xs text-inkSoft px-1"
              >
                취소
              </button>
            </div>
          </div>
        )}
        {splitMessage && (
          <p className="text-xs mt-2 text-inkSoft">{splitMessage}</p>
        )}
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
        </>
      )}
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
