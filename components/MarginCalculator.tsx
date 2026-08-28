'use client';

import { useMemo, useState, useTransition } from 'react';
import { addMarginEntry, deleteMarginEntry } from '@/app/dashboard/margin/actions';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

function badgeClass(pct: number) {
  if (pct < 0) return 'bg-red-100 text-red-700';
  if (pct < 15) return 'bg-warnBg text-warn';
  return 'bg-profitBg text-profit';
}

// 매출부가세/매입부가세/쿠팡수수료는 환차·프로모션·카테고리별 수수료
// 차이로 공식과 실제 정산 금액이 다를 수 있어서, 자동계산 대신 직접
// 입력받는다. 아래는 "이 정도일 것이다"라는 제안값일 뿐 - 눌러서
// 채우고 실제 정산서 보고 고치면 된다.
function SuggestField({
  label,
  hint,
  value,
  onChange,
  suggested,
  suggestedLabel,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  suggested: number;
  suggestedLabel: string;
}) {
  return (
    <div className="grid gap-1">
      <label className="text-xs text-inkSoft">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type="number"
        placeholder="0"
        className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
      />
      {suggested > 0 && (
        <button
          type="button"
          onClick={() => onChange(String(Math.round(suggested)))}
          className="text-[11px] text-accent underline text-left"
        >
          제안값 {fmt(suggested)} ({suggestedLabel}) · 채우기
        </button>
      )}
      {hint && !suggested && <span className="text-[11px] text-inkSoft">{hint}</span>}
    </div>
  );
}

