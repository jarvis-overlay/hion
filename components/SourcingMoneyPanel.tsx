'use client';

import { useState, useTransition } from 'react';
import { updateSourcingMargin } from '@/app/dashboard/sourcing/list/actions';
import { useMarginFields } from '@/lib/useMarginFields';
import FxCalculator from '@/components/FxCalculator';
import { MarginDetailFields } from '@/components/MarginDetailFields';
import type { ShippingCalcState } from '@/components/ShippingCostCalculator';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

// 소싱 카드의 "마진·배송" 탭: 상품 "수정"을 열지 않고 금액 정보(판매가·원가·수수료·배송비·해외배송비)만 따로 입력·저장한다.
export default function SourcingMoneyPanel({ item, onDone }: { item: any; onDone?: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const f = useMarginFields({
    price: item.price,
    cost: item.cost,
    coupon: item.coupon,
    importVat: item.import_vat,
    // 저장돼 있던 수수료/광고비 금액에서 비율을 되살린다 (판매가가 있어야 가능, 없으면 기본 8.6%/10%)
    feeRatePct:
      item.price && item.coupang_fee != null
        ? Number(((item.coupang_fee / (item.price - (item.coupon || 0))) * 100).toFixed(2))
        : null,
    adRatePct:
      item.price && item.ad_cost != null
        ? Number(((item.ad_cost / (item.price - (item.coupon || 0))) * 100).toFixed(2))
        : null,
    shipping: item.shipping,
    intlShipping: item.intl_shipping,
    etcCost: item.etc_cost,
  });
  const intlShippingCalcInitial: ShippingCalcState | null = item.intl_shipping_calc || null;

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          setSaved(false);
          const res = await updateSourcingMargin(item.id, fd);
          if (!res || 'error' in res) {
            setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
            return;
          }
          setSaved(true);
          onDone?.();
        })
      }
      className="rounded-md ring-1 ring-paperLine p-3 grid gap-3"
    >
      <span className="text-xs font-semibold text-inkSoft">마진·배송 (금액 정보)</span>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">판매가 (원)</span>
          <input
            name="price"
            value={f.price}
            onChange={(e) => f.setPrice(e.target.value)}
            type="number"
            step="0.01"
            placeholder="0"
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">매출부가세 (자동)</span>
          <input
            readOnly
            name="output_vat"
            value={f.price !== '' ? Math.round(f.outputVat) : ''}
            placeholder="판매가 ÷ 11"
            title="판매가 / 11로 자동 계산돼요"
            className="border border-paperLine bg-paper text-inkSoft px-3 py-2 text-sm font-mono cursor-not-allowed"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">매입 원가 (원)</span>
          <input
            name="cost"
            value={f.cost}
            onChange={(e) => f.setCost(e.target.value)}
            type="number"
            step="0.01"
            placeholder="0"
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
        </label>
      </div>

      <FxCalculator
        onApply={(krw) => f.setCost(String(Math.round(krw)))}
        initial={{ currency: item.cost_fx_currency, amount: item.cost_fx_amount, rate: item.cost_fx_rate }}
      />

      <MarginDetailFields fields={f} intlShippingCalcInitial={intlShippingCalcInitial} feeCategoryInitial={item.fee_category} />

      {f.price && (
        <div className="rounded-md bg-paper px-3 py-2 text-sm grid gap-1">
          <div className="flex items-center justify-between">
            <span className="text-inkSoft">예상 마진 (광고비 적용)</span>
            <span className={`font-mono font-semibold ${f.margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
              {(f.margin.profit < 0 ? '-' : '') + fmt(Math.abs(f.margin.profit))}
              {f.margin.marginPct != null && ` (${f.margin.marginPct.toFixed(1)}%)`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-inkSoft text-xs">예상 마진 (광고비 미적용)</span>
            <span className="font-mono text-xs text-inkSoft">
              {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
              {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">저장 실패: {error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={isPending} className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50">
          {isPending ? '저장 중...' : '금액 정보 저장'}
        </button>
        {saved && !isPending && <span className="text-xs text-profit">저장했어요</span>}
      </div>
    </form>
  );
}
