'use client';

import { useState } from 'react';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

// 1688/알리바바는 위안/달러로 가격이 나오니, 현지 금액+환율을 넣으면
// 원화로 환산해준다. 등록/수정/옵션 추가 폼 세 군데서 공용으로 씀.
export default function FxCalculator({ onApply }: { onApply: (krw: number) => void }) {
  const [show, setShow] = useState(false);
  const [currency, setCurrency] = useState<'CNY' | 'USD'>('CNY');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('300');
  const result = (parseFloat(amount) || 0) * (parseFloat(rate) || 0);

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
    </div>
  );
}
