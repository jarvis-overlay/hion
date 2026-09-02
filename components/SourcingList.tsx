'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  updateSourcingStatus,
  updateSourcingStage,
  updateSourcingItem,
  deleteSourcingItem,
  addSourcingOption,
  deleteSourcingOption,
  addSourcingSupplier,
  deleteSourcingSupplier,
} from '@/app/dashboard/sourcing/list/actions';
import { computeMargin as computeMarginShared } from '@/lib/marginCalc';
import { useMarginFields } from '@/lib/useMarginFields';
import FxCalculator from '@/components/FxCalculator';
import { MarginDetailFields } from '@/components/MarginDetailFields';

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

function EditForm({ item, onDone }: { item: any; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const f = useMarginFields({
    price: item.price,
    cost: item.cost,
    coupon: item.coupon,
    importVat: item.import_vat,
    // 기존에 저장된 쿠팡수수료/광고비 금액으로부터 역산한 비율을
    // 기본값으로 보여준다 - 실제 판매가가 있어야 역산 가능, 없으면 각각
    // 기본 8.6%/10%.
    feeRatePct:
      item.price && item.coupang_fee != null
        ? Number(((item.coupang_fee / (item.price - (item.coupon || 0))) * 100).toFixed(2))
        : null,
    adRatePct:
      item.price && item.ad_cost != null
        ? Number(((item.ad_cost / (item.price - (item.coupon || 0))) * 100).toFixed(2))
        : null,
    shipping: item.shipping,
    etcCost: item.etc_cost,
  });

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
          defaultValue={item.moq || ''}
          placeholder="MOQ"
          className="border border-paperLine bg-white px-3 py-2 text-sm"
        />
      </div>

      <FxCalculator onApply={(krw) => f.setCost(String(Math.round(krw)))} />

      <MarginDetailFields fields={f} />

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

// 같은 상품이라도 색상/사이즈 등 옵션마다 가격·원가가 달라서 마진을
// 따로 계산해야 한다는 요청으로 추가함.
function OptionAddForm({ sourcingItemId, onDone }: { sourcingItemId: string; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const f = useMarginFields();

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = await addSourcingOption(sourcingItemId, fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          formRef.current?.reset();
          f.reset();
          onDone();
        })
      }
      className="grid gap-2 bg-paper rounded-md p-3"
    >
      <input
        name="name"
        placeholder="옵션명 (예: 블랙/L)"
        required
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      <div className="grid grid-cols-3 gap-2">
        <input
          name="price"
          value={f.price}
          onChange={(e) => f.setPrice(e.target.value)}
          type="number"
          step="0.01"
          placeholder="판매가"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
        />
        <input
          readOnly
          name="output_vat"
          value={f.price !== '' ? Math.round(f.outputVat) : ''}
          placeholder="매출부가세(자동)"
          title="판매가 / 11로 자동 계산돼요"
          className="border border-paperLine bg-paper text-inkSoft px-2 py-1.5 text-xs font-mono cursor-not-allowed"
        />
        <input
          name="cost"
          value={f.cost}
          onChange={(e) => f.setCost(e.target.value)}
          type="number"
          step="0.01"
          placeholder="매입 원가"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono"
        />
      </div>

      <FxCalculator onApply={(krw) => f.setCost(String(Math.round(krw)))} />

      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="text-left text-[11px] font-semibold text-inkSoft hover:text-ink flex items-center gap-1"
      >
        <span className={`transition-transform ${showDetail ? 'rotate-90' : ''}`}>▸</span>
        마진 상세 항목
      </button>
      {showDetail && <MarginDetailFields fields={f} compact />}

      {f.price && (
        <div className="text-xs grid gap-0.5">
          <div className="flex items-center justify-between">
            <span className="text-inkSoft">예상 마진 (광고비 적용)</span>
            <span className={`font-mono font-semibold ${f.margin.profit < 0 ? 'text-red-700' : 'text-profit'}`}>
              {(f.margin.profit < 0 ? '-' : '') + fmt(Math.abs(f.margin.profit))}
              {f.margin.marginPct != null && ` (${f.margin.marginPct.toFixed(1)}%)`}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-inkSoft text-[11px]">예상 마진 (광고비 미적용)</span>
            <span className="font-mono text-[11px] text-inkSoft">
              {(f.pureProfit < 0 ? '-' : '') + fmt(Math.abs(f.pureProfit))}
              {f.pureMarginPct != null && ` (${f.pureMarginPct.toFixed(1)}%)`}
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {isPending ? '추가 중...' : '옵션 추가'}
      </button>
    </form>
  );
}

function OptionsSection({ item }: { item: any }) {
  const [adding, setAdding] = useState(false);
  const [isPending, startTransition] = useTransition();
  const options: any[] = item.sourcing_item_options || [];

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-inkSoft">옵션 구성 ({options.length})</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs text-accent font-semibold"
        >
          {adding ? '닫기' : '+ 옵션 추가'}
        </button>
      </div>

      {options.length > 0 && (
        <div className="grid gap-1.5 mb-2">
          {options.map((o) => {
            const m = computeMarginShared({
              price: o.price ?? null,
              coupon: o.coupon ?? null,
              cost: o.cost ?? null,
              outputVat: o.output_vat ?? null,
              importVat: o.import_vat ?? null,
              coupangFee: o.coupang_fee ?? null,
              shipping: o.shipping ?? null,
              adCost: o.ad_cost ?? null,
              etcCost: o.etc_cost ?? null,
            });
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 text-xs bg-paper rounded px-2 py-1.5">
                <span className="font-medium truncate">{o.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {o.price != null && <span className="font-mono text-inkSoft">{o.price.toLocaleString()}원</span>}
                  {m.marginPct != null && (
                    <span className={`px-1.5 py-0.5 rounded-full ${marginBadgeClass(m.marginPct)}`}>
                      {fmt(m.profit)} ({m.marginPct.toFixed(1)}%)
                    </span>
                  )}
                  <button
                    onClick={() => startTransition(() => deleteSourcingOption(o.id))}
                    disabled={isPending}
                    className="text-inkSoft hover:text-red-700"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && <OptionAddForm sourcingItemId={item.id} onDone={() => setAdding(false)} />}
    </div>
  );
}

const CURRENCY_LABEL: Record<string, string> = { CNY: '¥', USD: '$', KRW: '₩' };

// 하나의 상품을 소싱할 때 여러 1688/알리바바 공급처를 비교하면서
// 찾는 경우가 있다는 요청으로 추가함 - 링크+가격을 여러 개 저장.
function SupplierAddForm({ sourcingItemId, onDone }: { sourcingItemId: string; onDone: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          setError(null);
          const res = await addSourcingSupplier(sourcingItemId, fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          formRef.current?.reset();
          onDone();
        })
      }
      className="grid gap-2 bg-paper rounded-md p-3"
    >
      <input
        name="link"
        placeholder="공급처 링크 (1688, 알리바바 등)"
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      <div className="grid grid-cols-3 gap-2">
        <select name="currency" defaultValue="CNY" className="border border-paperLine bg-white px-2 py-1.5 text-xs">
          <option value="CNY">위안 (CNY)</option>
          <option value="USD">달러 (USD)</option>
          <option value="KRW">원 (KRW)</option>
        </select>
        <input
          name="price"
          type="number"
          step="0.01"
          placeholder="가격"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs font-mono col-span-2"
        />
      </div>
      <input
        name="notes"
        placeholder="메모 (MOQ, 품질 등, 선택)"
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      {error && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="btn-primary py-1.5 text-xs font-semibold disabled:opacity-50"
      >
        {isPending ? '추가 중...' : '공급처 추가'}
      </button>
    </form>
  );
}

function SuppliersSection({ item }: { item: any }) {
  const [adding, setAdding] = useState(false);
  const [isPending, startTransition] = useTransition();
  const suppliers: any[] = item.sourcing_item_suppliers || [];
  // 가격 비교가 목적이니 싼 순으로 정렬 (가격 없는 건 뒤로)
  const sorted = [...suppliers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  const minPrice = sorted.find((s) => s.price != null)?.price;

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-inkSoft">공급처 비교 ({suppliers.length})</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs text-accent font-semibold"
        >
          {adding ? '닫기' : '+ 공급처 추가'}
        </button>
      </div>

      {sorted.length > 0 && (
        <div className="grid gap-1.5 mb-2">
          {sorted.map((s) => (
            <div
              key={s.id}
              className={`flex items-center justify-between gap-2 text-xs rounded px-2 py-1.5 ${
                s.price != null && s.price === minPrice ? 'bg-accentBg' : 'bg-paper'
              }`}
            >
              <div className="min-w-0 flex-1">
                {s.link ? (
                  <a href={s.link} target="_blank" rel="noreferrer" className="text-profit underline">
                    [링크]
                  </a>
                ) : (
                  <span className="text-inkSoft">링크 없음</span>
                )}
                {s.notes && <p className="text-inkSoft mt-0.5">{s.notes}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s.price != null && (
                  <span className="font-mono">
                    {CURRENCY_LABEL[s.currency] || ''}
                    {s.price.toLocaleString()}
                  </span>
                )}
                <button
                  onClick={() => startTransition(() => deleteSourcingSupplier(s.id))}
                  disabled={isPending}
                  className="text-inkSoft hover:text-red-700"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && <SupplierAddForm sourcingItemId={item.id} onDone={() => setAdding(false)} />}
    </div>
  );
}

export default function SourcingList({ items }: { items: any[] }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_desc');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedMarginId, setExpandedMarginId] = useState<string | null>(null);
  const [expandedOptionsId, setExpandedOptionsId] = useState<string | null>(null);
  const [expandedSuppliersId, setExpandedSuppliersId] = useState<string | null>(null);
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
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="border border-paperLine bg-white px-2 py-2 text-sm"
        >
          <option value="all">후보/확정 전체</option>
          <option value="candidate">후보</option>
          <option value="confirmed">확정</option>
        </select>
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
            const isOptionsExpanded = expandedOptionsId === it.id;
            const isSuppliersExpanded = expandedSuppliersId === it.id;
            const optionCount = (it.sourcing_item_options || []).length;
            const supplierCount = (it.sourcing_item_suppliers || []).length;

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
                        className="text-xs text-profit underline"
                      >
                        [링크]
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

                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => setExpandedOptionsId(isOptionsExpanded ? null : it.id)}
                    className="text-inkSoft hover:text-ink ring-1 ring-paperLine rounded-full px-2.5 py-1"
                  >
                    옵션 구성 {optionCount > 0 && `(${optionCount})`} {isOptionsExpanded ? '▲' : '▼'}
                  </button>
                  <button
                    onClick={() => setExpandedSuppliersId(isSuppliersExpanded ? null : it.id)}
                    className="text-inkSoft hover:text-ink ring-1 ring-paperLine rounded-full px-2.5 py-1"
                  >
                    공급처 비교 {supplierCount > 0 && `(${supplierCount})`} {isSuppliersExpanded ? '▲' : '▼'}
                  </button>
                </div>

                {isOptionsExpanded && <OptionsSection item={it} />}
                {isSuppliersExpanded && <SuppliersSection item={it} />}

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
