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
        키워드 하나로 이 시장이 소싱해볼 만한지 판단하고, 1위 상품의 실제
        알리바바 소싱 후보까지 한번에 찾아줘요.
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

      {loading && (
        <p className="text-sm text-inkSoft mb-4">
          쿠팡 실데이터 조회 + 1위 상품 알리바바 소싱 후보 매칭까지 하고
          있어요. 캡차 재시도가 겹치면 최대 2~3분 정도 걸릴 수 있어요...
        </p>
      )}

      {result && (
        <>
          {result.badges && result.verdict && (
            <div className="mb-6 rounded-xl bg-paper p-4">
              <MarketBadgeRow badges={result.badges} />
              <p className="text-sm text-ink mt-2 leading-relaxed">📋 {result.verdict}</p>
            </div>
          )}

          <div className="grid gap-6 sm:grid-cols-2 mb-6">
            <div>
              <p className="text-xs font-semibold text-inkSoft mb-2">쿠팡 검색 결과 (판매량순)</p>
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
                      className={`flex gap-2 ring-1 rounded-xl p-2 hover:ring-accent transition ${
                        i === 0 ? 'ring-accent bg-accentBg' : 'ring-paperLine'
                      }`}
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
                        <p className="text-xs text-ink line-clamp-2 leading-snug mb-1">
                          {i === 0 && <span className="text-accent font-semibold">1위 · </span>}
                          {c.name}
                        </p>
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

          {result.topProductName && (
            <div>
              <p className="text-xs font-semibold text-inkSoft mb-2">
                알리바바 소싱 후보 (1위 상품 "{result.topProductName}" 기준)
              </p>
              {result.sourcingLinks.length === 0 ? (
                <p className="text-xs text-inkSoft bg-paper rounded-md px-3 py-2">
                  알리바바 조회에 실패했거나 결과가 없어요. 알리바바 봇 차단
                  때문일 수 있으니, alibaba.com에서 직접 검색해보시는 걸
                  추천해요.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  {result.sourcingLinks.map((s, j) => (
                    <a
                      key={j}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex gap-2 ring-1 ring-paperLine rounded-xl p-2 hover:ring-accent transition"
                    >
                      {s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.imageUrl}
                          alt={s.nameKo}
                          className="w-14 h-14 rounded object-cover shrink-0 bg-paperLine"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded shrink-0 bg-paperLine" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs text-ink line-clamp-2 leading-snug mb-0.5">
                          {s.nameKo}
                        </p>
                        <p className="text-[11px] text-inkSoft line-clamp-1 mb-1">{s.name}</p>
                        <p className="text-xs text-accent font-medium">{s.price}</p>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
