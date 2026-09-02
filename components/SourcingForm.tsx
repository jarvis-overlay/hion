'use client';

import { useRef, useState, useTransition } from 'react';
import { addSourcingItem, type ComparisonInput } from '@/app/dashboard/sourcing/list/actions';
import { useMarginFields } from '@/lib/useMarginFields';
import FxCalculator from '@/components/FxCalculator';
import { MarginDetailFields } from '@/components/MarginDetailFields';
import ComparisonEntryEditor, { MARKET_SIZE_LABEL } from '@/components/ComparisonEntryEditor';

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';
const PLATFORM_LABEL: Record<string, string> = { coupang: '쿠팡', naver: '네이버' };

export default function SourcingForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [showMarginDetail, setShowMarginDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonInput[]>([]);
  const [addingComparison, setAddingComparison] = useState(false);

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
              const res = await addSourcingItem(fd, comparisons);
              if ('error' in res) {
                setError(res.error);
                return;
              }
              formRef.current?.reset();
              f.reset();
              setComparisons([]);
              setAddingComparison(false);
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
                <span className="text-inkSoft">예상 마진 (광고비 적용)</span>
                <span className={`font-mono font-semibold ${f.margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
                  {(f.margin.profit < 0 ? '-' : '') + fmt(Math.abs(f.margin.profit))}
                  {f.margin.marginPct != null && ` (${f.margin.marginPct.toFixed(1)}%)`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-inkSoft text-xs">예상 마진 (광고비 미적용)</span>
                <span className="font-mono text-xs text-inkSoft">
                  {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
                  {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
                </span>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-inkSoft">
                비교 상품군 링크 {comparisons.length > 0 && `(${comparisons.length})`}
              </span>
              <button
                type="button"
                onClick={() => setAddingComparison((v) => !v)}
                className="text-xs text-accent font-semibold"
              >
                {addingComparison ? '닫기' : '+ 비교 상품 추가'}
              </button>
            </div>

            {comparisons.length > 0 && (
              <div className="grid gap-1.5">
                {comparisons.map((c, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 text-xs bg-paper rounded px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-ink truncate">{c.title || '(이름 없음)'}</span>
                        {c.link && <span className="text-profit truncate shrink-0">[링크]</span>}
                      </div>
                      {c.prices.length > 0 && (
                        <p className="text-inkSoft mt-0.5">
                          {c.prices
                            .map(
                              (p) =>
                                `${PLATFORM_LABEL[p.platform]} ${p.priceRange || '가격대 미입력'}${
                                  p.marketSize ? ` (규모 ${MARKET_SIZE_LABEL[p.marketSize]})` : ''
                                }`
                            )
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setComparisons(comparisons.filter((_, j) => j !== i))}
                      className="text-inkSoft hover:text-red-700 shrink-0"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}

            {addingComparison && (
              <ComparisonEntryEditor
                onSave={(c) => {
                  setComparisons([...comparisons, c]);
                  setAddingComparison(false);
                }}
              />
            )}
          </div>

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
