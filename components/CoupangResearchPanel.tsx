'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  researchCoupangComparisons,
  type CoupangResearchCandidate,
  type CoupangResearchResult,
} from '@/app/dashboard/sourcing/list/researchActions';
import { addSourcingComparisons } from '@/app/dashboard/sourcing/list/actions';
import { MarketBadgeRow } from '@/components/MarketBadge';
import { MARKET_SIZE_LABEL } from '@/components/ComparisonEntryEditor';

function candidateKey(c: CoupangResearchCandidate, i: number): string {
  return c.url || String(i);
}

function parsePrice(p: string | null): number | null {
  if (!p) return null;
  const n = Number(p.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 선택된 후보들의 가격을 보고 "price_range" 기본값을 만든다. 쿠팡
// 가격대 표기(components/SourcingList.tsx의 PLATFORM_LABEL 옆에 쓰는
// 문구)와 같은 형식("12,000~34,000원" / "12,000원")으로 맞춤.
function suggestPriceRange(selected: CoupangResearchCandidate[]): string {
  const prices = selected.map((c) => parsePrice(c.price)).filter((n): n is number => n != null);
  if (prices.length === 0) return '';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `${min.toLocaleString()}원` : `${min.toLocaleString()}~${max.toLocaleString()}원`;
}

// 소싱 리스트 카드의 "비교 상품군"에서 쓰는 하위 패널 - 손으로 쿠팡을
// 검색해서 베껴 적지 않고, 이미 있는 쿠팡 실데이터 조사 로직을 그대로
// 호출해서 후보를 보여주고 체크한 것만 비교 상품으로 저장한다.
export default function CoupangResearchPanel({
  item,
  onSaved,
}: {
  item: any;
  onSaved: () => void;
}) {
  const [keyword, setKeyword] = useState(item.title || '');
  const [loading, setLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [result, setResult] = useState<CoupangResearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priceRange, setPriceRange] = useState('');
  const [priceRangeTouched, setPriceRangeTouched] = useState(false);
  const [marketSize, setMarketSize] = useState<'high' | 'mid' | 'low' | ''>('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function selectedCandidates(): CoupangResearchCandidate[] {
    if (!result) return [];
    return result.candidates.filter((c, i) => selected.has(candidateKey(c, i)));
  }

  function handleToggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 선택이 바뀔 때마다, 사용자가 직접 가격대를 수정하지 않았으면 선택된
  // 후보 기준으로 다시 추천값을 채워준다 (직접 수정한 뒤에는 덮어쓰지 않음).
  useEffect(() => {
    if (!result || priceRangeTouched) return;
    const picked = result.candidates.filter((c, i) => selected.has(candidateKey(c, i)));
    setPriceRange(suggestPriceRange(picked));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, result]);

  async function handleResearch() {
    if (!keyword.trim() || loading) return;
    setLoading(true);
    setResearchError(null);
    setResult(null);
    setSelected(new Set());
    setSaveError(null);
    try {
      const res = await researchCoupangComparisons(keyword);
      if ('error' in res) {
        setResearchError(res.error);
        return;
      }
      setResult(res);
      setPriceRange('');
      setPriceRangeTouched(false);
      setMarketSize(res.suggestedMarketSize);
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    const picked = selectedCandidates();
    if (picked.length === 0) {
      setSaveError('저장할 후보를 1개 이상 선택해주세요.');
      return;
    }
    setSaveError(null);
    startTransition(async () => {
      const res = await addSourcingComparisons(
        item.id,
        picked.map((c) => ({
          title: c.name,
          link: c.url,
          prices: [{ platform: 'coupang' as const, priceRange, marketSize }],
          source: 'coupang_auto' as const,
        }))
      );
      if (!res || 'error' in res) {
        setSaveError(res?.error ?? '저장에 실패했어요. 다시 시도해주세요.');
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="grid gap-3 bg-paper rounded-md p-3">
      <div className="flex gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
          placeholder="조사할 키워드"
          className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1"
        />
        <button
          type="button"
          onClick={handleResearch}
          disabled={loading || !keyword.trim()}
          className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50 shrink-0"
        >
          {loading ? '조사 중...' : '조사하기'}
        </button>
      </div>

      {loading && (
        <p className="text-[11px] text-inkSoft">
          조사 중이에요... 캡차 재시도가 겹치면 최대 1~2분 걸릴 수 있어요.
        </p>
      )}

      {researchError && (
        <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1.5">
          {researchError} 수동으로 비교 상품을 추가해주세요.
        </p>
      )}

      {result && (
        <>
          <MarketBadgeRow badges={result.badges} />

          <div className="grid gap-1.5">
            {result.candidates.map((c, i) => {
              const key = candidateKey(c, i);
              const checked = selected.has(key);
              return (
                <label
                  key={key}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer ring-1 ${
                    checked ? 'ring-accent bg-accentBg' : 'ring-paperLine bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggle(key)}
                    className="shrink-0"
                  />
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.imageUrl}
                      alt={c.name}
                      className="w-10 h-10 rounded object-cover shrink-0 bg-paperLine"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded shrink-0 bg-paperLine" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-ink line-clamp-2 leading-snug">{c.name}</p>
                    <p className="text-inkSoft">
                      {c.price ? `${c.price}원` : '가격 미상'}
                      {c.reviewCount ? ` · 리뷰 ${c.reviewCount}개` : ''}
                    </p>
                  </div>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-profit underline shrink-0"
                  >
                    [링크]
                  </a>
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              value={priceRange}
              onChange={(e) => {
                setPriceRange(e.target.value);
                setPriceRangeTouched(true);
              }}
              placeholder="형성 가격대 (선택 시 자동 채움)"
              className="border border-paperLine bg-white px-2 py-1.5 text-xs"
            />
            <select
              value={marketSize}
              onChange={(e) => setMarketSize(e.target.value as 'high' | 'mid' | 'low' | '')}
              className="border border-paperLine bg-white px-2 py-1.5 text-xs"
            >
              <option value="">시장규모</option>
              <option value="high">{MARKET_SIZE_LABEL.high}</option>
              <option value="mid">{MARKET_SIZE_LABEL.mid}</option>
              <option value="low">{MARKET_SIZE_LABEL.low}</option>
            </select>
          </div>

          {saveError && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1.5">{saveError}</p>}

          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || selected.size === 0}
            className="btn-primary py-1.5 text-xs font-semibold self-start px-4 disabled:opacity-50"
          >
            {isPending ? '저장 중...' : `선택한 ${selected.size}개 저장`}
          </button>
        </>
      )}
    </div>
  );
}