export default function MarginCalculator({ entries }: { entries: any[] }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [coupon, setCoupon] = useState('');
  const [outputVat, setOutputVat] = useState('');
  const [importVat, setImportVat] = useState('');
  const [coupangFee, setCoupangFee] = useState('');
  const [ship, setShip] = useState('');
  const [ad, setAd] = useState('');
  const [etc, setEtc] = useState('');
  const [isPending, startTransition] = useTransition();

  const result = useMemo(() => {
    const lp = parseFloat(listPrice) || 0;
    const cp = parseFloat(coupon) || 0;
    const p = Math.max(0, lp - cp); // 실제 판매가 (쿠폰 할인 적용 후) - 이 값 기준으로 계산해야 마진이 정확함
    const c = parseFloat(cost) || 0; // 매입가 (부가세 제외)
    const ov = parseFloat(outputVat) || 0;
    const iv = parseFloat(importVat) || 0;
    const fee = parseFloat(coupangFee) || 0;
    const s = parseFloat(ship) || 0;
    const a = parseFloat(ad) || 0;
    const e = parseFloat(etc) || 0;
    // 판매가 - 매출부가세 - 매입가 + 매입부가세(매입세액공제로 돌려받으니
    // 다시 더함) - 쿠팡수수료 - 배송비 - (선택)광고비/기타. 각 항목은
    // 직접 입력값을 그대로 쓴다.
    const profit = p - ov - c + iv - fee - s - a - e;
    const marginPct = p > 0 ? (profit / p) * 100 : 0;
    return { lp, cp, p, c, ov, iv, fee, s, a, e, profit, marginPct };
  }, [cost, listPrice, coupon, outputVat, importVat, coupangFee, ship, ad, etc]);

  function handleSave() {
    startTransition(async () => {
      await addMarginEntry({
        name,
        price: result.p,
        cost: result.c,
        output_vat: result.ov,
        import_vat: result.iv,
        coupang_fee: result.fee,
        shipping: result.s,
        ad_cost: result.a,
        etc_cost: result.e,
        profit: result.profit,
        margin_pct: result.marginPct,
      });
      setName('');
      setCost('');
      setListPrice('');
      setCoupon('');
      setOutputVat('');
      setImportVat('');
      setCoupangFee('');
      setShip('');
      setAd('');
      setEtc('');
    });
  }

  const stampTone =
    result.marginPct < 0 ? 'border-red-600 text-red-600' :
    result.marginPct < 15 ? 'border-warn text-warn' :
    'border-profit text-profit';

  return (
    <div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-inkSoft mb-4">
            입력
          </h2>
          <div className="grid gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="상품명"
              className="border border-paperLine bg-white px-3 py-2 text-sm"
            />
            <label className="text-xs text-inkSoft -mb-2">정가 (쿠폰 적용 전)</label>
            <input
              value={listPrice}
              onChange={(e) => setListPrice(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">
              쿠폰 할인액 (선택)
            </label>
            <input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <div className="text-xs text-inkSoft -mb-2 flex justify-between">
              <span>→ 실제 판매가 (마진 계산 기준)</span>
              <span className="font-mono font-semibold text-ink">{fmt(result.p)}</span>
            </div>

            <SuggestField
              label="매출부가세"
              value={outputVat}
              onChange={setOutputVat}
              suggested={result.p / 11}
              suggestedLabel="판매가 ÷ 11"
            />

            <label className="text-xs text-inkSoft -mb-2">
              매입가 (중국에서 가져온 총액, 부가세 제외)
            </label>
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />

            <SuggestField
              label="매입부가세 (환급분)"
              hint="매입 송금 금액의 10% - 환차로 실제 값과 다를 수 있어요"
              value={importVat}
              onChange={setImportVat}
              suggested={result.c * 0.1}
              suggestedLabel="매입가의 10%"
            />

            <SuggestField
              label="쿠팡수수료 (수수료+결제수수료)"
              hint="카테고리마다 수수료율이 달라요 - 정산서 보고 입력해주세요"
              value={coupangFee}
              onChange={setCoupangFee}
              suggested={result.p * 0.086}
              suggestedLabel="판매가의 8.6% (참고용)"
            />

            <label className="text-xs text-inkSoft -mb-2">배송비</label>
            <input
              value={ship}
              onChange={(e) => setShip(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">
              광고비 (선택, 건당 평균)
            </label>
            <input
              value={ad}
              onChange={(e) => setAd(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">기타 비용 (선택)</label>
            <input
              value={etc}
              onChange={(e) => setEtc(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-inkSoft mb-4">
            결과
          </h2>
          <div className="flex justify-center mb-4">
            <div
              className={`w-28 h-28 rounded-full border-[3px] flex flex-col items-center justify-center -rotate-6 ${stampTone}`}
            >
              <span className="font-mono font-bold text-xl">
                {result.marginPct.toFixed(1)}%
              </span>
              <span className="text-[10px] uppercase tracking-wide mt-1">
                마진율
              </span>
            </div>
          </div>

          <div className="text-sm grid gap-1.5">
            {result.cp > 0 && (
              <>
                <Line label="정가" value={fmt(result.lp)} />
                <Line label="쿠폰 할인" value={'-' + fmt(result.cp)} />
              </>
            )}
            <Line label="실제 판매가" value={fmt(result.p)} />
            <Line label="매출부가세" value={'-' + fmt(result.ov)} />
            <Line label="매입가" value={'-' + fmt(result.c)} />
            <Line label="매입부가세" value={'+' + fmt(result.iv)} />
            <Line label="쿠팡수수료" value={'-' + fmt(result.fee)} />
            <Line label="배송비" value={'-' + fmt(result.s)} />
            {result.a > 0 && <Line label="광고비" value={'-' + fmt(result.a)} />}
            {result.e > 0 && <Line label="기타" value={'-' + fmt(result.e)} />}
            <div className="flex justify-between pt-2 mt-1 border-t-2 border-ink font-bold">
              <span>총마진</span>
              <span className={result.profit < 0 ? 'text-red-700' : 'text-profit'}>
                {(result.profit < 0 ? '-' : '') + fmt(Math.abs(result.profit))}
              </span>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={isPending || !name.trim() || result.p <= 0}
            className="btn-primary w-full py-2.5 text-sm font-semibold mt-5 disabled:opacity-40"
          >
            {isPending ? '저장 중...' : '이 계산 저장하기'}
          </button>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-lg font-bold">저장된 계산</h2>
          <span className="text-xs text-inkSoft">{entries.length}건</span>
        </div>
        <div className="grid gap-2">
          {entries.length ? (
            entries.map((e) => (
              <div
                key={e.id}
                className="card px-4 py-3 flex items-center gap-3 text-sm"
              >
                <span className="flex-1 font-medium truncate">{e.name}</span>
                <span className="font-mono text-xs text-inkSoft hidden sm:inline">
                  {fmt(e.price)}
                </span>
                <span
                  className={`font-mono text-xs ${
                    e.profit < 0 ? 'text-red-700' : 'text-profit'
                  }`}
                >
                  {(e.profit < 0 ? '-' : '') + fmt(Math.abs(e.profit))}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-mono ${badgeClass(
                    e.margin_pct
                  )}`}
                >
                  {Number(e.margin_pct).toFixed(1)}%
                </span>
                <button
                  onClick={() => startTransition(() => deleteMarginEntry(e.id))}
                  className="text-inkSoft hover:text-red-700 text-xs"
                >
                  삭제
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-inkSoft">
              아직 저장된 계산이 없어요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-inkSoft">
      <span>{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}
