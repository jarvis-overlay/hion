'use client';

import { useMemo, useState } from 'react';
import {
  cbmFromDimensions,
  computeLclFreightKrw,
  CUSTOMS_BROKER_FEE,
  CustomsBrokerFeeType,
  LCL_MIN_CHARGE,
  LCL_RATE_PER_CBM,
} from '@/lib/shippingCalc';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

type CbmMode = 'direct' | 'dims';

// LCL(해상 혼적) 배송비를 CBM 기준으로 계산해서, 그 결과를 "배송비" 입력칸에
// 바로 채워넣을 수 있게 해주는 계산기. 마진계산기/소싱리스트/상품관리 카드
// 세 군데의 "배송비" 입력칸에 똑같이 붙여서 쓴다 (onApply로 결과값만 전달 -
// 계산 자체는 저장 안 하고 매번 새로 함, 필요하면 다시 열어서 재계산).
export default function ShippingCostCalculator({
  onApply,
}: {
  onApply: (totalKrw: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CbmMode>('dims');

  const [cbmDirect, setCbmDirect] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [quantity, setQuantity] = useState('1');

  const [brokerFeeType, setBrokerFeeType] = useState<CustomsBrokerFeeType>('none');
  const [customsVat, setCustomsVat] = useState('');
  const [storageEtc, setStorageEtc] = useState('');
  const [courierCod, setCourierCod] = useState('');

  const qty = Math.max(1, parseInt(quantity) || 1);

  const cbm = useMemo(() => {
    if (mode === 'direct') return parseFloat(cbmDirect) || 0;
    return cbmFromDimensions(
      parseFloat(length) || 0,
      parseFloat(width) || 0,
      parseFloat(height) || 0,
      qty
    );
  }, [mode, cbmDirect, length, width, height, qty]);

  const freight = computeLclFreightKrw(cbm);
  const brokerFee = CUSTOMS_BROKER_FEE[brokerFeeType];
  const extras = (parseFloat(customsVat) || 0) + (parseFloat(storageEtc) || 0) + (parseFloat(courierCod) || 0);
  const total = freight + brokerFee + extras;
  const perUnit = qty > 0 ? total / qty : total;

  const inputCls =
    'border border-paperLine bg-white px-2 py-1.5 text-xs font-mono w-full';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-accent underline text-left"
      >
        📦 CBM 해외 배송비 계산기 열기
      </button>
    );
  }

  return (
    <div className="border border-paperLine bg-[#FAFAFB] p-3 grid gap-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-inkSoft">CBM 해외 배송비 계산기 (LCL해운)</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-inkSoft hover:text-ink"
        >
          접기
        </button>
      </div>

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMode('dims')}
          className={`flex-1 px-2 py-1 text-[11px] border ${
            mode === 'dims' ? 'bg-ink text-white border-ink' : 'border-paperLine text-inkSoft'
          }`}
        >
          박스 크기로 계산
        </button>
        <button
          type="button"
          onClick={() => setMode('direct')}
          className={`flex-1 px-2 py-1 text-[11px] border ${
            mode === 'direct' ? 'bg-ink text-white border-ink' : 'border-paperLine text-inkSoft'
          }`}
        >
          CBM 직접입력
        </button>
      </div>

      {mode === 'dims' ? (
        <div className="grid grid-cols-4 gap-1.5">
          <div>
            <label className="text-[10px] text-inkSoft">가로(cm)</label>
            <input value={length} onChange={(e) => setLength(e.target.value)} type="number" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-inkSoft">세로(cm)</label>
            <input value={width} onChange={(e) => setWidth(e.target.value)} type="number" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-inkSoft">높이(cm)</label>
            <input value={height} onChange={(e) => setHeight(e.target.value)} type="number" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-inkSoft">수량</label>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" placeholder="1" className={inputCls} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-inkSoft">총 CBM (m³)</label>
            <input value={cbmDirect} onChange={(e) => setCbmDirect(e.target.value)} type="number" step="0.01" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-inkSoft">수량 (개당 배송비 계산용)</label>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" placeholder="1" className={inputCls} />
          </div>
        </div>
      )}

      <p className="text-[11px] text-inkSoft">
        총 CBM {cbm.toFixed(2)}m³ → {LCL_RATE_PER_CBM.toLocaleString('ko-KR')}원/CBM, 0.5CBM
        단위 올림, 최소 {LCL_MIN_CHARGE.toLocaleString('ko-KR')}원
      </p>

      <div className="border-t border-paperLine pt-2 grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-inkSoft">관세사 수임료 (일반통관 시)</span>
          <select
            value={brokerFeeType}
            onChange={(e) => setBrokerFeeType(e.target.value as CustomsBrokerFeeType)}
            className="border border-paperLine bg-white px-1.5 py-1 text-[11px]"
          >
            <option value="none">없음 (목록통관)</option>
            <option value="personal">개인 (3,650원)</option>
            <option value="business">사업자 (22,000원)</option>
          </select>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className="text-[10px] text-inkSoft">관·부가세</label>
            <input value={customsVat} onChange={(e) => setCustomsVat(e.target.value)} type="number" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-inkSoft">창고료 등</label>
            <input value={storageEtc} onChange={(e) => setStorageEtc(e.target.value)} type="number" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-inkSoft">화물택배 착불</label>
            <input value={courierCod} onChange={(e) => setCourierCod(e.target.value)} type="number" placeholder="0" className={inputCls} />
          </div>
        </div>
      </div>

      <div className="border-t border-paperLine pt-2 grid gap-1">
        <div className="flex justify-between text-inkSoft">
          <span>해상운임(LCL)</span>
          <span className="font-mono text-ink">{fmt(freight)}</span>
        </div>
        {brokerFee > 0 && (
          <div className="flex justify-between text-inkSoft">
            <span>관세사 수임료</span>
            <span className="font-mono text-ink">{fmt(brokerFee)}</span>
          </div>
        )}
        {extras > 0 && (
          <div className="flex justify-between text-inkSoft">
            <span>관부가세·창고료·화물택배</span>
            <span className="font-mono text-ink">{fmt(extras)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold pt-1 border-t border-paperLine">
          <span>총 배송비</span>
          <span className="font-mono">{fmt(total)}</span>
        </div>
        {qty > 1 && (
          <div className="flex justify-between text-accent font-semibold">
            <span>개당 배송비 ({qty}개 기준)</span>
            <span className="font-mono">{fmt(perUnit)}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onApply(qty > 1 ? perUnit : total)}
        disabled={total <= 0}
        className="btn-primary py-1.5 text-xs disabled:opacity-40"
      >
        배송비 칸에 {qty > 1 ? '개당 금액' : '이 금액'} 채우기
      </button>
    </div>
  );
}
