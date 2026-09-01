'use client';

import { useRef, useState, useTransition } from 'react';
import { addSourcingItem } from '@/app/dashboard/sourcing/list/actions';
import { useMarginFields } from '@/lib/useMarginFields';
import FxCalculator from '@/components/FxCalculator';
import { MarginDetailFields } from '@/components/MarginDetailFields';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

export default function SourcingForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [showMarginDetail, setShowMarginDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const f = useMarginFields();

  return (
    <div className="card p-5 mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-sm font-semibold"
      >
        <span>소싱 후보 등록</span>
        <span className={`text-inkSoft transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && (
        <form
          ref={formRef}
          action={(fd) =>
            startTransition(async () => {
              setError(null);
              const res = await addSourcingItem(fd);
              if ('error' in res) {
                setError(res.error);
                return;
              }
              formRef.current?.reset();
              f.reset();
              setOpen(false);
              setShowMarginDetail(false);
            })
          }
          className="grid gap-3 mt-4"
        >
          <input
            name="title"
            placeholder="상품명 / 후보 이름"
            required
            className="border border-paperLine bg-white px-3 py-2 text-sm"
          />
          <input
            name="link"
            placeholder="소싱 링크 (1688, 알리바바 등)"
            className="border border-paperLine bg-white px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <input
              name="price"
              value={f.price}
              onChange={(e) => f.setPrice(e.target.value)}
              type="number"
              step="0.01"
              placeholder="판매가"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <input
              readOnly
              name="output_vat"
              value={f.price !== '' ? Math.round(f.outputVat) : ''}
              placeholder="매출부가세 (자동)"
              title="판매가 / 11로 자동 계산돼요"
              className="border border-paperLine bg-paper text-inkSoft px-3 py-2 text-sm font-mono cursor-not-allowed"
            />
            <input
              name="cost"
              value={f.cost}
              onChange={(e) => f.setCost(e.target.value)}
              type="number"
              step="0.01"
              placeholder="매입 원가"
              className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
            />
            <input
              name="moq"
              placeholder="MOQ"
              className="border border-paperLine bg-white px-3 py-2 text-sm"
            />
          </div>

          <FxCalculator onApply={(krw) => f.setCost(String(Math.round(krw)))} />

          <button
            type="button"
            onClick={() => setShowMarginDetail((v) => !v)}
            className="text-left text-xs font-semibold text-inkSoft hover:text-ink flex items-center gap-1"
          >
            <span className={`transition-transform ${showMarginDetail ? 'rotate-90' : ''}`}>▸</span>
            마진 상세 항목 (쿠폰, 매입부가세, 쿠팡수수료율, 배송비, 광고비 등)
          </button>
          {showMarginDetail && <MarginDetailFields fields={f} />}

          {f.price && (
            <div className="rounded-md bg-paper px-3 py-2 text-sm grid gap-1">
              <div className="flex items-center justify-between">
                <span className="text-inkSoft">예상 마진</span>
                <span className={`font-mono font-semibold ${f.margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
                  {(f.margin.profit < 0 ? '-' : '') + fmt(Math.abs(f.margin.profit))}
                  {f.margin.marginPct != null && ` (${f.margin.marginPct.toFixed(1)}%)`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-inkSoft text-xs">순수 마진 (광고비 제외)</span>
                <span className="font-mono text-xs text-inkSoft">
                  {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
                  {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
                </span>
              </div>
            </div>
          )}

          <textarea
            name="content"
            placeholder="메모 (품질, 배송, 협상 상황 등)"
            rows={2}
            className="border border-paperLine bg-white px-3 py-2 text-sm"
          />
          {error && (
            <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">
              등록 실패: {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {isPending ? '등록 중...' : '소싱 후보 등록'}
          </button>
        </form>
      )}
    </div>
  );
}
