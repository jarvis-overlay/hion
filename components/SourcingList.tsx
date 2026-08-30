'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  updateSourcingStatus,
  updateSourcingStage,
  updateSourcingItem,
  deleteSourcingItem,
} from '@/app/dashboard/sourcing/list/actions';
import { computeMargin as computeMarginShared } from '@/lib/marginCalc';

const STATUS_LABEL: Record<string, string> = {
  checking: '검토중',
  ordered: '발주완료',
  hold: '보류',
};

const STATUS_STYLE: Record<string, string> = {
  checking: 'bg-warnBg text-warn',
  ordered: 'bg-profitBg text-profit',
  hold: 'bg-paperLine text-inkSoft',
};

const STAGE_LABEL: Record<string, string> = {
  candidate: '후보',
  confirmed: '확정',
};

const STAGE_STYLE: Record<string, string> = {
  candidate: 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine',
  confirmed: 'bg-accentBg text-accent ring-1 ring-inset ring-accent/20',
};

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원';

// 마진 계산기 페이지와 완전히 동일한 공식(lib/marginCalc.ts 공용).
// 매출부가세/매입부가세/쿠팡수수료는 환차·프로모션·카테고리별 수수료
// 차이로 실제 정산액이 공식과 다를 수 있어서 자동계산하지 않고 사용자가
// 직접 입력한 값을 그대로 쓴다.
function computeMargin(it: any) {
  const result = computeMarginShared({
    price: it.price ?? null,
    coupon: it.coupon ?? null,
    cost: it.cost ?? null,
    outputVat: it.output_vat ?? null,
    importVat: it.import_vat ?? null,
    coupangFee: it.coupang_fee ?? null,
    shipping: it.shipping ?? null,
    adCost: it.ad_cost ?? null,
    etcCost: it.etc_cost ?? null,
  });
  return {
    p: result.actualPrice,
    c: it.cost ?? 0,
    fee: it.coupang_fee ?? 0,
    outputVat: it.output_vat ?? 0,
    importVat: it.import_vat ?? 0,
    s: it.shipping ?? 0,
    a: it.ad_cost ?? 0,
    e: it.etc_cost ?? 0,
    profit: result.profit,
    marginPct: result.marginPct,
  };
}

function marginBadgeClass(pct: number) {
  if (pct < 0) return 'bg-red-100 text-red-700';
  if (pct < 15) return 'bg-warnBg text-warn';
  return 'bg-profitBg text-profit';
}

type SortKey = 'created_desc' | 'created_asc' | 'price_desc' | 'price_asc' | 'margin_desc' | 'margin_asc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'created_desc', label: '최신 등록순' },
  { value: 'created_asc', label: '오래된 등록순' },
  { value: 'price_desc', label: '판매가 높은순' },
  { value: 'price_asc', label: '판매가 낮은순' },
  { value: 'margin_desc', label: '마진율 높은순' },
  { value: 'margin_asc', label: '마진율 낮은순' },
];

