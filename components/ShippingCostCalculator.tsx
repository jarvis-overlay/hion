'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  computeShippingPerUnit,
  computeLclFreightKrw,
  cbmFromDimensions,
  LCL_MIN_CHARGE,
  LCL_RATE_PER_CBM,
  roundLclCbm,
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

// 계산기에 입력한 원본 값들 (박스크기/CBM/수량/부가서비스 목록) - 계산
// 결과(개당 금액)와 별개로 이것도 저장해뒀다가, 폼을 다시 열었을 때 매번
// 처음부터 다시 입력하지 않고 그대로 복원되게 하기 위한 스냅샷.
export interface ShippingCalcState {
  mode: CbmMode;
  cbmDirect: string;
  length: string;
  width: string;
  height: string;
  weight?: string; // 개당 무게(kg) - 로켓그로스 사이즈 유형 판정용 (예전에 저장된 값엔 없음)
  quantity: string;
  extraFees: { label: string; amount: string; basis: FeeBasis }[];
  // 관세·부가세 자동 계산 (예전에 저장된 값엔 없음 → 켜지 않은 채로 열어서 기존 금액이 바뀌지 않게 한다)
  taxes?: {
    on: boolean;
    dutyRate: string; // 관세율(%)
    vatManual: boolean; // true면 vat 칸 값을 그대로 쓰고 자동 계산 안 함
    vat: string;
    dutyManual: boolean;
    duty: string;
  };
}

// 부가서비스 "기본값" - 자주 쓰는 항목 조합(검수·포장·서류비 등)을 이 브라우저에
// 저장해두고, 새 상품에서 계산기를 열면 자동으로 채워준다. 저장 위치는 브라우저
// localStorage라서 PC/브라우저마다 따로다(서버 저장 아님). 접근이 막혀 있으면
// (프라이빗 모드 등) 기능만 조용히 빠진다.
const DEFAULTS_KEY = 'hion.shippingExtraFeeDefaults.v1';
type DefaultFee = { label: string; amount: string; basis: FeeBasis };

function loadFeeDefaults(): DefaultFee[] {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 30)
      .map((r: any) => ({
        label: typeof r?.label === 'string' ? r.label.slice(0, 60) : '',
        amount: typeof r?.amount === 'string' ? r.amount.slice(0, 20) : '',
        basis: (r?.basis === 'perUnit' ? 'perUnit' : 'total') as FeeBasis,
      }))
      .filter((r) => r.label || r.amount);
  } catch {
    return [];
  }
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
export interface ShippingDims {
  length: number;
  width: number;
  height: number;
  weightKg: number | null;
}

