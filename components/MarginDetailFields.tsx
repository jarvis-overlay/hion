'use client';

import type { useMarginFields } from '@/lib/useMarginFields';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

type Fields = ReturnType<typeof useMarginFields>;

// 등록/수정/옵션추가 폼 세 군데서 똑같이 쓰는 "마진 상세 항목" 블록.
// 매출부가세는 항상 판매가/11로 자동 계산, 쿠팡수수료는 비율(기본
// 8.6%, 조절 가능) 입력으로 자동 계산해서 hidden input으로 제출한다.
export function MarginDetailFields({ fields, compact = false }: { fields: Fields; compact?: boolean }) {
  const inputCls = compact
    ? 'border border-paperLine bg-white px-2 py-1.5 text-xs font-mono'
    : 'border border-paperLine bg-white px-3 py-2 text-sm font-mono';
  const hasPrice = fields.price !== '';

  return (
    <>
      <input type="hidden" name="output_vat" value={hasPrice ? fields.outputVat : ''} />
      <input type="hidden" name="coupang_fee" value={hasPrice ? fields.coupangFee : ''} />
      <div className={`grid grid-cols-2 sm:grid-cols-4 gap-${compact ? '2' : '3'}`}>
        <input
          name="coupon"
          value={fields.coupon}
          onChange={(e) => fields.setCoupon(e.target.value)}
          type="number"
          step="0.01"
          placeholder="쿠폰 할인액 (선택)"
          className={inputCls}
        />
        <input
          name="import_vat"
          value={fields.importVat}
          onChange={(e) => fields.setImportVat(e.target.value)}
          type="number"
          step="0.01"
          placeholder="매입부가세"
          className={inputCls}
        />
        <div className="flex items-center gap-1">
          <input
            value={fields.feeRatePct}
            onChange={(e) => fields.setFeeRatePct(e.target.value)}
            type="number"
            step="0.1"
            placeholder="8.6"
            className={inputCls + ' flex-1 min-w-0'}
          />
          <span className={compact ? 'text-[11px] text-inkSoft' : 'text-xs text-inkSoft'}>% 수수료</span>
        </div>
        <input
          name="shipping"
          value={fields.shipping}
          onChange={(e) => fields.setShipping(e.target.value)}
          type="number"
          step="0.01"
          placeholder="배송비"
          className={inputCls}
        />
        <input
          name="ad_cost"
          value={fields.adCost}
          onChange={(e) => fields.setAdCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="광고비 (선택)"
          className={inputCls}
        />
        <input
          name="etc_cost"
          value={fields.etcCost}
          onChange={(e) => fields.setEtcCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="기타 비용"
          className={inputCls}
        />
      </div>
      {hasPrice && (
        <p className={compact ? 'text-[11px] text-inkSoft' : 'text-xs text-inkSoft'}>
          자동 계산 - 매출부가세 {fmt(fields.outputVat)} · 쿠팡수수료 {fmt(fields.coupangFee)} (판매가의{' '}
          {fields.feeRatePct || 0}%)
        </p>
      )}
    </>
  );
}
