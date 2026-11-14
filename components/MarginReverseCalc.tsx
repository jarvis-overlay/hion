'use client';

import { useMemo, useState, useTransition } from 'react';
import { computeMinPriceForTargetMargin } from '@/lib/marginCalc';
import { DEFAULT_FEE_RATE_PCT, DEFAULT_AD_RATE_PCT } from '@/lib/useMarginFields';
import { updateSourcingItem } from '@/app/dashboard/sourcing/list/actions';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

function toStr(n: number | null | undefined): string {
  return n != null ? String(n) : '';
}

// 비교 상품군(쿠팡) 가격대만 뽑아서 참고용으로 나란히 보여준다.
function coupangPriceRanges(comparisons: any[]): string[] {
  const out: string[] = [];
  for (const c of comparisons) {
    const prices: any[] = c.sourcing_comparison_prices || [];
    for (const p of prices) {
      if (p.platform === 'coupang' && p.price_range) out.push(p.price_range);
    }
  }
  return out;
}

// "목표 마진율을 맞추려면 최소 얼마에 팔아야 하나"를 즉시(서버 호출 없이)
// 계산해서 보여주는 역산 위젯 - ComparisonsSection 하단에 항시 표시.
// "이 가격 적용" 버튼은 이 위젯에서 바꾼 값 전부(원가 포함)를 그대로
// 소싱 항목에 저장한다(사용자 결정 - 역산해본 가정을 실제 데이터로 반영).
export default function MarginReverseCalc({ item, comparisons }: { item: any; comparisons: any[] }) {
  const [targetMarginPct, setTargetMarginPct] = useState('20');
  const [cost, setCost] = useState(toStr(item.cost));
  const [importVat, setImportVat] = useState(toStr(item.import_vat));
  const [shipping, setShipping] = useState(toStr(item.shipping));
  const [intlShipping, setIntlShipping] = useState(toStr(item.intl_shipping));
  const [etcCost, setEtcCost] = useState(toStr(item.etc_cost));
  const [feeRatePct, setFeeRatePct] = useState(String(DEFAULT_FEE_RATE_PCT));
  const [adRatePct, setAdRatePct] = useState(String(DEFAULT_AD_RATE_PCT));
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [isPending, startTransition] = useTransition();

  const result = useMemo(
    () =>
      computeMinPriceForTargetMargin({
        cost: parseFloat(cost) || 0,
        importVat: parseFloat(importVat) || 0,
        shipping: parseFloat(shipping) || 0,
        intlShipping: parseFloat(intlShipping) || 0,
        etcCost: parseFloat(etcCost) || 0,
        feeRatePct: parseFloat(feeRatePct) || 0,
        adRatePct: parseFloat(adRatePct) || 0,
        targetMarginPct: parseFloat(targetMarginPct) || 0,
      }),
    [cost, importVat, shipping, intlShipping, etcCost, feeRatePct, adRatePct, targetMarginPct]
  );

  const benchmarkRanges = coupangPriceRanges(comparisons);

  function handleApply() {
    if (!result.feasible || result.price == null) return;
    setApplyError(null);
    setApplied(false);

    // computeMinPriceForTargetMargin은 쿠폰을 반영하지 않고 역산한다 -
    // 계산된 price는 "쿠폰 할인 전 가격" 기준이다. 저장할 때 item의 기존
    // coupon(할인액)을 그대로 두면 computeMargin이 price-coupon을 다시
    // "실제 판매가"로 써서 쿠폰이 이중으로 반영되고(목표 마진율이 조용히
    // 틀어짐 - 실측: coupon=500일 때 목표 20%가 실제 1.47%가 됨), 그래서
    // 적용 시 coupon을 명시적으로 0으로 강제한다. 기존 쿠폰값을 지우는
    // 거라 화면에도 눈에 보이게 안내한다(아래 안내 문구).
    const price = result.price;
    const actualPrice = price; // coupon=0으로 저장하므로 실제 판매가 = price
    const outputVat = actualPrice / 11;
    const coupangFee = actualPrice * ((parseFloat(feeRatePct) || 0) / 100);
    const adCost = actualPrice * ((parseFloat(adRatePct) || 0) / 100);

    const fd = new FormData();
    // 이 위젯이 다루지 않는 필드는 소싱 항목의 현재 값을 그대로 채운다
    // (updateSourcingItem이 FormData 전체를 기대하는 기존 패턴).
    fd.set('title', item.title || '');
    fd.set('link', item.link || '');
    fd.set('content', item.content || '');
    fd.set('moq', item.moq || '');
    fd.set('coupon', '0');
    fd.set('cost_fx_currency', item.cost_fx_currency || '');
    fd.set('cost_fx_amount', toStr(item.cost_fx_amount));
    fd.set('cost_fx_rate', toStr(item.cost_fx_rate));
    if (item.intl_shipping_calc) fd.set('intl_shipping_calc', JSON.stringify(item.intl_shipping_calc));

    // 이 위젯이 다루는 값 그대로 저장.
    fd.set('price', String(price));
    fd.set('cost', cost);
    fd.set('import_vat', importVat);
    fd.set('shipping', shipping);
    fd.set('intl_shipping', intlShipping);
    fd.set('etc_cost', etcCost);
    fd.set('output_vat', String(outputVat));
    fd.set('coupang_fee', String(coupangFee));
    fd.set('ad_cost', String(adCost));

    startTransition(async () => {
      const res = await updateSourcingItem(item.id, fd);
      if (!res || 'error' in res) {
        setApplyError(res?.error ?? '적용에 실패했어요. 다시 시도해주세요.');
        return;
      }
      setApplied(true);
    });
  }

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3 mt-2">
      <p className="text-xs font-semibold text-inkSoft mb-2">마진 역산 (목표 마진율 → 최소 판매가)</p>
      <p className="text-[11px] text-warn bg-warnBg rounded-md px-2 py-1.5 mb-2">
        이 계산은 쿠폰 할인 전 가격 기준이에요. "이 가격 적용"을 누르면 소싱 항목의 쿠폰 할인액이 0으로
        저장돼요.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">목표 마진율(%)</span>
          <input
            value={targetMarginPct}
            onChange={(e) => setTargetMarginPct(e.target.value)}
            type="number"
            step="0.1"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">매입 원가</span>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            type="number"
            step="0.01"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">수입부가세</span>
          <input
            value={importVat}
            onChange={(e) => setImportVat(e.target.value)}
            type="number"
            step="0.01"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">배송비</span>
          <input
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
            type="number"
            step="0.01"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">해외배송비</span>
          <input
            value={intlShipping}
            onChange={(e) => setIntlShipping(e.target.value)}
            type="number"
            step="0.01"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">기타비용</span>
          <input
            value={etcCost}
            onChange={(e) => setEtcCost(e.target.value)}
            type="number"
            step="0.01"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">쿠팡수수료율(%)</span>
          <input
            value={feeRatePct}
            onChange={(e) => setFeeRatePct(e.target.value)}
            type="number"
            step="0.01"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <label className="grid gap-0.5">
          <span className="text-[11px] text-inkSoft">광고비율(%)</span>
          <input
            value={adRatePct}
            onChange={(e) => setAdRatePct(e.target.value)}
            type="number"
            step="0.01"
            className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
          />
        </label>
      </div>

      {(parseFloat(intlShipping) || 0) > 0 &&
        (parseFloat(cost) || 0) > 0 &&
        (parseFloat(intlShipping) || 0) > (parseFloat(cost) || 0) * 10 && (
          <p className="text-[11px] text-warn bg-warnBg rounded-md px-2 py-1.5 mb-2">
            해외배송비({fmt(parseFloat(intlShipping) || 0)})가 매입 원가({fmt(parseFloat(cost) || 0)})의 10배가 넘어요.
            이 칸은 <b>상품 1개당</b> 금액이에요. 전체 화물 운임을 넣었다면 배송비 계산기에서 수량(총 몇 개)을 입력한 뒤
            &quot;개당 금액&quot;을 채워주세요.
          </p>
        )}

      {result.feasible && result.price != null ? (
        <div className="rounded-md bg-paper px-3 py-2 text-sm mb-2 flex items-center justify-between">
          <span className="text-inkSoft">최소 판매가</span>
          <span className="font-mono font-semibold text-profit">{fmt(result.price)}</span>
        </div>
      ) : (
        <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2 mb-2">
          이 수수료/광고비 구조로는 {targetMarginPct || 0}% 마진은 어떤 가격으로도 달성할 수 없어요. 수수료율,
          광고비율 또는 목표 마진율을 낮춰보세요.
        </p>
      )}

      {benchmarkRanges.length > 0 && (
        <p className="text-[11px] text-inkSoft mb-2">
          비교 상품군 쿠팡 가격대(참고): {benchmarkRanges.join(' · ')}
        </p>
      )}

      {applyError && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1.5 mb-2">{applyError}</p>}
      {applied && <p className="text-[11px] text-profit mb-2">이 가격을 소싱 항목에 적용했어요.</p>}

      <button
        type="button"
        onClick={handleApply}
        disabled={isPending || !result.feasible}
        className="btn-primary py-1.5 text-xs font-semibold px-4 disabled:opacity-50"
      >
        {isPending ? '적용 중...' : '이 가격 적용'}
      </button>
    </div>
  );
}
