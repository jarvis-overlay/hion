'use client';

import { useEffect, useState } from 'react';
import { getFxRates } from '@/app/dashboard/sourcing/list/fxActions';
import type { FxRates } from '@/lib/fx';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';
const fmtRate = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });

// 1688/알리바바는 위안/달러로 가격이 나오니, 현지 금액+환율을 넣으면
// 원화로 환산해준다. 등록/수정/옵션 추가 폼 세 군데서 공용으로 씀.
export default function FxCalculator({ onApply }: { onApply: (krw: number) => void }) {
  const [show, setShow] = useState(false);
  const [currency, setCurrency] = useState<'CNY' | 'USD'>('CNY');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('300');
  const [liveRates, setLiveRates] = useState<FxRates | null>(null);
  const [loadingRates, setLoadingRates] = useState(false);
  const [ratesFailed, setRatesFailed] = useState(false);
  const result = (parseFloat(amount) || 0) * (parseFloat(rate) || 0);

  // 계산기를 펼칠 때 한 번만 실시간 환율을 조회한다 (ECB 기준환율 -
  // 완전한 실시간은 아니고 영업일마다 갱신되지만, 무료/키불필요로 얻을
  // 수 있는 가장 최신 환율). 조회에 실패해도 직접 입력은 그대로 되므로
  // 폼 사용을 막지 않는다.
  useEffect(() => {
    if (!show || liveRates || loadingRates) return;
    setLoadingRates(true);
    getFxRates()
      .then((r) => {
        if (r) setLiveRates(r);
        else setRatesFailed(true);
      })
      .catch(() => setRatesFailed(true))
      .finally(() => setLoadingRates(false));
  }, [show, liveRates, loadingRates]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-left text-xs font-semibold text-inkSoft hover:text-ink flex items-center gap-1"
      >
        <span className={`transition-transform ${show ? 'rotate-90' : ''}`}>▸</span>
        환율로 매입 원가 계산하기
      </button>
      {show && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center mt-2">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as 'CNY' | 'USD')}
            className="border border-paperLine bg-white px-2 py-2 text-sm"
          >
            <option value="CNY">위안 (CNY)</option>
            <option value="USD">달러 (USD)</option>
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.01"
            placeholder="현지 금액"
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            type="number"
            step="0.01"
            placeholder="적용 환율 (예: 190)"
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => onApply(result)}
            disabled={!result}
            className="btn-primary px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {result ? `${fmt(result)} 적용` : '금액/환율 입력'}
          </button>
        </div>
      )}
      {show && (
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-inkSoft">
          {loadingRates && <span>실시간 환율 조회 중...</span>}
          {!loadingRates && liveRates && (
            <>
              <span>
                실시간 환율 - 1 CNY {fmtRate(liveRates.CNY)}원 · 1 USD {fmtRate(liveRates.USD)}원 (
                {liveRates.date} 기준)
              </span>
              <button
                type="button"
                onClick={() => setRate(String(liveRates[currency]))}
                className="text-accent font-semibold underline"
              >
                이 환율 적용
              </button>
            </>
          )}
          {!loadingRates && !liveRates && ratesFailed && (
            <span>실시간 환율 조회 실패 - 환율은 직접 입력해주세요.</span>
          )}
        </div>
      )}
    </div>
  );
}
