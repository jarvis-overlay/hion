'use client';

import { useEffect, useRef, useState } from 'react';
import type { useMarginFields } from '@/lib/useMarginFields';
import ShippingCostCalculator, { type ShippingCalcState, type ShippingDims } from '@/components/ShippingCostCalculator';
import {
  RG_SIZES,
  classifyRocketGrowth,
  cloneDefaultTable,
  clearRgTable,
  loadRgTable,
  rgFeeFor,
  saveRgTable,
  type RgFeeTable,
  type RgSizeId,
} from '@/lib/rocketGrowth';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

type Fields = ReturnType<typeof useMarginFields>;

// 등록/수정/옵션추가 폼 세 군데서 똑같이 쓰는 "마진 상세 항목" 블록. 두 구역으로 나눈다:
//   ① 마진 계산: 매입부가세 · 수수료(%) · 광고비(%) · 쿠폰 · 기타비용 · 배송비(쿠팡 로켓그로스 입출고+배송)
//   ② 해외배송: 상품 크기(가로·세로·높이)·무게·선적 수량 → 해외배송비(CBM 운임)와 로켓그로스 사이즈 유형이 같이 자동 계산
// ②에 크기·무게를 넣으면 쿠팡 "로켓그로스 사이즈 유형"(세 변의 합·무게 중 큰 쪽)이 정해지고, 그 유형의 개당 입출고+배송
// 요금이 ①의 배송비 칸에 자동으로 들어간다. 해외배송비도 계산기 결과가 자동으로 들어간다.
// 이미 값이 들어 있거나 사용자가 직접 고친 칸은 덮어쓰지 않는다 ("사이즈 기준으로 다시 반영" 버튼으로만 되돌림).
//
// 배송비(쿠팡이 정산에서 떼는 국내 배송비)와 해외배송비(중국->한국 CBM 운임)는 완전히 다른 비용이라 별도 항목이다.
// 쿠팡수수료/광고비는 비율(기본 8.6%/10%) 입력으로 자동 계산해서 hidden input으로 제출하고, 쿠폰 할인은 정률/정액을
// 골라 입력하면 결과 금액을 hidden input으로 제출한다. 매출부가세는 상단(판매가 옆)에서 따로 보여준다.
export function MarginDetailFields({
  fields,
  compact = false,
  intlShippingCalcInitial,
}: {
  fields: Fields;
  compact?: boolean;
  intlShippingCalcInitial?: ShippingCalcState | null;
}) {
  const inputCls = compact
    ? 'border border-paperLine bg-white px-2 py-1.5 text-xs font-mono'
    : 'border border-paperLine bg-white px-3 py-2 text-sm font-mono';
  const selectCls = compact
    ? 'border border-paperLine bg-white px-1.5 py-1.5 text-xs'
    : 'border border-paperLine bg-white px-2 py-2 text-sm';
  const suffixCls = compact ? 'text-[11px] text-inkSoft' : 'text-xs text-inkSoft';
  const labelCls = 'text-[10px] font-semibold text-inkSoft';
  const hasPrice = fields.price !== '';
  const gap = compact ? 'gap-2' : 'gap-3';

  // ---- 로켓그로스 사이즈 → 배송비 자동 반영 ----
  const [dims, setDims] = useState<ShippingDims | null>(null);
  const [table, setTable] = useState<RgFeeTable>(() => cloneDefaultTable());
  const [tableMsg, setTableMsg] = useState('');
  // 저장된 요금표는 브라우저에서만 읽을 수 있어서 화면이 뜬 뒤에 불러온다
  useEffect(() => {
    setTable(loadRgTable());
  }, []);

  const cls = dims ? classifyRocketGrowth(dims.length, dims.width, dims.height, dims.weightKg) : null;
  const fee = cls ? rgFeeFor(cls.id, table) : null;

  // 배송비 칸: 비어 있으면 자동 모드. 사용자가 직접 입력하면 수동 모드(덮어쓰지 않음).
  const [shipAuto, setShipAuto] = useState(fields.shipping === '');
  const lastShipAuto = useRef<number | null>(null);
  const shipChecked = useRef(false);
  useEffect(() => {
    if (!shipChecked.current && fee != null) {
      shipChecked.current = true;
      // 저장돼 있던 값이 지금 사이즈 기준 요금과 같으면 자동 상태로 이어간다
      if (!shipAuto && parseFloat(fields.shipping) === fee) {
        setShipAuto(true);
        lastShipAuto.current = fee;
      }
    }
    if (!shipAuto) return;
    if (fee != null) {
      if (String(fee) !== fields.shipping) fields.setShipping(String(fee));
      lastShipAuto.current = fee;
    } else if (lastShipAuto.current != null) {
      // 크기를 지웠으면 자동으로 넣었던 값도 같이 비운다
      fields.setShipping('');
      lastShipAuto.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fee, shipAuto]);

  // 해외배송비 칸: 계산기 결과(개당 금액)를 같은 방식으로 자동 반영
  const [intlAuto, setIntlAuto] = useState(fields.intlShipping === '');
  const [perUnit, setPerUnit] = useState(0);
  const lastIntlAuto = useRef<number | null>(null);
  const intlChecked = useRef(false);
  useEffect(() => {
    if (!intlChecked.current && perUnit > 0) {
      intlChecked.current = true;
      if (!intlAuto && parseFloat(fields.intlShipping) === perUnit) {
        setIntlAuto(true);
        lastIntlAuto.current = perUnit;
      }
    }
    if (!intlAuto) return;
    if (perUnit > 0) {
      if (String(perUnit) !== fields.intlShipping) fields.setIntlShipping(String(perUnit));
      lastIntlAuto.current = perUnit;
    } else if (lastIntlAuto.current != null) {
      fields.setIntlShipping('');
      lastIntlAuto.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perUnit, intlAuto]);

  function updateTable(next: RgFeeTable) {
    setTable(next);
    setTableMsg(saveRgTable(next) ? '' : '이 브라우저에서는 요금표를 저장할 수 없어요 (이번 화면에서만 적용돼요).');
  }
  function setFee(id: RgSizeId, key: 'inout' | 'delivery', v: string) {
    const n = Math.max(0, Math.round(parseFloat(v) || 0));
    updateTable({ ...table, fees: { ...table.fees, [id]: { ...table.fees[id], [key]: n } } });
  }

  const shipPlaceholder = fee != null ? String(fee) : '크기를 넣으면 자동';
  const shippingDiffers = fee != null && parseFloat(fields.shipping) !== fee;

  return (
    <>
      <input type="hidden" name="coupang_fee" value={hasPrice ? fields.coupangFee : ''} />
      <input type="hidden" name="ad_cost" value={hasPrice ? fields.adCost : ''} />
      <input type="hidden" name="coupon" value={hasPrice ? fields.couponAmount : ''} />

      {/* ① 마진 계산 */}
      <div className="border border-paperLine bg-white p-3 grid gap-2">
        <span className="text-xs font-semibold text-ink">① 마진 계산</span>
        <div className={`grid grid-cols-2 sm:grid-cols-3 ${gap}`}>
          <label className="grid gap-0.5">
            <span className={labelCls}>매입부가세 (원)</span>
            <input
              name="import_vat"
              value={fields.importVat}
              onChange={(e) => fields.setImportVat(e.target.value)}
              type="number"
              step="0.01"
              placeholder="0"
              className={inputCls}
            />
          </label>
          <label className="grid gap-0.5">
            <span className={labelCls}>쿠팡 수수료 (%)</span>
            <input
              value={fields.feeRatePct}
              onChange={(e) => fields.setFeeRatePct(e.target.value)}
              type="number"
              step="0.1"
              placeholder="8.6"
              className={inputCls}
            />
          </label>
          <label className="grid gap-0.5">
            <span className={labelCls}>광고비 (%)</span>
            <input
              value={fields.adRatePct}
              onChange={(e) => fields.setAdRatePct(e.target.value)}
              type="number"
              step="0.1"
              placeholder="10"
              className={inputCls}
            />
          </label>
          <div className="grid gap-0.5">
            <span className={labelCls}>쿠폰 할인</span>
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
                placeholder={fields.couponMode === 'percent' ? '할인율' : '할인액'}
                className={inputCls + ' flex-1 min-w-0'}
              />
              <span className={suffixCls}>{fields.couponMode === 'percent' ? '%' : '원'}</span>
            </div>
          </div>
          <label className="grid gap-0.5">
            <span className={labelCls}>기타 비용 (원)</span>
            <input
              name="etc_cost"
              value={fields.etcCost}
              onChange={(e) => fields.setEtcCost(e.target.value)}
              type="number"
              step="0.01"
              placeholder="0"
              className={inputCls}
            />
          </label>
          <label className="grid gap-0.5">
            <span className={labelCls}>
              배송비 (로켓그로스 입출고+배송){shipAuto && fee != null ? ' · 자동' : ''}
            </span>
            <input
              name="shipping"
              value={fields.shipping}
              onChange={(e) => {
                fields.setShipping(e.target.value);
                setShipAuto(false); // 직접 고치는 순간부터 자동으로 덮어쓰지 않는다 (지웠다 다시 입력하는 중에 값이 되살아나지 않게)
              }}
              type="number"
              step="0.01"
              placeholder={shipPlaceholder}
              className={inputCls + (shipAuto && fee != null ? ' bg-profitBg' : '')}
            />
          </label>
        </div>
        {hasPrice && (
          <p className={suffixCls}>
            자동 계산 - 쿠팡수수료 {fmt(fields.coupangFee)} (판매가의 {fields.feeRatePct || 0}%) · 광고비{' '}
            {fmt(fields.adCost)} (판매가의 {fields.adRatePct || 0}%)
            {fields.couponAmount > 0 && ` · 쿠폰 할인 ${fmt(fields.couponAmount)}`}
          </p>
        )}
      </div>

      {/* ② 해외배송 + 로켓그로스 사이즈 */}
      <div className="border border-paperLine bg-white p-3 grid gap-2">
        <span className="text-xs font-semibold text-ink">② 해외배송 (중국→한국) · 로켓그로스 사이즈</span>
        <label className="grid gap-0.5">
          <span className={labelCls}>
            해외배송비 (개당, 원){intlAuto && perUnit > 0 ? ' · 아래 계산기에서 자동' : ''}
          </span>
          <input
            name="intl_shipping"
            value={fields.intlShipping}
            onChange={(e) => {
              fields.setIntlShipping(e.target.value);
              setIntlAuto(false);
            }}
            type="number"
            step="0.01"
            placeholder="크기·수량을 넣으면 자동"
            className={inputCls + (intlAuto && perUnit > 0 ? ' bg-profitBg' : '')}
          />
        </label>

        <ShippingCostCalculator
          defaultOpen
          onApply={(v) => {
            fields.setIntlShipping(String(Math.round(v)));
            setIntlAuto(true);
          }}
          onDimsChange={setDims}
          onPerUnitChange={setPerUnit}
          initial={intlShippingCalcInitial}
        />

        <div className="border-t border-paperLine pt-2 grid gap-1.5">
          <span className="text-[11px] font-semibold text-inkSoft">로켓그로스 사이즈 유형 (세 변의 합 · 무게 중 큰 쪽)</span>
          {cls == null ? (
            <p className={suffixCls}>위 계산기의 &quot;박스 크기로 계산&quot;에 가로·세로·높이(와 무게)를 넣으면 사이즈 유형과 배송비가 자동으로 정해져요.</p>
          ) : cls.overLimit ? (
            <p className="text-xs text-warn bg-warnBg px-2 py-1.5">{cls.reason}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {RG_SIZES.map((s) => (
                  <span
                    key={s.id}
                    className={`px-2 py-0.5 text-[11px] border ${
                      s.id === cls.id ? 'bg-ink text-white border-ink font-semibold' : 'border-paperLine text-inkSoft'
                    }`}
                  >
                    {s.name}
                  </span>
                ))}
              </div>
              <p className={suffixCls}>{cls.reason}</p>
              {fee != null && cls.id && (
                <p className="text-xs text-ink">
                  개당 입출고 {fmt(table.fees[cls.id].inout)} + 배송 {fmt(table.fees[cls.id].delivery)}
                  {table.vat ? ' (부가세 10% 포함)' : ''} = <strong className="font-mono">{fmt(fee)}</strong>
                  {shipAuto ? ' → ① 배송비 칸에 자동 반영됨' : ''}
                </p>
              )}
              {shippingDiffers && !shipAuto && (
                <button
                  type="button"
                  onClick={() => {
                    fields.setShipping(String(fee));
                    setShipAuto(true);
                  }}
                  className="text-[11px] text-accent underline text-left"
                >
                  직접 입력한 배송비 대신 사이즈 기준 {fmt(fee as number)}으로 다시 반영
                </button>
              )}
            </>
          )}

          <details className="text-[11px] text-inkSoft">
            <summary className="cursor-pointer text-accent">로켓그로스 요금표 확인·수정 (입출고비 + 배송비)</summary>
            <div className="mt-2 grid gap-1.5">
              <p className="leading-relaxed">
                기본값은 쿠팡 공식 안내의 <strong>시작 요금(부가세 별도, 패션 카테고리 기준)</strong>이에요. 실제 요금은 카테고리·판매가·시점에 따라
                달라서 윙(WING)의 로켓그로스 요금표대로 고쳐 쓰세요. 이 브라우저에 저장돼요.
              </p>
              <div className="grid grid-cols-[4rem_1fr_1fr_4.5rem] gap-1 items-center">
                <span />
                <span className="text-[10px]">입출고비(원)</span>
                <span className="text-[10px]">배송비(원)</span>
                <span className="text-[10px] text-right">합계</span>
                {RG_SIZES.map((s) => (
                  <RateRow
                    key={s.id}
                    name={s.name}
                    row={table.fees[s.id]}
                    total={rgFeeFor(s.id, table) ?? 0}
                    onChange={(key, v) => setFee(s.id, key, v)}
                  />
                ))}
              </div>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={table.vat}
                  onChange={(e) => updateTable({ ...table, vat: e.target.checked })}
                />
                요금에 부가세 10%를 더해서 반영 (정산에서 부가세 포함으로 빠지는 금액을 쓰고 싶을 때)
              </label>
              <button
                type="button"
                onClick={() => {
                  clearRgTable();
                  setTable(cloneDefaultTable());
                  setTableMsg('기본값으로 되돌렸어요.');
                }}
                className="text-left underline w-fit"
              >
                기본값으로 되돌리기
              </button>
              {tableMsg && <p>{tableMsg}</p>}
            </div>
          </details>
        </div>
      </div>
    </>
  );
}

function RateRow({
  name,
  row,
  total,
  onChange,
}: {
  name: string;
  row: { inout: number; delivery: number };
  total: number;
  onChange: (key: 'inout' | 'delivery', v: string) => void;
}) {
  const cls = 'border border-paperLine bg-white px-1.5 py-1 text-[11px] font-mono w-full';
  return (
    <>
      <span className="text-[11px]">{name}</span>
      <input type="number" value={row.inout} onChange={(e) => onChange('inout', e.target.value)} className={cls} />
      <input type="number" value={row.delivery} onChange={(e) => onChange('delivery', e.target.value)} className={cls} />
      <span className="text-right font-mono text-ink">{total.toLocaleString('ko-KR')}</span>
    </>
  );
}
