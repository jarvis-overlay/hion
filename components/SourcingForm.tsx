'use client';

import { useMemo, useRef, useState } from 'react';
import { useTransition } from 'react';
import { addSourcingItem } from '@/app/dashboard/sourcing/list/actions';
import { computeMargin } from '@/lib/marginCalc';

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

  // 환율로 매입가 계산 - 1688/알리바바는 위안/달러로 가격이 나오니,
  // 현지 금액과 환율을 넣으면 원화로 환산해서 매입 원가 칸에 채워준다.
  const [showFxCalc, setShowFxCalc] = useState(false);
  const [fxCurrency, setFxCurrency] = useState<'CNY' | 'USD'>('CNY');
  const [fxAmount, setFxAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const fxResult = (parseFloat(fxAmount) || 0) * (parseFloat(fxRate) || 0);

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
    setFxAmount('');
    setFxRate('');
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
              setShowFxCalc(false);
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

          <button
            type="button"
            onClick={() => setShowFxCalc((v) => !v)}
            className="text-left text-xs font-semibold text-inkSoft hover:text-ink flex items-center gap-1"
          >
            <span className={`transition-transform ${showFxCalc ? 'rotate-90' : ''}`}>▸</span>
            환율로 매입 원가 계산하기
          </button>
          {showFxCalc && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
              <select
                value={fxCurrency}
                onChange={(e) => setFxCurrency(e.target.value as 'CNY' | 'USD')}
                className="border border-paperLine bg-white px-2 py-2 text-sm"
              >
                <option value="CNY">위안 (CNY)</option>
                <option value="USD">달러 (USD)</option>
              </select>
              <input
                value={fxAmount}
                onChange={(e) => setFxAmount(e.target.value)}
                type="number"
                step="0.01"
                placeholder="현지 금액"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                type="number"
                step="0.01"
                placeholder="적용 환율 (예: 190)"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setCost(fxResult ? String(Math.round(fxResult)) : '')}
                disabled={!fxResult}
                className="btn-primary px-3 py-2 text-xs font-semibold disabled:opacity-40"
              >
                {fxResult ? `${fmt(fxResult)} 적용` : '금액/환율 입력'}
              </button>
            </div>
          )}

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
