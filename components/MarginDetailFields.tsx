'use client';

import type { useMarginFields } from '@/lib/useMarginFields';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

type Fields = ReturnType<typeof useMarginFields>;

// 등록/수정/옵션추가 폼 세 군데서 똑같이 쓰는 "마진 상세 항목" 블록.
// 순서: 매입부가세 - 수수료(%) - 배송비 - 광고비(%) - 쿠폰 할인(정률/정액) -
// 기타비용. 매출부가세는 상단(판매가 옆)에서 따로 보여주므로 여기 없음.
// 쿠팡수수료/광고비는 비율(기본 8.6%/10%, 조절 가능) 입력으로 자동
// 계산해서 hidden input으로 제출하고, 쿠폰 할인은 정률/정액을 골라서
// 입력하면 그 결과 금액을 hidden input으로 제출한다.
export function MarginDetailFields({ fields, compact = false }: { fields: Fields; compact?: boolean }) {
  const inputCls = compact
    ? 'border border-paperLine bg-white px-2 py-1.5 text-xs font-mono'
    : 'border border-paperLine bg-white px-3 py-2 text-sm font-mono';
  const selectCls = compact
    ? 'border border-paperLine bg-white px-1.5 py-1.5 text-xs'
    : 'border border-paperLine bg-white px-2 py-2 text-sm';
  const suffixCls = compact ? 'text-[11px] text-inkSoft' : 'text-xs text-inkSoft';
  const hasPrice = fields.price !== '';

  return (
    <>
      <input type="hidden" name="coupang_fee" value={hasPrice ? fields.coupangFee : ''} />
      <input type="hidden" name="ad_cost" value={hasPrice ? fields.adCost : ''} />
      <input type="hidden" name="coupon" value={hasPrice ? fields.couponAmount : ''} />
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-${compact ? '2' : '3'}`}>
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
          <span className={suffixCls}>% 수수료</span>
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
        <div className="flex items-center gap-1">
          <input
            value={fields.adRatePct}
            onChange={(e) => fields.setAdRatePct(e.target.value)}
            type="number"
            step="0.1"
            placeholder="10"
            className={inputCls + ' flex-1 min-w-0'}
          />
          <span className={suffixCls}>% 광고비</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={fields.couponMode}
            onChange={(e) => fields.setCouponMode(e.target.value as 'amount' | 'percent')}
            className={selectCls}
          >
            <option value="amount">정액</option>
            <option value="percent">정률</option>
          </select>
          <input
            value={fields.couponValue}
            onChange={(e) => fields.setCouponValue(e.target.value)}
            type="number"
            step="0.01"
            placeholder={fields.couponMode === 'percent' ? '할인율' : '할인액 (선택)'}
            className={inputCls + ' flex-1 min-w-0'}
          />
          <span className={suffixCls}>{fields.couponMode === 'percent' ? '%' : '원'}</span>
        </div>
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
        <p className={suffixCls}>
          자동 계산 - 쿠팡수수료 {fmt(fields.coupangFee)} (판매가의 {fields.feeRatePct || 0}%) · 광고비{' '}
          {fmt(fields.adCost)} (판매가의 {fields.adRatePct || 0}%)
          {fields.couponAmount > 0 && ` · 쿠폰 할인 ${fmt(fields.couponAmount)}`}
        </p>
      )}
    </>
  );
}