function num(v: string): number | null {
  if (v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function EditForm({ item, onDone }: { item: any; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  const [cost, setCost] = useState(item.cost != null ? String(item.cost) : '');
  const [coupon, setCoupon] = useState(item.coupon != null ? String(item.coupon) : '');
  const [outputVat, setOutputVat] = useState(item.output_vat != null ? String(item.output_vat) : '');
  const [importVat, setImportVat] = useState(item.import_vat != null ? String(item.import_vat) : '');
  const [coupangFee, setCoupangFee] = useState(item.coupang_fee != null ? String(item.coupang_fee) : '');
  const [shipping, setShipping] = useState(item.shipping != null ? String(item.shipping) : '');
  const [adCost, setAdCost] = useState(item.ad_cost != null ? String(item.ad_cost) : '');
  const [etcCost, setEtcCost] = useState(item.etc_cost != null ? String(item.etc_cost) : '');

  const [showFxCalc, setShowFxCalc] = useState(false);
  const [fxCurrency, setFxCurrency] = useState<'CNY' | 'USD'>('CNY');
  const [fxAmount, setFxAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const fxResult = (parseFloat(fxAmount) || 0) * (parseFloat(fxRate) || 0);

  const margin = useMemo(
    () =>
      computeMarginShared({
        price: num(price),
        coupon: num(coupon),
        cost: num(cost),
        outputVat: num(outputVat),
        importVat: num(importVat),
        coupangFee: num(coupangFee),
        shipping: num(shipping),
        adCost: num(adCost),
        etcCost: num(etcCost),
      }),
    [price, cost, coupon, outputVat, importVat, coupangFee, shipping, adCost, etcCost]
  );

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = await updateSourcingItem(item.id, fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          onDone();
        })
      }
      className="grid gap-3"
    >
      <input
        name="title"
        defaultValue={item.title}
        required
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <input
        name="link"
        defaultValue={item.link || ''}
        placeholder="소싱 링크"
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-3 gap-3">
        <input
          name="price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          type="number"
          step="0.01"
          placeholder="판매가"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="cost"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="매입 원가"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="moq"
          defaultValue={item.moq || ''}
          placeholder="MOQ"
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        />
      </div>

      <button
        type="button"
        onClick={() => setShowFxCalc((v) => !v)}
        className="text-left text-xs font-semibold text-inkSoft hover:text-ink flex items-center gap-1"
      >
        <span className={`transition-transform ${showFxCalc ? 'rotate-90' : ''}`}>▸</span>
        환율로 매입 원가 계산하기
      </button>
      {showFxCalc && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
          <select
            value={fxCurrency}
            onChange={(e) => setFxCurrency(e.target.value as 'CNY' | 'USD')}
            className="border border-paperLine bg-white px-2 py-2 text-sm"
          >
            <option value="CNY">위안 (CNY)</option>
            <option value="USD">달러 (USD)</option>
          </select>
          <input
            value={fxAmount}
            onChange={(e) => setFxAmount(e.target.value)}
            type="number"
            step="0.01"
            placeholder="현지 금액"
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
          <input
            value={fxRate}
            onChange={(e) => setFxRate(e.target.value)}
            type="number"
            step="0.01"
            placeholder="적용 환율 (예: 190)"
            className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => setCost(fxResult ? String(Math.round(fxResult)) : '')}
            disabled={!fxResult}
            className="btn-primary px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {fxResult ? `${fmt(fxResult)} 적용` : '금액/환율 입력'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <input
          name="coupon"
          value={coupon}
          onChange={(e) => setCoupon(e.target.value)}
          type="number"
          step="0.01"
          placeholder="쿠폰 할인액 (선택)"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="output_vat"
          value={outputVat}
          onChange={(e) => setOutputVat(e.target.value)}
          type="number"
          step="0.01"
          placeholder="매출부가세"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="import_vat"
          value={importVat}
          onChange={(e) => setImportVat(e.target.value)}
          type="number"
          step="0.01"
          placeholder="매입부가세"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="coupang_fee"
          value={coupangFee}
          onChange={(e) => setCoupangFee(e.target.value)}
          type="number"
          step="0.01"
          placeholder="쿠팡수수료"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="shipping"
          value={shipping}
          onChange={(e) => setShipping(e.target.value)}
          type="number"
          step="0.01"
          placeholder="배송비"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="ad_cost"
          value={adCost}
          onChange={(e) => setAdCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="광고비 (선택)"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="etc_cost"
          value={etcCost}
          onChange={(e) => setEtcCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="기타 비용"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
      </div>

      {price && (
        <div className="flex items-center justify-between rounded-md bg-paper px-3 py-2 text-sm">
          <span className="text-inkSoft">예상 마진</span>
          <span className={`font-mono font-semibold ${margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
            {(margin.profit < 0 ? '-' : '') + fmt(Math.abs(margin.profit))}
            {margin.marginPct != null && ` (${margin.marginPct.toFixed(1)}%)`}
          </span>
        </div>
      )}

      <textarea
        name="content"
        defaultValue={item.content || ''}
        placeholder="메모"
        rows={2}
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
      {error && (
        <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">저장 실패: {error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"
        >
          {isPending ? '저장 중...' : '저장'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-4 py-2 text-xs font-semibold text-inkSoft ring-1 ring-paperLine rounded"
        >
          취소
        </button>
      </div>
    </form>
  );
}

export default function SourcingList({ items }: { items: any[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_desc');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedMarginId, setExpandedMarginId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const rows = useMemo(() => {
    const withMargin = items.map((it) => ({ ...it, margin: computeMargin(it) }));

    const q = search.trim().toLowerCase();
    const filtered = withMargin.filter((it) => {
      if (statusFilter !== 'all' && (it.status || 'checking') !== statusFilter) return false;
      if (stageFilter !== 'all' && (it.stage || 'candidate') !== stageFilter) return false;
      if (!q) return true;
      return (
        it.title?.toLowerCase().includes(q) ||
        it.content?.toLowerCase().includes(q) ||
        it.link?.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'created_asc':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'price_desc':
          return (b.price ?? -Infinity) - (a.price ?? -Infinity);
        case 'price_asc':
          return (a.price ?? Infinity) - (b.price ?? Infinity);
        case 'margin_desc':
          return (b.margin.marginPct ?? -Infinity) - (a.margin.marginPct ?? -Infinity);
        case 'margin_asc':
          return (a.margin.marginPct ?? Infinity) - (b.margin.marginPct ?? Infinity);
        case 'created_desc':
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return sorted;
  }, [items, search, statusFilter, stageFilter, sortKey]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="상품명 · 메모 · 링크 검색"
          className="border border-paperLine bg-white px-3 py-2 text-sm flex-1 min-w-[180px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">상태 전체</option>
          <option value="checking">검토중</option>
          <option value="ordered">발주완료</option>
          <option value="hold">보류</option>
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">후보/확정 전체</option>
          <option value="candidate">후보</option>
          <option value="confirmed">확정</option>
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-inkSoft">
          {items.length === 0 ? '아직 등록된 소싱 후보가 없어요.' : '조건에 맞는 항목이 없어요.'}
        </p>
      ) : (
        <div className="card divide-y divide-paperLine overflow-hidden">
          {rows.map((it) => {
            const status = it.status || 'checking';
            const stage = it.stage || 'candidate';
            const m = it.margin;
            const isEditing = editingId === it.id;
            const isMarginExpanded = expandedMarginId === it.id;

            if (isEditing) {
              return (
                <div key={it.id} className="p-4">
                  <EditForm item={it} onDone={() => setEditingId(null)} />
                </div>
              );
            }

            return (
              <div key={it.id} className="p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-sm">{it.title}</h3>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[status]}`}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${STAGE_STYLE[stage]}`}
                      >
                        {STAGE_LABEL[stage]}
                      </span>
                      {m.marginPct != null && (
                        <button
                          onClick={() => setExpandedMarginId(isMarginExpanded ? null : it.id)}
                          className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${marginBadgeClass(m.marginPct)}`}
                        >
                          마진 {fmt(m.profit)} ({m.marginPct.toFixed(1)}%) {isMarginExpanded ? '▲' : '▼'}
                        </button>
                      )}
                    </div>
                    {it.link && (
                      <a
                        href={it.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-profit underline break-all"
                      >
                        {it.link}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex gap-4 text-xs text-inkSoft font-mono">
                  {it.price != null && <span>판매가 {it.price.toLocaleString()}</span>}
                  {it.cost != null && <span>원가 {it.cost.toLocaleString()}</span>}
                  {it.moq && <span>MOQ {it.moq}</span>}
                </div>

                {isMarginExpanded && m.marginPct != null && (
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs bg-paper rounded-md px-3 py-2">
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">실판매가</dt>
                      <dd className="font-mono">{fmt(m.p)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">매입원가</dt>
                      <dd className="font-mono">{fmt(m.c)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">쿠팡수수료</dt>
                      <dd className="font-mono">-{fmt(m.fee)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">매출부가세</dt>
                      <dd className="font-mono">-{fmt(m.outputVat)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">매입부가세 환급</dt>
                      <dd className="font-mono">+{fmt(m.importVat)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-inkSoft">배송·광고·기타</dt>
                      <dd className="font-mono">-{fmt(m.s + m.a + m.e)}</dd>
                    </div>
                    <div className="flex justify-between gap-2 col-span-2 sm:col-span-3 pt-1 border-t border-paperLine font-semibold">
                      <dt>순이익</dt>
                      <dd className="font-mono">{fmt(m.profit)}</dd>
                    </div>
                  </dl>
                )}

                {it.content && <p className="text-xs text-ink">{it.content}</p>}

                <div className="flex items-center justify-between mt-1 pt-2 border-t border-paperLine">
                  <span className="text-[11px] text-inkSoft">
                    {it.author_email?.split('@')[0]} ·{' '}
                    {new Date(it.created_at).toLocaleDateString('ko-KR')}
                  </span>
                  <div className="flex gap-2 text-xs items-center">
                    <select
                      value={stage}
                      disabled={isPending}
                      onChange={(e) =>
                        startTransition(() => updateSourcingStage(it.id, e.target.value))
                      }
                      className="border border-paperLine bg-white text-xs px-1 py-0.5"
                    >
                      <option value="candidate">후보</option>
                      <option value="confirmed">확정</option>
                    </select>
                    <select
                      value={status}
                      disabled={isPending}
                      onChange={(e) =>
                        startTransition(() => updateSourcingStatus(it.id, e.target.value))
                      }
                      className="border border-paperLine bg-white text-xs px-1 py-0.5"
                    >
                      <option value="checking">검토중</option>
                      <option value="ordered">발주완료</option>
                      <option value="hold">보류</option>
                    </select>
                    <button onClick={() => setEditingId(it.id)} className="text-inkSoft hover:text-ink">
                      수정
                    </button>
                    <button
                      onClick={() => startTransition(() => deleteSourcingItem(it.id))}
                      className="text-inkSoft hover:text-red-700"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
