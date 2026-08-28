'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import {
  updateSourcingStatus,
  updateSourcingStage,
  updateSourcingItem,
  deleteSourcingItem,
} from '@/app/dashboard/sourcing/list/actions';

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

// 마진 계산기(components/MarginCalculator.tsx)와 완전히 동일한 공식.
// 쿠폰 할인, 매입원가, 배송비, 광고비, 기타비용까지 전부 반영해서
// 계산한다. 매출부가세/매입부가세/쿠팡수수료는 환차·프로모션·카테고리별
// 수수료 차이로 실제 정산액이 공식과 다를 수 있어서 자동계산하지 않고
// 사용자가 직접 입력한 값을 그대로 쓴다.
function computeMargin(it: any) {
  const lp = it.price ?? 0;
  const cp = it.coupon ?? 0;
  const p = Math.max(0, lp - cp);
  const c = it.cost ?? 0;
  const outputVat = it.output_vat ?? 0;
  const importVat = it.import_vat ?? 0;
  const fee = it.coupang_fee ?? 0;
  const s = it.shipping ?? 0;
  const a = it.ad_cost ?? 0;
  const e = it.etc_cost ?? 0;
  const profit = p - outputVat - c + importVat - fee - s - a - e;
  const marginPct = lp > 0 ? (profit / p) * 100 : null;
  return { lp, cp, p, c, s, a, e, fee, outputVat, importVat, profit, marginPct };
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

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          await updateSourcingItem(item.id, fd);
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
          type="number"
          step="0.01"
          defaultValue={item.price ?? ''}
          placeholder="판매가"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="cost"
          type="number"
          step="0.01"
          defaultValue={item.cost ?? ''}
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <input
          name="coupon"
          type="number"
          step="0.01"
          defaultValue={item.coupon ?? ''}
          placeholder="쿠폰 할인액"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="output_vat"
          type="number"
          step="0.01"
          defaultValue={item.output_vat ?? ''}
          placeholder="매출부가세"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="import_vat"
          type="number"
          step="0.01"
          defaultValue={item.import_vat ?? ''}
          placeholder="매입부가세"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="coupang_fee"
          type="number"
          step="0.01"
          defaultValue={item.coupang_fee ?? ''}
          placeholder="쿠팡수수료"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="shipping"
          type="number"
          step="0.01"
          defaultValue={item.shipping ?? ''}
          placeholder="배송비"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
        <input
          name="ad_cost"
          type="number"
          step="0.01"
          defaultValue={item.ad_cost ?? ''}
          placeholder="광고비"
          className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
        />
      </div>
      <input
        name="etc_cost"
        type="number"
        step="0.01"
        defaultValue={item.etc_cost ?? ''}
        placeholder="기타 비용"
        className="border border-paperLine bg-white px-3 py-2 text-sm font-mono"
      />
      <textarea
        name="content"
        defaultValue={item.content || ''}
        placeholder="메모"
        rows={2}
        className="border border-paperLine bg-white px-3 py-2 text-sm"
      />
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
                          마진 {m.marginPct.toFixed(1)}% {isMarginExpanded ? '▲' : '▼'}
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
