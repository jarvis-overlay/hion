'use client';

import { useId, useMemo, useRef, useState } from 'react';
import {
  cbmFromDimensions,
  computeLclFreightKrw,
  LCL_MIN_CHARGE,
  LCL_RATE_PER_CBM,
  SHIPPING_EXTRA_FEE_PRESETS,
} from '@/lib/shippingCalc';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

type CbmMode = 'direct' | 'dims';
// 'total' = 전체 화물 기준 총액 (수량으로 나눠서 개당 배송비에 반영) ·
// 'perUnit' = 이미 1개 기준으로 알고 있는 금액 (안 나누고 그대로 더함)
type FeeBasis = 'total' | 'perUnit';
interface ExtraFeeRow {
  id: string;
  label: string;
  amount: string;
  basis: FeeBasis;
}

// LCL(해상 혼적) 배송비를 CBM 기준으로 계산해서, 그 결과를 "배송비" 입력칸에
// 바로 채워넣을 수 있게 해주는 계산기. 마진계산기/소싱리스트/상품관리 카드
// 세 군데의 "배송비" 입력칸에 똑같이 붙여서 쓴다 (onApply로 결과값만 전달 -
// 계산 자체는 저장 안 하고 매번 새로 함, 필요하면 다시 열어서 재계산).
//
// 부대비용(부가서비스)은 실제 포워딩 업체 청구서 항목(기본검수/포장보완/
// 원산지표시/B·L/D·O/밀크런택배 등)이 매번 다르게 조합돼서 청구되길래,
// 고정 항목 몇 개를 미리 박아두는 대신 자유롭게 행을 추가하고 항목명은
// 자주 쓰는 프리셋 중에서 고르거나 직접 입력, 금액은 항상 직접 입력하는
// 리스트 방식으로 만들었다.
export default function ShippingCostCalculator({
  onApply,
}: {
  onApply: (totalKrw: number) => void;
}) {
  const presetListId = useId();
  const rowIdCounter = useRef(0);
  function nextRowId() {
    rowIdCounter.current += 1;
    return `fee-${rowIdCounter.current}`;
  }

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CbmMode>('dims');

  const [cbmDirect, setCbmDirect] = useState('');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [quantity, setQuantity] = useState('1');

  const [extraFees, setExtraFees] = useState<ExtraFeeRow[]>([
    { id: nextRowId(), label: '', amount: '', basis: 'total' },
  ]);

  function addFeeRow() {
    setExtraFees((rows) => [...rows, { id: nextRowId(), label: '', amount: '', basis: 'total' }]);
  }
  function removeFeeRow(id: string) {
    setExtraFees((rows) => rows.filter((r) => r.id !== id));
  }
  function updateFeeLabel(id: string, label: string) {
    setExtraFees((rows) =>
      rows.map((r) => {
        if (r.id !== id) return r;
        // 프리셋 중 금액이 정해진 항목(관세사 수임료 등)을 고르면, 아직 금액을
        // 직접 안 건드렸을 때만 참고용으로 자동 채워준다.
        const preset = SHIPPING_EXTRA_FEE_PRESETS.find((p) => p.label === label);
        const amount = preset?.amount != null && r.amount === '' ? String(preset.amount) : r.amount;
        return { ...r, label, amount };
      })
    );
  }
  function updateFeeAmount(id: string, amount: string) {
    setExtraFees((rows) => rows.map((r) => (r.id === id ? { ...r, amount } : r)));
  }
  function updateFeeBasis(id: string, basis: FeeBasis) {
    setExtraFees((rows) => rows.map((r) => (r.id === id ? { ...r, basis } : r)));
  }

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
  // '전체 화물 기준' 항목은 해상운임과 합쳐서 수량으로 나누고, '개당' 항목은
  // 이미 1개 기준이므로 안 나누고 그대로 더한다.
  const extrasTotalBasis = extraFees
    .filter((r) => r.basis === 'total')
    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const extrasPerUnitBasis = extraFees
    .filter((r) => r.basis === 'perUnit')
    .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const shipmentTotal = freight + extrasTotalBasis;
  const perUnit = (qty > 0 ? shipmentTotal / qty : shipmentTotal) + extrasPerUnitBasis;
  const grandTotal = shipmentTotal + extrasPerUnitBasis * qty;

  const inputCls = 'border border-paperLine bg-white px-2 py-1.5 text-xs font-mono w-full';

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
        <button type="button" onClick={() => setOpen(false)} className="text-inkSoft hover:text-ink">
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
        총 CBM {cbm.toFixed(2)}m³ → {LCL_RATE_PER_CBM.toLocaleString('ko-KR')}원/CBM, 0.5CBM 단위
        올림, 최소 {LCL_MIN_CHARGE.toLocaleString('ko-KR')}원
      </p>

      <div className="border-t border-paperLine pt-2 grid gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-inkSoft font-semibold">부가서비스 (검수·포장·서류비 등)</span>
          <button type="button" onClick={addFeeRow} className="text-accent font-semibold">
            + 항목 추가
          </button>
        </div>

        <datalist id={presetListId}>
          {SHIPPING_EXTRA_FEE_PRESETS.map((p) => (
            <option key={p.label} value={p.label} />
          ))}
        </datalist>

        {extraFees.map((row) => (
          <div key={row.id} className="flex gap-1.5 items-center">
            <input
              list={presetListId}
              value={row.label}
              onChange={(e) => updateFeeLabel(row.id, e.target.value)}
              placeholder="항목명 (목록에서 선택 또는 직접입력)"
              className={inputCls + ' flex-[2]'}
            />
            <input
              value={row.amount}
              onChange={(e) => updateFeeAmount(row.id, e.target.value)}
              type="number"
              placeholder="금액"
              className={inputCls + ' flex-1'}
            />
            <select
              value={row.basis}
              onChange={(e) => updateFeeBasis(row.id, e.target.value as FeeBasis)}
              title="이 금액이 화물 전체 기준인지, 이미 1개 기준인지"
              className="border border-paperLine bg-white px-1 py-1.5 text-[11px] shrink-0"
            >
              <option value="total">전체금액</option>
              <option value="perUnit">개당금액</option>
            </select>
            <button
              type="button"
              onClick={() => removeFeeRow(row.id)}
              className="text-inkSoft hover:text-red-700 px-1"
              aria-label="이 항목 삭제"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-paperLine pt-2 grid gap-1">
        <div className="flex justify-between text-inkSoft">
          <span>해상운임(LCL, 전체 화물)</span>
          <span className="font-mono text-ink">{fmt(freight)}</span>
        </div>
        {extrasTotalBasis > 0 && (
          <div className="flex justify-between text-inkSoft">
            <span>부가서비스 - 전체금액 합계</span>
            <span className="font-mono text-ink">{fmt(extrasTotalBasis)}</span>
          </div>
        )}
        {extrasPerUnitBasis > 0 && (
          <div className="flex justify-between text-inkSoft">
            <span>부가서비스 - 개당금액 합계</span>
            <span className="font-mono text-ink">{fmt(extrasPerUnitBasis)} / 개</span>
          </div>
        )}
        <div className="flex justify-between text-inkSoft pt-1 border-t border-paperLine">
          <span>총 배송비 (전체 화물, {qty}개)</span>
          <span className="font-mono">{fmt(grandTotal)}</span>
        </div>
        <div className="flex justify-between font-semibold text-accent">
          <span>개당 배송비 (마진계산에 쓸 값)</span>
          <span className="font-mono">{fmt(perUnit)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onApply(perUnit)}
        disabled={perUnit <= 0}
        className="btn-primary py-1.5 text-xs disabled:opacity-40"
      >
        배송비 칸에 개당 금액 채우기
      </button>
    </div>
  );
}
