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

const num = (s: string) => parseFloat(s) || 0;

// 소싱 리스트(등록/수정 폼)와 완전히 같은 입력·계산을 쓴다 - useMarginFields
// 훅과 MarginDetailFields를 그대로 가져다 쓰기 때문에 판매가 → 매출부가세
// (자동, 판매가/11) → 매입원가(위안/달러 환산 포함) → 쿠폰 할인(정액/정률)
// → 매입부가세 → 쿠팡수수료율 → 국내 배송비 → 광고비율 → 기타비용 →
// 해외배송비(CBM 계산기)까지 소싱 리스트에서 계산한 마진과 같은 값이 나온다.
export default function MarginCalculator({ entries }: { entries: any[] }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const f = useMarginFields();

  const hasPrice = f.price !== '';
  const { margin } = f;
  const profit = margin.profit;
  const marginPct = margin.marginPct ?? 0;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await addMarginEntry({
        name,
        price: margin.actualPrice,
        coupon: f.couponAmount,
        cost: num(f.cost),
        output_vat: f.outputVat,
        import_vat: num(f.importVat),
        coupang_fee: f.coupangFee,
        shipping: num(f.shipping),
        intl_shipping: num(f.intlShipping),
        ad_cost: f.adCost,
        etc_cost: num(f.etcCost),
        profit,
        margin_pct: marginPct,
      });
      if (res && 'error' in res) {
        setError(res.error);
        return;
      }
      setName('');
      f.reset();
    });
  }

  const stampTone =
    marginPct < 0
      ? 'border-red-600 text-red-600'
      : marginPct < 15
      ? 'border-warn text-warn'
      : 'border-profit text-profit';

  const inputCls = 'border border-paperLine bg-white px-3 py-2 text-sm font-mono';

  return (
    <div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-inkSoft mb-4">입력</h2>
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
                className={inputCls}
              />
              <input
                readOnly
                value={hasPrice ? Math.round(f.outputVat) : ''}
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
              placeholder="매입 원가 (중국에서 가져온 개당 원가, 부가세 제외)"
              className={inputCls}
            />
            <FxCalculator onApply={(krw) => f.setCost(String(Math.round(krw)))} />

            <MarginDetailFields fields={f} />
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-inkSoft mb-4">결과</h2>
          <div className="flex justify-center mb-4">
            <div
              className={`w-28 h-28 rounded-full border-[3px] flex flex-col items-center justify-center -rotate-6 ${stampTone}`}
            >
              <span className="font-mono font-bold text-xl">{marginPct.toFixed(1)}%</span>
              <span className="text-[10px] uppercase tracking-wide mt-1">마진율</span>
            </div>
          </div>

          <div className="text-sm grid gap-1.5">
            {f.couponAmount > 0 && (
              <>
                <Line label="판매가" value={fmt(num(f.price))} />
                <Line label="쿠폰 할인" value={'-' + fmt(f.couponAmount)} />
              </>
            )}
            <Line label="실제 판매가" value={fmt(margin.actualPrice)} />
            <Line label="매출부가세" value={'-' + fmt(hasPrice ? f.outputVat : 0)} />
            <Line label="매입가" value={'-' + fmt(num(f.cost))} />
            <Line label="매입부가세" value={'+' + fmt(num(f.importVat))} />
            <Line label={`쿠팡수수료 (${f.feeRatePct || 0}%)`} value={'-' + fmt(hasPrice ? f.coupangFee : 0)} />
            <Line label="배송비 (쿠팡 국내)" value={'-' + fmt(num(f.shipping))} />
            <Line label="해외배송비 (CBM)" value={'-' + fmt(num(f.intlShipping))} />
            <Line label={`광고비 (${f.adRatePct || 0}%)`} value={'-' + fmt(hasPrice ? f.adCost : 0)} />
            {num(f.etcCost) > 0 && <Line label="기타" value={'-' + fmt(num(f.etcCost))} />}
            <div className="flex justify-between pt-2 mt-1 border-t-2 border-ink font-bold">
              <span>총마진 (광고비 적용)</span>
              <span className={profit < 0 ? 'text-red-700' : 'text-profit'}>
                {(profit < 0 ? '-' : '') + fmt(Math.abs(profit))}
              </span>
            </div>
            <div className="flex justify-between text-xs text-inkSoft">
              <span>광고비 미적용 마진</span>
              <span className="font-mono">
                {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
                {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
              </span>
            </div>
          </div>

          {error && (
            <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2 mt-4">저장 실패: {error}</p>
          )}
          <button
            onClick={handleSave}
            disabled={isPending || !name.trim() || margin.actualPrice <= 0}
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
              <div key={e.id} className="card px-4 py-3 flex items-center gap-3 text-sm">
                <span className="flex-1 font-medium truncate">{e.name}</span>
                <span className="font-mono text-xs text-inkSoft hidden sm:inline">{fmt(e.price)}</span>
                <span className={`font-mono text-xs ${e.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
                  {(e.profit < 0 ? '-' : '') + fmt(Math.abs(e.profit))}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${badgeClass(e.margin_pct)}`}>
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
            <p className="text-sm text-inkSoft">아직 저장된 계산이 없어요.</p>
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
