'use client';

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { toggleProductVisibility } from '@/app/dashboard/inventory/stock/actions';
import {
  RISK_LABEL,
  riskPriorityOf,
  type ProductFilter,
  type ProductStat,
  type StockStatsResult,
} from '@/lib/stockStats';
import { MiniBars, RiskChips, daysLeftText, fmt, fmt1 } from './shared';

type SortKey = 'risk' | 'name' | 'coupangStock' | 'ownStock' | 'sold7' | 'sold30' | 'amount30' | 'daysLeft';

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right'; defaultDir: 'asc' | 'desc' }[] = [
  { key: 'name', label: '상품', align: 'left', defaultDir: 'asc' },
  { key: 'coupangStock', label: '쿠팡 재고', align: 'right', defaultDir: 'asc' },
  { key: 'ownStock', label: '자사 재고', align: 'right', defaultDir: 'desc' },
  { key: 'sold7', label: '7일 판매', align: 'right', defaultDir: 'desc' },
  { key: 'sold30', label: '30일 판매', align: 'right', defaultDir: 'desc' },
  { key: 'amount30', label: '30일 매출', align: 'right', defaultDir: 'desc' },
  { key: 'daysLeft', label: '소진 예상', align: 'right', defaultDir: 'asc' },
];

function sortValue(p: ProductStat, key: SortKey): number | string {
  switch (key) {
    case 'name':
      return p.name;
    case 'risk':
      return riskPriorityOf(p.risks) * 1e6 + Math.min(p.daysLeft ?? 99999, 99999);
    case 'daysLeft':
      // 재고 0(품절)이 가장 급하므로 소진 예상 정렬에서 맨 앞에 둔다
      return p.coupangStock <= 0 ? -1 : p.daysLeft ?? Infinity;
    default:
      return p[key];
  }
}

const FILTERS: { key: ProductFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'risk', label: '위험 전체' },
  { key: 'soldout', label: RISK_LABEL.soldout },
  { key: 'low', label: RISK_LABEL.low },
  { key: 'returns', label: RISK_LABEL.returns },
  { key: 'excess', label: RISK_LABEL.excess },
  { key: 'selling', label: '판매중' },
];

function matchesFilter(p: ProductStat, f: ProductFilter): boolean {
  if (f === 'all') return true;
  if (f === 'risk') return p.risks.length > 0;
  if (f === 'selling') return p.sold30 > 0;
  return p.risks.includes(f);
}

