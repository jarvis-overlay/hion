'use client';

import { useMemo, useState } from 'react';
import { computeMargin } from '@/lib/marginCalc';

// 마진 계산 폼 필드를 한 곳에서 관리하는 훅 - 등록/수정/옵션추가 폼
// 세 군데서 똑같은 로직을 쓴다. 요청받은 공식대로:
//   판매가 - 매출부가세(판매가/11, 항상 자동) - 매입가(직접입력)
//   + 매입부가세(직접입력) - 쿠팡수수료(비율 입력, 기본 8.6%, 자동 계산)
//   - 배송비(직접입력) = 총마진
// 매출부가세/쿠팡수수료는 더 이상 직접 입력받지 않고, 판매가(쿠폰 할인
// 적용 후 실제 판매가) 기준으로 자동 계산해서 hidden input으로 제출한다.
export interface MarginFieldsInit {
  price?: number | null;
  cost?: number | null;
  coupon?: number | null;
  importVat?: number | null;
  feeRatePct?: number | null;
  shipping?: number | null;
  adCost?: number | null;
  etcCost?: number | null;
}

function toStr(n: number | null | undefined): string {
  return n != null ? String(n) : '';
}

export function useMarginFields(init: MarginFieldsInit = {}) {
  const [price, setPrice] = useState(toStr(init.price));
  const [cost, setCost] = useState(toStr(init.cost));
  const [coupon, setCoupon] = useState(toStr(init.coupon));
  const [importVat, setImportVat] = useState(toStr(init.importVat));
  const [feeRatePct, setFeeRatePct] = useState(
    init.feeRatePct != null ? String(init.feeRatePct) : '8.6'
  );
  const [shipping, setShipping] = useState(toStr(init.shipping));
  const [adCost, setAdCost] = useState(toStr(init.adCost));
  const [etcCost, setEtcCost] = useState(toStr(init.etcCost));

  const priceNum = parseFloat(price) || 0;
  const couponNum = parseFloat(coupon) || 0;
  const actualPrice = Math.max(0, priceNum - couponNum);
  // 매출부가세는 항상 실제 판매가 / 11 (부가세 10% 포함가 기준 역산)
  const outputVat = actualPrice / 11;
  const feeRateNum = parseFloat(feeRatePct) || 0;
  const coupangFee = actualPrice * (feeRateNum / 100);

  const margin = useMemo(
    () =>
      computeMargin({
        price: price === '' ? null : priceNum,
        coupon: coupon === '' ? null : couponNum,
        cost: cost === '' ? null : parseFloat(cost) || 0,
        outputVat: price === '' ? null : outputVat,
        importVat: importVat === '' ? null : parseFloat(importVat) || 0,
        coupangFee: price === '' ? null : coupangFee,
        shipping: shipping === '' ? null : parseFloat(shipping) || 0,
        adCost: adCost === '' ? null : parseFloat(adCost) || 0,
        etcCost: etcCost === '' ? null : parseFloat(etcCost) || 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [price, coupon, cost, importVat, shipping, adCost, etcCost, feeRatePct]
  );

  function reset() {
    setPrice('');
    setCost('');
    setCoupon('');
    setImportVat('');
    setFeeRatePct('8.6');
    setShipping('');
    setAdCost('');
    setEtcCost('');
  }

  return {
    price,
    setPrice,
    cost,
    setCost,
    coupon,
    setCoupon,
    importVat,
    setImportVat,
    feeRatePct,
    setFeeRatePct,
    shipping,
    setShipping,
    adCost,
    setAdCost,
    etcCost,
    setEtcCost,
    outputVat,
    coupangFee,
    margin,
    reset,
  };
}
