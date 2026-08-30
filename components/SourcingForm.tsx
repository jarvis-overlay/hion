'use client';

import { useMemo, useRef, useState } from 'react';
import { useTransition } from 'react';
import { addSourcingItem } from '@/app/dashboard/sourcing/list/actions';
import { computeMargin } from '@/lib/marginCalc';
import FxCalculator from '@/components/FxCalculator';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

function num(v: string): number | null {
  if (v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export default function SourcingForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [showMarginDetail, setShowMarginDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [coupon, setCoupon] = useState('');
  const [outputVat, setOutputVat] = useState('');
  const [importVat, setImportVat] = useState('');
  const [coupangFee, setCoupangFee] = useState('');
  const [shipping, setShipping] = useState('');
  const [adCost, setAdCost] = useState('');
  const [etcCost, setEtcCost] = useState('');

  const margin = useMemo(
    () =>
      computeMargin({
        price: num(price),
        coupon: num(coupon),
        cost: num(cost),
        outputVat: num(outputVat),
        importVat: num(importVat),
        coupangFee: num(coupangFee),
        shipping: num(shipping),
        adCost: num(adCost),
        etcCost: num(etcCost),
      }),
    [price, cost, coupon, outputVat, importVat, coupangFee, shipping, adCost, etcCost]
  );

  function resetAll() {
    formRef.current?.reset();
    setPrice('');
    setCost('');
    setCoupon('');
    setOutputVat('');
    setImportVat('');
    setCoupangFee('');
    setShipping('');
    setAdCost('');
    setEtcCost('');
  }

  return (
    <div className="card p-5 mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-sm font-semibold"
      >
        <span>소싱 후보 등록</span>
        <span className={`text-inkSoft transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && (
        <form
          ref={formRef}
          action={(fd) =>
            startTransition(async () => {
              setError(null);
              const res = await addSourcingItem(fd);
              if ('error' in res) {
                setError(res.error);
                return;
              }
              resetAll();
              setOpen(false);
              setShowMarginDetail(false);
            })
          }
          className="grid gap-3 mt-4"
        >
          <input
            name="title"
            placeholder="상품명 / 후보 이름"
            required
            className="border border-paperLine bg-white px-3 py-2 text-sm"
          />
          <input
            name="link"
            placeholder="소싱 링크 (1688, 알리바바 등)"
            className="border border-paperLine bg-white px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-3 gap-3">
            <input
              name="price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              step="0.01"
              placeholder="판매가"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <input
              name="cost"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              type="number"
              step="0.01"
              placeholder="매입 원가"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <input
              name="moq"
              placeholder="MOQ"
              className="border border-paperLine bg-white px-3 py-2 text-sm"
            />
          </div>

          <FxCalculator onApply={(krw) => setCost(String(Math.round(krw)))} />

          <button
            type="button"
            onClick={() => setShowMarginDetail((v) => !v)}
            className="text-left text-xs font-semibold text-inkSoft hover:text-ink flex items-center gap-1"
          >
            <span className={`transition-transform ${showMarginDetail ? 'rotate-90' : ''}`}>▸</span>
            마진 상세 항목 (쿠폰, 부가세, 수수료, 배송비, 광고비 등)
          </button>
          {showMarginDetail && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <input
                name="coupon"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                type="number"
                step="0.01"
                placeholder="쿠폰 할인액 (선택)"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                name="output_vat"
                value={outputVat}
                onChange={(e) => setOutputVat(e.target.value)}
                type="number"
                step="0.01"
                placeholder="매출부가세"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                name="import_vat"
                value={importVat}
                onChange={(e) => setImportVat(e.target.value)}
                type="number"
                step="0.01"
                placeholder="매입부가세"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                name="coupang_fee"
                value={coupangFee}
                onChange={(e) => setCoupangFee(e.target.value)}
                type="number"
                step="0.01"
                placeholder="쿠팡수수료"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                name="shipping"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
                type="number"
                step="0.01"
                placeholder="배송비"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                name="ad_cost"
                value={adCost}
                onChange={(e) => setAdCost(e.target.value)}
                type="number"
                step="0.01"
                placeholder="광고비 (선택)"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                name="etc_cost"
                value={etcCost}
                onChange={(e) => setEtcCost(e.target.value)}
                type="number"
                step="0.01"
                placeholder="기타 비용"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
            </div>
          )}

          {price && (
            <div className="flex items-center justify-between rounded-md bg-paper px-3 py-2 text-sm">
              <span className="text-inkSoft">예상 마진</span>
              <span className={`font-mono font-semibold ${margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
                {(margin.profit < 0 ? '-' : '') + fmt(Math.abs(margin.profit))}
                {margin.marginPct != null && ` (${margin.marginPct.toFixed(1)}%)`}
              </span>
            </div>
          )}

          <textarea
            name="content"
            placeholder="메모 (품질, 배송, 협상 상황 등)"
            rows={2}
            className="border border-paperLine bg-white px-3 py-2 text-sm"
          />
          {error && (
            <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">
              등록 실패: {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {isPending ? '등록 중...' : '소싱 후보 등록'}
          </button>
        </form>
      )}
    </div>
  );
}
