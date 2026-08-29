'use client';

import { useState } from 'react';
import { runProductSearch, type ProductSearchResult } from '@/app/dashboard/sourcing/trends/actions';
import { MarketBadgeRow } from '@/components/MarketBadge';

export default function ProductSearch() {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProductSearchResult | null>(null);

  async function handleSearch() {
    if (!keyword.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await runProductSearch(keyword);
      setResult(res);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-6 sm:p-8 mb-6">
      <h2 className="text-lg font-bold mb-1">상품 검색</h2>
      <p className="text-sm text-inkSoft mb-5">
        그냥 쿠팡에서 검색하는 것과 다르게, 검색 결과 리뷰수 합계·상품
        개수·가격 분포를 계산해서 이 키워드의 시장규모·경쟁강도를 바로
        보여줘요 - 하나하나 눌러보면서 리뷰수를 세지 않아도 돼요.
      </p>

      <div className="flex gap-2 mb-5">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="예: 목걸이선풍기, 캠핑 랜턴"
          className="border border-paperLine bg-white px-3 py-2 text-sm flex-1"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !keyword.trim()}
          className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
        >
          {loading ? '검색 중...' : '검색'}
        </button>
      </div>

      {result && (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <p className="text-xs font-semibold text-inkSoft">쿠팡 검색 결과</p>
              {result.badges && <MarketBadgeRow badges={result.badges} />}
            </div>
            {result.coupangError ? (
              <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">
                조회 실패: {result.coupangError}
              </p>
            ) : result.coupang.length === 0 ? (
              <p className="text-xs text-inkSoft bg-paper rounded-md px-3 py-2">결과가 없어요.</p>
            ) : (
              <div className="grid gap-2">
                {result.coupang.map((c, i) => (
                  <a
                    key={i}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-2 ring-1 ring-paperLine rounded-xl p-2 hover:ring-accent transition"
                  >
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.imageUrl}
                        alt={c.name}
                        className="w-14 h-14 rounded object-cover shrink-0 bg-paperLine"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded shrink-0 bg-paperLine" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs text-ink line-clamp-2 leading-snug mb-1">{c.name}</p>
                      <p className="text-xs text-inkSoft">
                        {c.price ? `${c.price}원` : ''}
                        {c.reviewCount ? ` · 리뷰 ${c.reviewCount}개` : ''}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-inkSoft mb-2">네이버쇼핑 검색 결과</p>
            <p className="text-xs text-inkSoft bg-paper rounded-md px-3 py-2 mb-2">
              {result.naverUnavailable}
            </p>
            <a
              href={`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent underline"
            >
              네이버쇼핑에서 "{keyword}" 직접 검색하기 ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
