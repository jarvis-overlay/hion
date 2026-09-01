'use client';

import { useMemo, useState } from 'react';
import { computeMargin } from '@/lib/marginCalc';

// 마진 계산 폼 필드를 한 곳에서 관리하는 훅 - 등록/수정/옵션추가 폼
// 세 군데서 똑같은 로직을 쓴다. 요청받은 공식대로:
//   판매가 - 매출부가세(판매가/11, 항상 자동) - 매입가(직접입력)
//   + 매입부가세(직접입력) - 쿠팡수수료(비율 입력, 기본 8.6%, 자동 계산)
//   - 배송비(직접입력) - 광고비(비율 입력, 기본 10%, 자동 계산)
//   - 쿠폰 할인(정률/정액 선택) - 기타비용 = 총마진
// 매출부가세/쿠팡수수료/광고비/쿠폰할인은 직접 KRW 금액을 입력받지 않고
// 계산된 값을 hidden input으로 제출한다 (쿠폰만 정액으로 저장된 과거
// 데이터도 있어서 정액 모드 기본값으로 그대로 불러와진다).
export type CouponMode = 'amount' | 'percent';

export interface MarginFieldsInit {
  price?: number | null;
  cost?: number | null;
  coupon?: number | null; // 저장된 쿠폰 할인 "금액"(KRW) - 정액 모드 기본값
  importVat?: number | null;
  feeRatePct?: number | null;
  adRatePct?: number | null;
  shipping?: number | null;
  etcCost?: number | null;
}

function toStr(n: number | null | undefined): string {
  return n != null ? String(n) : '';
}

export function useMarginFields(init: MarginFieldsInit = {}) {
  const [price, setPrice] = useState(toStr(init.price));
  const [cost, setCost] = useState(toStr(init.cost));
  const [couponMode, setCouponMode] = useState<CouponMode>('amount');
  const [couponValue, setCouponValue] = useState(toStr(init.coupon));
  const [importVat, setImportVat] = useState(toStr(init.importVat));
  const [feeRatePct, setFeeRatePct] = useState(
    init.feeRatePct != null ? String(init.feeRatePct) : '8.6'
  );
  const [adRatePct, setAdRatePct] = useState(
    init.adRatePct != null ? String(init.adRatePct) : '10'
  );
  const [shipping, setShipping] = useState(toStr(init.shipping));
  const [etcCost, setEtcCost] = useState(toStr(init.etcCost));

  const priceNum = parseFloat(price) || 0;
  const couponValueNum = parseFloat(couponValue) || 0;
  const couponAmount =
    couponMode === 'percent' ? priceNum * (couponValueNum / 100) : couponValueNum;
  const actualPrice = Math.max(0, priceNum - couponAmount);
  // 매출부가세는 항상 실제 판매가 / 11 (부가세 10% 포함가 기준 역산)
  const outputVat = actualPrice / 11;
  const feeRateNum = parseFloat(feeRatePct) || 0;
  const coupangFee = actualPrice * (feeRateNum / 100);
  const adRateNum = parseFloat(adRatePct) || 0;
  const adCost = actualPrice * (adRateNum / 100);

  const margin = useMemo(
    () =>
      computeMargin({
        price: price === '' ? null : priceNum,
        coupon: price === '' ? null : couponAmount,
        cost: cost === '' ? null : parseFloat(cost) || 0,
        outputVat: price === '' ? null : outputVat,
        importVat: importVat === '' ? null : parseFloat(importVat) || 0,
        coupangFee: price === '' ? null : coupangFee,
        shipping: shipping === '' ? null : parseFloat(shipping) || 0,
        adCost: price === '' ? null : adCost,
        etcCost: etcCost === '' ? null : parseFloat(etcCost) || 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [price, couponMode, couponValue, cost, importVat, shipping, etcCost, feeRatePct, adRatePct]
  );

  // 최종 마진 옆에 "광고비를 뺀 순수 마진"도 참고용으로 같이 보여준다
  const pureProfit = margin.profit + (price === '' ? 0 : adCost);
  const pureMarginPct = margin.actualPrice > 0 ? (pureProfit / margin.actualPrice) * 100 : null;

  function reset() {
    setPrice('');
    setCost('');
    setCouponMode('amount');
    setCouponValue('');
    setImportVat('');
    setFeeRatePct('8.6');
    setAdRatePct('10');
    setShipping('');
    setEtcCost('');
  }

  return {
    price,
    setPrice,
    cost,
    setCost,
    couponMode,
    setCouponMode,
    couponValue,
    setCouponValue,
    couponAmount,
    importVat,
    setImportVat,
    feeRatePct,
    setFeeRatePct,
    adRatePct,
    setAdRatePct,
    shipping,
    setShipping,
    etcCost,
    setEtcCost,
    outputVat,
    coupangFee,
    adCost,
    margin,
    pureProfit,
    pureMarginPct,
    reset,
  };
}