export default function ShippingCostCalculator({
  onApply,
  initial,
  defaultOpen = false,
  onDimsChange,
  onPerUnitChange,
  unitCost,
  quantity: quantityProp,
  onQuantityChange,
}: {
  // 수량을 바깥(예: 발주 회차 폼)이 갖고 있을 때 넘긴다 - 넘기면 이 계산기의 수량 입력창이 그 값을 그대로 쓰고 바꾼다.
  // 안 넘기면 예전처럼 계산기 안에서 따로 관리한다. 제어 모드에서 빈칸이면 해외배송비 자동 반영은 하지 않는다(0 보고).
  quantity?: string;
  onQuantityChange?: (v: string) => void;
  // 매입 원가(개당, 원). 넘기면 "관세·부가세 자동 계산" 구역이 나온다 (안 넘기면 구역 자체가 없음)
  unitCost?: number;
  onApply: (totalKrw: number) => void;
  initial?: ShippingCalcState | null;
  defaultOpen?: boolean; // 처음부터 펼쳐서 크기·무게를 바로 입력하게 한다
  // 크기(가로·세로·높이·무게)가 바뀔 때마다 알려준다 - 박스 크기 모드가 아니면 null
  onDimsChange?: (dims: ShippingDims | null) => void;
  // 개당 해외배송비가 바뀔 때마다 알려준다 (자동 반영용)
  onPerUnitChange?: (perUnitKrw: number) => void;
}) {
  const presetListId = useId();
  const rowIdCounter = useRef(0);
  function nextRowId() {
    rowIdCounter.current += 1;
    return `fee-${rowIdCounter.current}`;
  }

  const hasInitial =
    !!initial &&
    (!!initial.cbmDirect ||
      !!initial.length ||
      !!initial.width ||
      !!initial.height ||
      initial.extraFees.some((f) => f.amount));

  const [open, setOpen] = useState(hasInitial || defaultOpen);
  const [mode, setMode] = useState<CbmMode>(initial?.mode || 'dims');

  const [cbmDirect, setCbmDirect] = useState(initial?.cbmDirect || '');
  const [length, setLength] = useState(initial?.length || '');
  const [width, setWidth] = useState(initial?.width || '');
  const [height, setHeight] = useState(initial?.height || '');
  const [weight, setWeight] = useState(initial?.weight || '');
  const [quantityState, setQuantityState] = useState(initial?.quantity || '1');
  const controlledQty = quantityProp !== undefined;
  const quantity = controlledQty ? quantityProp : quantityState;
  const setQuantity = (v: string) => {
    if (controlledQty) onQuantityChange?.(v);
    else setQuantityState(v);
  };

  // 지연 초기화(함수형 초기값)로 넣어야 nextRowId()가 최초 렌더에서 딱
  // 한 번만 호출된다 - 배열 리터럴을 그대로 넘기면 매 렌더마다 호출되어
  // 카운터가 불필요하게 계속 증가한다.
  const [extraFees, setExtraFees] = useState<ExtraFeeRow[]>(() =>
    initial && initial.extraFees.length > 0
      ? initial.extraFees.map((f) => ({ id: nextRowId(), ...f }))
      : [{ id: nextRowId(), label: '', amount: '', basis: 'total' }]
  );

  // 관세·부가세 자동 계산 상태. 새 상품은 켜진 채로 시작, 예전에 저장된 계산기(taxes 없음)는 꺼진 채로 열어서 기존 금액을 건드리지 않는다.
  const [taxOn, setTaxOn] = useState(initial ? !!initial.taxes?.on : true);
  const [dutyRate, setDutyRate] = useState(initial?.taxes?.dutyRate || '8');
  const [vatManual, setVatManual] = useState(!!initial?.taxes?.vatManual);
  const [vatInput, setVatInput] = useState(initial?.taxes?.vat || '');
  const [dutyManual, setDutyManual] = useState(!!initial?.taxes?.dutyManual);
  const [dutyInput, setDutyInput] = useState(initial?.taxes?.duty || '');

  const [defaultsCount, setDefaultsCount] = useState(0);
  const [defaultsMsg, setDefaultsMsg] = useState('');
  const defaultsApplied = useRef(false);

  // 저장된 기본값 개수 확인 + 새 상품(입력이 하나도 없는 상태)에서 계산기를
  // 열었을 때 한 번만 자동으로 채운다. 이미 입력/저장된 값이 있으면 건드리지 않는다.
  // (계산기가 접혀 있을 땐 채우지 않는다 - 폼에 숨은 값이 따라 저장되는 걸 막기 위해)
  useEffect(() => {
    if (!open || defaultsApplied.current) return;
    defaultsApplied.current = true;
    const saved = loadFeeDefaults();
    setDefaultsCount(saved.length);
    if (hasInitial || saved.length === 0) return;
    setExtraFees((rows) =>
      rows.every((r) => !r.label && !r.amount)
        ? saved.map((f) => ({ id: nextRowId(), ...f }))
        : rows
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function saveAsDefaults() {
    const rows = extraFees
      .filter((r) => r.label.trim() || r.amount)
      .map((r) => ({ label: r.label.trim(), amount: r.amount, basis: r.basis }));
    try {
      if (rows.length === 0) {
        localStorage.removeItem(DEFAULTS_KEY);
        setDefaultsCount(0);
        setDefaultsMsg('입력된 항목이 없어서 기본값을 비웠어요.');
      } else {
        localStorage.setItem(DEFAULTS_KEY, JSON.stringify(rows));
        setDefaultsCount(rows.length);
        setDefaultsMsg(`기본값 ${rows.length}개를 저장했어요. 새 상품에서 계산기를 열면 자동으로 채워져요.`);
      }
    } catch {
      setDefaultsMsg('이 브라우저에서는 기본값을 저장할 수 없어요 (저장 공간 접근이 막혀 있어요).');
    }
  }
  function loadDefaults() {
    const saved = loadFeeDefaults();
    setDefaultsCount(saved.length);
    if (saved.length === 0) {
      setDefaultsMsg('저장된 기본값이 없어요.');
      return;
    }
    setExtraFees(saved.map((f) => ({ id: nextRowId(), ...f })));
    setDefaultsMsg(`기본값 ${saved.length}개를 불러왔어요 (지금 입력한 항목은 교체됐어요).`);
  }
  function clearDefaults() {
    try {
      localStorage.removeItem(DEFAULTS_KEY);
      setDefaultsCount(0);
      setDefaultsMsg('저장된 기본값을 지웠어요.');
    } catch {
      setDefaultsMsg('기본값을 지우지 못했어요.');
    }
  }

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

  // 개당 금액 계산은 lib/shippingCalc.ts의 순수 함수 (발주 회차 복사 때도 같은 식을 쓴다)
  // 관세·부가세: 매입원가 x 선적 수량(= 화물 전체 매입액) 기준. 부가세 = 매입액 / 11, 관세 = 매입액 x 관세율(기본 8%).
  // 자동 값은 원가·수량·관세율이 바뀌면 같이 바뀌고, 칸을 직접 고치면 그 값을 쓴다("자동 계산으로" 버튼으로 되돌림).
  const {
    qty, cbm, freight, extrasTotalBasis, extrasPerUnitBasis, taxSupported, taxBase,
    autoVat, autoDuty, vatValue, dutyValue, taxTotal, shipmentTotal, perUnit, grandTotal,
  } = computeShippingPerUnit(
    {
      mode, cbmDirect, length, width, height, quantity, extraFees,
      taxes: { on: taxOn, dutyRate, vatManual, vat: vatInput, dutyManual, duty: dutyInput },
    },
    unitCost
  );
  // 부가서비스에 예전 방식("관·부가세" 같은 이름)으로 직접 넣은 줄 - 자동 계산을 켠 채로 두면 이중으로 더해지므로 알려준다
  const isTaxRowLabel = (label: string) => /관\s*[·.]?\s*부가세|관세|부가세/.test(label);
  const dupTaxRows = taxSupported && taxOn ? extraFees.filter((r) => isTaxRowLabel(r.label)) : [];


  const inputCls = 'border border-paperLine bg-white px-2 py-1.5 text-xs font-mono w-full';

  // 부모에게 크기·개당 금액을 알린다 (콜백은 매 렌더 새로 만들어지므로 ref로 최신 것만 쓰고, 값이 바뀔 때만 호출)
  const dimsCb = useRef(onDimsChange);
  dimsCb.current = onDimsChange;
  const perUnitCb = useRef(onPerUnitChange);
  perUnitCb.current = onPerUnitChange;
  useEffect(() => {
    dimsCb.current?.(
      mode === 'dims'
        ? {
            length: parseFloat(length) || 0,
            width: parseFloat(width) || 0,
            height: parseFloat(height) || 0,
            weightKg: weight === '' ? null : parseFloat(weight) || null,
          }
        : null
    );
  }, [mode, length, width, height, weight]);
  const perUnitRounded = Math.round(perUnit);
  useEffect(() => {
    // 제어 모드에서 수량이 빈칸이면 자동 반영이 일어나지 않게 0으로 알린다
    perUnitCb.current?.(controlledQty && !(parseInt(quantity) > 0) ? 0 : perUnitRounded);
  }, [perUnitRounded, controlledQty, quantity]);

  // 계산기 자체가 접혀있어도(open=false) 이 hidden input은 항상 폼에 남아있어야
  // 다시 열지 않고 그냥 저장해도 입력값이 안 사라진다.
  const hasContent =
    hasInitial || cbmDirect || length || width || height || weight || extraFees.some((f) => f.amount) || (taxSupported && !taxOn);
  const calcStateHiddenInput = (
    <input
      type="hidden"
      name="intl_shipping_calc"
      value={
        hasContent
          ? JSON.stringify({
              mode,
              cbmDirect,
              length,
              width,
              height,
              weight,
              quantity,
              extraFees: extraFees.map(({ label, amount, basis }) => ({ label, amount, basis })),
              ...(taxSupported
                ? { taxes: { on: taxOn, dutyRate, vatManual, vat: vatManual ? vatInput : '', dutyManual, duty: dutyManual ? dutyInput : '' } }
                : {}),
            } as ShippingCalcState)
          : ''
      }
    />
  );

  if (!open) {
    return (
      <div>
        {calcStateHiddenInput}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11px] text-accent underline text-left"
        >
          📦 CBM 해외 배송비 계산기 열기
        </button>
      </div>
    );
  }

  return (
    <div className="border border-paperLine bg-[#FAFAFB] p-3 grid gap-2.5 text-xs">
      {calcStateHiddenInput}
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
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
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
            <label className="text-[10px] text-inkSoft">무게(kg)</label>
            <input value={weight} onChange={(e) => setWeight(e.target.value)} type="number" step="0.01" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className="text-[10px] text-inkSoft">수량(선적)</label>
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" placeholder={controlledQty ? '수량' : '1'} className={inputCls} />
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
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" placeholder={controlledQty ? '수량' : '1'} className={inputCls} />
          </div>
        </div>
      )}

      <p className="text-[11px] text-inkSoft">
        총 CBM {cbm.toFixed(2)}m³ → {LCL_RATE_PER_CBM.toLocaleString('ko-KR')}원/CBM, 0.5CBM 단위
        올림, 최소 {LCL_MIN_CHARGE.toLocaleString('ko-KR')}원
      </p>

      {controlledQty && (
        <p className="text-[11px] text-inkSoft">수량을 바꾸면 자동 계산된 해외배송비만 같이 바뀌어요. 직접 입력한 값은 그대로예요.</p>
      )}

      {taxSupported && (
        <div className="border-t border-paperLine pt-2 grid gap-1.5">
          <label className="flex items-center gap-1.5 text-inkSoft font-semibold">
            <input type="checkbox" checked={taxOn} onChange={(e) => setTaxOn(e.target.checked)} />
            관세·부가세 자동 계산 (화물 전체 기준, 해외배송비에 포함)
          </label>
          {taxOn && (
            <>
              {taxBase <= 0 ? (
                <p className="text-[11px] text-warn">위쪽 &quot;매입 원가&quot;를 입력하면 관세·부가세가 자동으로 계산돼요.</p>
              ) : (
                <p className="text-[11px] text-inkSoft">
                  매입액 = 매입원가 {fmt(unitCost || 0)} × 선적 수량 {qty}개 = <span className="font-mono text-ink">{fmt(taxBase)}</span>
                </p>
              )}
              {dupTaxRows.length > 0 && (
                <div className="text-[11px] text-warn bg-warnBg px-2 py-1.5 grid gap-1">
                  <span>
                    아래 부가서비스에 &quot;{dupTaxRows.map((r) => r.label).join('·')}&quot; 줄이 있어요. 자동 계산과 같이 쓰면 관세·부가세가 두 번 들어가요.
                  </span>
                  <button
                    type="button"
                    onClick={() => setExtraFees((rows) => rows.filter((r) => !isTaxRowLabel(r.label)))}
                    className="text-accent underline text-left"
                  >
                    그 줄 지우기 (그 뒤 &quot;지금 목록을 기본값으로 저장&quot;을 누르면 다음부터 안 나와요)
                  </button>
                </div>
              )}
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-1.5 gap-y-1">
                <span className="text-inkSoft">부가세</span>
                <input
                  value={vatManual ? vatInput : String(autoVat)}
                  onChange={(e) => {
                    setVatInput(e.target.value);
                    setVatManual(true);
                  }}
                  type="number"
                  placeholder="0"
                  title="매입액 ÷ 11. 직접 고칠 수 있어요"
                  className={inputCls + (vatManual ? '' : ' bg-profitBg')}
                />
                {vatManual ? (
                  <button type="button" onClick={() => setVatManual(false)} className="text-[11px] text-accent underline">
                    자동 계산으로
                  </button>
                ) : (
                  <span className="text-[11px] text-inkSoft">매입액 ÷ 11 · 자동</span>
                )}

                <span className="text-inkSoft">관세</span>
                <div className="flex items-center gap-1">
                  <input
                    value={dutyManual ? dutyInput : String(autoDuty)}
                    onChange={(e) => {
                      setDutyInput(e.target.value);
                      setDutyManual(true);
                    }}
                    type="number"
                    placeholder="0"
                    title="매입액 × 관세율. 직접 고칠 수 있어요"
                    className={inputCls + (dutyManual ? '' : ' bg-profitBg')}
                  />
                  <input
                    value={dutyRate}
                    onChange={(e) => setDutyRate(e.target.value)}
                    type="number"
                    step="0.1"
                    title="관세율(%)"
                    className={inputCls + ' !w-16 shrink-0'}
                  />
                  <span className="text-[11px] text-inkSoft shrink-0">%</span>
                </div>
                {dutyManual ? (
                  <button type="button" onClick={() => setDutyManual(false)} className="text-[11px] text-accent underline">
                    자동 계산으로
                  </button>
                ) : (
                  <span className="text-[11px] text-inkSoft">매입액 × 관세율 · 자동</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <button type="button" onClick={saveAsDefaults} className="text-accent underline">
            지금 목록을 기본값으로 저장
          </button>
          {defaultsCount > 0 && (
            <>
              <button type="button" onClick={loadDefaults} className="text-inkSoft underline">
                기본값 불러오기 ({defaultsCount}개)
              </button>
              <button type="button" onClick={clearDefaults} className="text-inkSoft hover:text-red-700 underline">
                기본값 지우기
              </button>
            </>
          )}
        </div>
        {defaultsMsg && <p className="text-[11px] text-inkSoft">{defaultsMsg}</p>}
      </div>

      <div className="border-t border-paperLine pt-2 grid gap-1">
        <div className="flex justify-between text-inkSoft">
          <span>해상운임(LCL, 전체 화물)</span>
          <span className="font-mono text-ink">{fmt(freight)}</span>
        </div>
        {cbm > 0 && (
          <p className="text-[11px] text-inkSoft leading-relaxed">
            계산: 총 CBM {cbm.toFixed(2)}m³ → 0.5CBM 단위 올림 {roundLclCbm(cbm).toFixed(1)} × {LCL_RATE_PER_CBM.toLocaleString('ko-KR')}원 = {fmt(roundLclCbm(cbm) * LCL_RATE_PER_CBM)}
            {roundLclCbm(cbm) * LCL_RATE_PER_CBM < LCL_MIN_CHARGE &&
              ` → 최소 청구금액 ${LCL_MIN_CHARGE.toLocaleString('ko-KR')}원 적용`}
          </p>
        )}
        {taxTotal > 0 && (
          <div className="flex justify-between text-inkSoft">
            <span>
              관세 {fmt(dutyValue)} + 부가세 {fmt(vatValue)}
            </span>
            <span className="font-mono text-ink">{fmt(taxTotal)}</span>
          </div>
        )}
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
        해외배송비 칸에 개당 금액 채우기
      </button>
    </div>
  );
}
