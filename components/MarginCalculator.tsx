'use client';

import { useMemo, useState, useTransition } from 'react';
import { addMarginEntry, deleteMarginEntry } from '@/app/dashboard/margin/actions';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

function badgeClass(pct: number) {
  if (pct < 0) return 'bg-red-100 text-red-700';
  if (pct < 15) return 'bg-warnBg text-warn';
  return 'bg-profitBg text-profit';
}

export default function MarginCalculator({ entries }: { entries: any[] }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [feeRate, setFeeRate] = useState('10.8');
  const [ship, setShip] = useState('');
  const [ad, setAd] = useState('');
  const [etc, setEtc] = useState('');
  const [isPending, startTransition] = useTransition();

  const result = useMemo(() => {
    const p = parseFloat(price) || 0;
    const c = parseFloat(cost) || 0;
    const fr = parseFloat(feeRate) || 0;
    const s = parseFloat(ship) || 0;
    const a = parseFloat(ad) || 0;
    const e = parseFloat(etc) || 0;
    const fee = p * (fr / 100);
    const profit = p - (c + s + a + e + fee);
    const marginPct = p > 0 ? (profit / p) * 100 : 0;
    return { p, c, fr, s, a, e, fee, profit, marginPct };
  }, [name, cost, price, feeRate, ship, ad, etc]);

  function handleSave() {
    startTransition(async () => {
      await addMarginEntry({
        name,
        price: result.p,
        cost: result.c,
        fee_rate: result.fr,
        shipping: result.s,
        ad_cost: result.a,
        etc_cost: result.e,
        profit: result.profit,
        margin_pct: result.marginPct,
      });
      setName('');
      setCost('');
      setPrice('');
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
            <label className="text-xs text-inkSoft -mb-2">원가 (사입가)</label>
            <input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">판매가</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">
              플랫폼 수수료율 (%)
            </label>
            <input
              value={feeRate}
              onChange={(e) => setFeeRate(e.target.value)}
              type="number"
              step="0.1"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">택배비 + 포장비</label>
            <input
              value={ship}
              onChange={(e) => setShip(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">
              광고비 (건당 평균)
            </label>
            <input
              value={ad}
              onChange={(e) => setAd(e.target.value)}
              type="number"
              placeholder="0"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <label className="text-xs text-inkSoft -mb-2">기타 비용</label>
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
            <Line label="판매가" value={fmt(result.p)} />
            <Line label="수수료" value={'-' + fmt(result.fee)} />
            <Line label="원가" value={'-' + fmt(result.c)} />
            <Line label="택배·포장" value={'-' + fmt(result.s)} />
            <Line label="광고비" value={'-' + fmt(result.a)} />
            <Line label="기타" value={'-' + fmt(result.e)} />
            <div className="flex justify-between pt-2 mt-1 border-t-2 border-ink font-bold">
              <span>순이익</span>
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
