'use client';

import { useState, useTransition } from 'react';
import { addMarginEntry, deleteMarginEntry } from '@/app/dashboard/margin/actions';
import { useMarginFields } from '@/lib/useMarginFields';
import FxCalculator from '@/components/FxCalculator';
import { MarginDetailFields } from '@/components/MarginDetailFields';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

function badgeClass(pct: number) {
  if (pct < 0) return 'bg-red-100 text-red-700';
  if (pct < 15) return 'bg-warnBg text-warn';
  return 'bg-profitBg text-profit';
}

// 소싱 리스트(EditForm)와 완전히 같은 입력 구성·계산식을 쓴다 - 둘 다
// useMarginFields(동일 훅) -> lib/marginCalc.ts의 computeMargin으로
// 계산한다. 소싱 리스트는 상품 레코드에 값을 저장하지만, 이 페이지는
// "이름 붙여서 따로 저장"(margin_entries)하는 독립 계산기라는 점만
// 다르다.
export default function MarginCalculator({ entries }: { entries: any[] }) {
  const [name, setName] = useState('');
  const f = useMarginFields();
  const [isPending, startTransition] = useTransition();

  const stampTone =
    f.margin.marginPct == null
      ? 'border-paperLine text-inkSoft'
      : f.margin.marginPct < 0
      ? 'border-red-600 text-red-600'
      : f.margin.marginPct < 15
      ? 'border-warn text-warn'
      : 'border-profit text-profit';

  const costNum = parseFloat(f.cost) || 0;
  const importVatNum = parseFloat(f.importVat) || 0;
  const shippingNum = parseFloat(f.shipping) || 0;
  const intlShippingNum = parseFloat(f.intlShipping) || 0;
  const etcCostNum = parseFloat(f.etcCost) || 0;

  function handleSave() {
    startTransition(async () => {
      await addMarginEntry({
        name,
        price: f.margin.actualPrice,
        cost: costNum,
        output_vat: f.outputVat,
        import_vat: importVatNum,
        coupang_fee: f.coupangFee,
        shipping: shippingNum,
        intl_shipping: intlShippingNum,
        coupon: f.couponAmount,
        ad_cost: f.adCost,
        etc_cost: etcCostNum,
        profit: f.margin.profit,
        margin_pct: f.margin.marginPct ?? 0,
      });
      setName('');
      f.reset();
    });
  }

  return (
    <div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-inkSoft mb-4">
            입력
          </h2>
          <div className="grid gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="상품명"
              className="border border-paperLine bg-white px-3 py-2 text-sm"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                value={f.price}
                onChange={(e) => f.setPrice(e.target.value)}
                type="number"
                step="0.01"
                placeholder="판매가"
                className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
              />
              <input
                readOnly
                value={f.price !== '' ? Math.round(f.outputVat) : ''}
                placeholder="매출부가세 (자동)"
                title="판매가 / 11로 자동 계산돼요"
                className="border border-paperLine bg-paper text-inkSoft px-3 py-2 text-sm font-mono cursor-not-allowed"
              />
            </div>
            <input
              value={f.cost}
              onChange={(e) => f.setCost(e.target.value)}
              type="number"
              step="0.01"
              placeholder="매입 원가"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />

            <FxCalculator onApply={(krw) => f.setCost(String(Math.round(krw)))} />

            <MarginDetailFields fields={f} />
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-inkSoft mb-4">
            결과
          </h2>
          <div className="flex justify-center mb-4">
            <div
              className={`w-28 h-28 rounded-full border-[3px] flex flex-col items-center justify-center -rotate-6 ${stampTone}`}
            >
              <span className="font-mono font-bold text-xl">
                {f.margin.marginPct != null ? `${f.margin.marginPct.toFixed(1)}%` : '-'}
              </span>
              <span className="text-[10px] uppercase tracking-wide mt-1">
                마진율
              </span>
            </div>
          </div>

          <div className="text-sm grid gap-1.5">
            {f.couponAmount > 0 && (
              <>
                <Line label="판매가" value={fmt(parseFloat(f.price) || 0)} />
                <Line label="쿠폰 할인" value={'-' + fmt(f.couponAmount)} />
              </>
            )}
            <Line label="실제 판매가" value={fmt(f.margin.actualPrice)} />
            <Line label="매출부가세" value={'-' + fmt(f.outputVat)} />
            <Line label="매입가" value={'-' + fmt(costNum)} />
            <Line label="매입부가세" value={'+' + fmt(importVatNum)} />
            <Line label="쿠팡수수료" value={'-' + fmt(f.coupangFee)} />
            <Line label="배송비 (국내)" value={'-' + fmt(shippingNum)} />
            {intlShippingNum > 0 && <Line label="해외배송비" value={'-' + fmt(intlShippingNum)} />}
            {f.adCost > 0 && <Line label="광고비" value={'-' + fmt(f.adCost)} />}
            {etcCostNum > 0 && <Line label="기타" value={'-' + fmt(etcCostNum)} />}
            <div className="flex justify-between pt-2 mt-1 border-t-2 border-ink font-bold">
              <span>예상 마진 (광고비 적용)</span>
              <span className={f.margin.profit < 0 ? 'text-red-700' : 'text-profit'}>
                {(f.margin.profit < 0 ? '-' : '') + fmt(Math.abs(f.margin.profit))}
              </span>
            </div>
            <div className="flex justify-between text-xs text-inkSoft">
              <span>예상 마진 (광고비 미적용)</span>
              <span>
                {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
                {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
              </span>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={isPending || !name.trim() || f.margin.actualPrice <= 0}
            className="btn-primary w-full py-2.5 text-sm font-semibold mt-5 disabled:opacity-40"
          >
            {isPending ? '저장 중...' : '이 계산 저장하기'}
          </button>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-lg font-bold">저장된 계산</h2>
          <span className="text-xs text-inkSoft">{entries.length}건</span>
        </div>
        <div className="grid gap-2">
          {entries.length ? (
            entries.map((e) => (
              <div
                key={e.id}
                className="card px-4 py-3 flex items-center gap-3 text-sm"
              >
                <span className="flex-1 font-medium truncate">{e.name}</span>
                <span className="font-mono text-xs text-inkSoft hidden sm:inline">
                  {fmt(e.price)}
                </span>
                <span
                  className={`font-mono text-xs ${
                    e.profit < 0 ? 'text-red-700' : 'text-profit'
                  }`}
                >
                  {(e.profit < 0 ? '-' : '') + fmt(Math.abs(e.profit))}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-mono ${badgeClass(
                    e.margin_pct
                  )}`}
                >
                  {Number(e.margin_pct).toFixed(1)}%
                </span>
                <button
                  onClick={() => startTransition(() => deleteMarginEntry(e.id))}
                  className="text-inkSoft hover:text-red-700 text-xs"
                >
                  삭제
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-inkSoft">
              아직 저장된 계산이 없어요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-inkSoft">
      <span>{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}
