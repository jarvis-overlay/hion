'use client';

import FxCalculator from '@/components/FxCalculator';
import { FieldLegend, FieldTag } from '@/components/FieldTag';
import { MarginDetailFields } from '@/components/MarginDetailFields';
import type { ShippingCalcState } from '@/components/ShippingCostCalculator';
import type { useMarginFields } from '@/lib/useMarginFields';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

// 마진 입력 폼 본체 (판매가·매출부가세·매입원가·환율 계산·마진 상세 입력·예상 마진 박스).
// "제품 마진 정보" 탭(SourcingMoneyPanel)과 발주 회차 폼(SourcingOrderForm)이 같이 쓴다.
// 저장 버튼·<form>은 바깥에서 감싼다. quantity/onQuantityChange는 회차 폼처럼 수량을 바깥에서 관리할 때만 넘긴다.
export default function MarginFormBody({
  f,
  item,
  quantity,
  onQuantityChange,
}: {
  f: ReturnType<typeof useMarginFields>;
  item: any; // cost_fx_*, intl_shipping_calc, fee_category 초기값을 읽는다
  quantity?: string;
  onQuantityChange?: (v: string) => void;
}) {
  const intlShippingCalcInitial: ShippingCalcState | null = item.intl_shipping_calc || null;
  return (
    <>
      <FieldLegend />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-3xl">
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">판매가 (원)<FieldTag kind="required" /></span>
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
          <span className="text-[10px] font-semibold text-inkSoft">매출부가세<FieldTag kind="auto" /></span>
          <input
            readOnly
            name="output_vat"
            value={f.price !== '' ? Math.round(f.outputVat) : ''}
            placeholder="판매가 ÷ 11"
            title="판매가 / 11로 자동 계산돼요"
            className="border border-paperLine bg-profitBg text-inkSoft px-3 py-2 text-sm font-mono cursor-not-allowed"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[10px] font-semibold text-inkSoft">매입 원가 (원)<FieldTag kind="required" /></span>
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

      <div className="max-w-3xl">
        <FxCalculator
          onApply={(krw) => f.setCost(String(Math.round(krw)))}
          initial={{ currency: item.cost_fx_currency, amount: item.cost_fx_amount, rate: item.cost_fx_rate }}
        />
      </div>

      {/* 카드 폭이 좁아서(목록 폭 제한) ① 마진 계산과 ② 해외배송은 위아래로 쌓는다 */}
      <div className="grid gap-3 items-start">
        <MarginDetailFields
          fields={f}
          intlShippingCalcInitial={intlShippingCalcInitial}
          feeCategoryInitial={item.fee_category}
          quantity={quantity}
          onQuantityChange={onQuantityChange}
        />
      </div>

      {f.price && (
        <div className="rounded-md bg-paper px-3 py-2 text-sm grid gap-1 max-w-3xl">
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
    </>
  );
}