function Detail({ p }: { p: ProductStat }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="px-1 py-3 grid gap-3 sm:grid-cols-2">
      <div>
        <div className="text-xs text-inkSoft mb-1.5">최근 14일 순판매 (판매 − 반품)</div>
        <MiniBars
          values={p.daily14.map((v) => Math.max(0, v))}
          tooltips={p.daily14.map((v) => `${v}개`)}
          height={56}
        />
      </div>
      <div className="text-xs text-inkSoft grid gap-1 content-start">
        <div>
          하루 평균 <b className="text-ink font-mono">{fmt1(p.dailyRate)}개</b> (최근 14일)
        </div>
        <div>
          30일 반품{' '}
          <b className="text-ink font-mono">
            {p.returned30}/{p.soldGross30}건
          </b>
          {p.soldGross30 > 0 && ` (${fmt1((p.returned30 / p.soldGross30) * 100)}%)`}
        </div>
        <div className="flex gap-3 mt-1">
          <Link href="/dashboard/inventory/products" className="text-accent underline">
            상품 관리에서 재고·원가 수정
          </Link>
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(() => toggleProductVisibility(p.id, !p.isHidden))}
            className="underline hover:text-ink disabled:opacity-50"
          >
            {p.isHidden ? '다시 보이기' : '목록에서 숨기기'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProductsTab({
  stats,
  filter,
  onFilterChange,
  focusId,
}: {
  stats: StockStatsResult;
  filter: ProductFilter;
  onFilterChange: (f: ProductFilter) => void;
  focusId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('risk');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 개요 탭에서 상품을 눌러 넘어오면 해당 상품을 펼치고 그 위치로 스크롤한다
  useEffect(() => {
    if (!focusId) return;
    setExpanded((prev) => new Set(prev).add(focusId));
    const t = setTimeout(() => {
      document.getElementById(`stock-row-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => clearTimeout(t);
  }, [focusId]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeSort(key: SortKey, defaultDir: 'asc' | 'desc') {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(defaultDir);
    }
  }

  const q = query.trim().toLowerCase();

  // 숨김/재고·판매 모두 없는 상품은 기본으로 안 보인다 (검색하거나 체크하면 보임)
  const base = useMemo(
    () =>
      stats.products.filter((p) => {
        if (p.id === focusId) return true;
        if (q) return p.name.toLowerCase().includes(q);
        if (showAll) return true;
        if (p.isHidden) return false;
        return p.coupangStock > 0 || p.ownStock > 0 || p.sold30 !== 0;
      }),
    [stats.products, q, showAll, focusId]
  );

  const counts = useMemo(() => {
    const c: Record<ProductFilter, number> = { all: 0, risk: 0, selling: 0, soldout: 0, low: 0, returns: 0, excess: 0 };
    for (const p of base) {
      c.all += 1;
      if (p.risks.length) c.risk += 1;
      if (p.sold30 > 0) c.selling += 1;
      for (const r of p.risks) c[r] += 1;
    }
    return c;
  }, [base]);

  const rows = useMemo(() => {
    const list = base.filter((p) => matchesFilter(p, filter));
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv, 'ko') * dir;
      return ((av as number) - (bv as number)) * dir || a.name.localeCompare(b.name, 'ko');
    });
  }, [base, filter, sortKey, sortDir]);

  const quietHidden = stats.products.length - base.length;

  return (
    <div>
      <div className="flex flex-col gap-3 mb-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilterChange(f.key)}
              className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${
                filter === f.key
                  ? 'bg-ink text-white border-ink'
                  : 'border-paperLine bg-white text-inkSoft hover:text-ink'
              }`}
            >
              {f.label} <span className="font-mono">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="상품명 검색"
            className="border border-paperLine bg-white px-3 py-2 text-sm rounded-lg flex-1 min-w-[160px]"
          />
          <select
            value={`${sortKey}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(':');
              setSortKey(k as SortKey);
              setSortDir(d as 'asc' | 'desc');
            }}
            className="md:hidden border border-paperLine bg-white px-2 py-2 text-sm rounded-lg"
            aria-label="정렬"
          >
            <option value="risk:asc">위험한 순</option>
            <option value="coupangStock:asc">쿠팡 재고 적은 순</option>
            <option value="daysLeft:asc">소진 빠른 순</option>
            <option value="sold7:desc">7일 판매 많은 순</option>
            <option value="amount30:desc">30일 매출 많은 순</option>
            <option value="name:asc">이름순</option>
          </select>
          <label className="flex items-center gap-2 text-xs text-inkSoft cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            숨김·판매/재고 없는 상품도 보기
            {!showAll && quietHidden > 0 && <span>({quietHidden}개 숨김)</span>}
          </label>
        </div>
      </div>

      {/* PC: 비교표 */}
      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-ink text-xs text-inkSoft">
              {COLUMNS.map((c) => (
                <th key={c.key} className={`py-2 px-3 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                  <button type="button" onClick={() => changeSort(c.key, c.defaultDir)} className="hover:text-ink">
                    {c.label}
                    {sortKey === c.key && <span className="text-accent"> {sortDir === 'asc' ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
              <th className="text-left py-2 px-3 whitespace-nowrap">
                <button type="button" onClick={() => changeSort('risk', 'asc')} className="hover:text-ink">
                  상태{sortKey === 'risk' && <span className="text-accent"> {sortDir === 'asc' ? '▲' : '▼'}</span>}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const open = expanded.has(p.id);
              return (
                <Fragment key={p.id}>
                  <tr
                    id={`stock-row-${p.id}`}
                    onClick={() => toggleExpanded(p.id)}
                    className={`border-b border-paperLine cursor-pointer hover:bg-paper/60 ${p.isHidden ? 'opacity-50' : ''}`}
                  >
                    <td className="py-2.5 px-3 font-medium max-w-[280px]">
                      <span className="text-inkSoft text-[10px] mr-1">{open ? '▼' : '▶'}</span>
                      {p.name}
                      {p.isReturnGrade && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-paper text-inkSoft">회수품</span>
                      )}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono ${p.coupangStock <= 0 ? 'text-red-700 font-bold' : ''}`}>
                      {fmt(p.coupangStock)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-inkSoft">{fmt(p.ownStock)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmt(p.sold7)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmt(p.sold30)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{fmt(p.amount30)}원</td>
                    <td className="py-2.5 px-3 text-right font-mono">{daysLeftText(p)}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex gap-1 flex-wrap">
                        {p.risks.length ? (
                          <RiskChips risks={p.risks} />
                        ) : p.sold30 > 0 ? (
                          <span className="text-[11px] text-profit font-semibold">정상</span>
                        ) : (
                          <span className="text-[11px] text-inkSoft">판매 없음</span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-paper/40 border-b border-paperLine">
                      <td colSpan={COLUMNS.length + 1} className="px-6">
                        <Detail p={p} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="py-8 text-center text-inkSoft">
                  조건에 맞는 상품이 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 모바일: 카드 */}
      <div className="md:hidden flex flex-col gap-2.5">
        {rows.map((p) => {
          const open = expanded.has(p.id);
          return (
            <div
              key={p.id}
              id={`stock-row-${p.id}`}
              className={`card p-4 ${p.isHidden ? 'opacity-50' : ''}`}
            >
              <button type="button" onClick={() => toggleExpanded(p.id)} className="w-full text-left">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold break-words min-w-0">
                    {p.name}
                    {p.isReturnGrade && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-paper text-inkSoft">회수품</span>
                    )}
                  </span>
                  <span className="text-inkSoft text-[10px] mt-1">{open ? '▼' : '▶'}</span>
                </div>
                <div className="flex gap-1 flex-wrap mt-1.5 empty:hidden">
                  <RiskChips risks={p.risks} />
                </div>
                <dl className="grid grid-cols-4 gap-2 mt-3 text-center">
                  <div>
                    <dt className="text-[10px] text-inkSoft">쿠팡 재고</dt>
                    <dd className={`font-mono text-sm font-bold ${p.coupangStock <= 0 ? 'text-red-700' : ''}`}>
                      {fmt(p.coupangStock)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-inkSoft">자사 재고</dt>
                    <dd className="font-mono text-sm text-inkSoft">{fmt(p.ownStock)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-inkSoft">7일 판매</dt>
                    <dd className="font-mono text-sm">{fmt(p.sold7)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-inkSoft">소진 예상</dt>
                    <dd className="font-mono text-sm">{daysLeftText(p)}</dd>
                  </div>
                </dl>
                <div className="text-[11px] text-inkSoft mt-2 font-mono">
                  30일 {fmt(p.sold30)}개 · {fmt(p.amount30)}원
                </div>
              </button>
              {open && (
                <div className="border-t border-paperLine mt-3">
                  <Detail p={p} />
                </div>
              )}
            </div>
          );
        })}
        {!rows.length && (
          <div className="card p-6 text-center text-sm text-inkSoft">조건에 맞는 상품이 없어요.</div>
        )}
      </div>
    </div>
  );
}
