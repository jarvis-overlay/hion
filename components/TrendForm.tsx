'use client';

import { useState, useTransition } from 'react';
import {
  runKeywordTrend,
  runCategoryTrend,
  runShoppingKeywordTrend,
  runCoupangSnapshot,
  type CoupangSnapshotItem,
} from '@/app/dashboard/sourcing/trends/actions';

const SHOPPING_CATEGORIES = [
  { code: '50000000', name: '패션의류' },
  { code: '50000001', name: '패션잡화' },
  { code: '50000002', name: '화장품/미용' },
  { code: '50000003', name: '디지털/가전' },
  { code: '50000004', name: '가구/인테리어' },
  { code: '50000005', name: '출산/육아' },
  { code: '50000006', name: '식품' },
  { code: '50000007', name: '스포츠/레저' },
  { code: '50000008', name: '생활/건강' },
  { code: '50000009', name: '여가/생활편의' },
];

const PERIOD_PRESETS = [
  { label: '최근 3개월', months: 3 },
  { label: '최근 6개월', months: 6 },
  { label: '최근 1년', months: 12 },
];

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultRange(months: number) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  return { startDate: fmtDate(start), endDate: fmtDate(end) };
}

type ResultData = {
  startDate: string;
  endDate: string;
  timeUnit: string;
  results: { title: string; data: { period: string; ratio: number }[] }[];
};

export default function TrendForm() {
  const [mode, setMode] = useState<'keyword' | 'category' | 'shoppingKeyword'>(
    'keyword'
  );
  const [months, setMonths] = useState(6);
  const [timeUnit, setTimeUnit] = useState<'date' | 'week' | 'month'>('week');
  const [keywordLines, setKeywordLines] = useState(['', '', '']);
  const [categoryCodes, setCategoryCodes] = useState<string[]>([]);
  const [shoppingCategory, setShoppingCategory] = useState('');
  const [shoppingKeywords, setShoppingKeywords] = useState(['', '', '']);
  const [result, setResult] = useState<ResultData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [coupangByTitle, setCoupangByTitle] = useState<Record<
    string,
    CoupangSnapshotItem[]
  > | null>(null);
  const [loadingCoupang, setLoadingCoupang] = useState(false);

  function toggleCategory(code: string) {
    setCategoryCodes((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : prev.length < 3
        ? [...prev, code]
        : prev
    );
  }

  function handleRun() {
    setError(null);
    setResult(null);
    setCoupangByTitle(null);
    const { startDate, endDate } = defaultRange(months);

    startTransition(async () => {
      let res: any;
      if (mode === 'keyword') {
        res = await runKeywordTrend(startDate, endDate, timeUnit, keywordLines);
      } else if (mode === 'category') {
        const categories = categoryCodes.map((code) => ({
          name: SHOPPING_CATEGORIES.find((c) => c.code === code)?.name || code,
          param: [code],
        }));
        res = await runCategoryTrend(startDate, endDate, timeUnit, categories);
      } else {
        res = await runShoppingKeywordTrend(
          startDate,
          endDate,
          timeUnit,
          shoppingCategory,
          shoppingKeywords
        );
      }

      if (res.error) {
        setError(res.error);
        return;
      }
      setResult(res.result);

      // 네이버 결과가 나오면 같은 이름으로 쿠팡 실제 판매 스냅샷도 조회
      setLoadingCoupang(true);
      try {
        const titles = res.result.results.map((r: any) => r.title);
        const snapshot = await runCoupangSnapshot(titles);
        setCoupangByTitle(snapshot);
      } catch {
        // 쿠팡 조회 실패해도 네이버 결과는 이미 보여주고 있으니 조용히 무시
      } finally {
        setLoadingCoupang(false);
      }
    });
  }

  return (
    <div className="card p-5">
      <div className="flex gap-2 mb-4 border-b border-paperLine">
        {[
          { key: 'keyword', label: '키워드 비교 (통합검색)' },
          { key: 'category', label: '쇼핑 카테고리 비교' },
          { key: 'shoppingKeyword', label: '카테고리 내 키워드 비교' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setMode(tab.key as any);
              setResult(null);
              setError(null);
            }}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              mode === tab.key
                ? 'border-ink text-ink'
                : 'border-transparent text-inkSoft hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4 items-center flex-wrap">
        <div className="flex gap-1">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.months}
              onClick={() => setMonths(p.months)}
              className={`px-3 py-1.5 text-xs rounded-full border ${
                months === p.months
                  ? 'bg-ink text-white border-ink'
                  : 'bg-[#F5F4F1] border-transparent text-ink hover:bg-[#EEECE8]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={timeUnit}
          onChange={(e) => setTimeUnit(e.target.value as any)}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs rounded-lg"
        >
          <option value="date">일간</option>
          <option value="week">주간</option>
          <option value="month">월간</option>
        </select>
      </div>

      {mode === 'keyword' && (
        <div className="grid gap-2 mb-4">
          <p className="text-xs text-inkSoft">
            최대 5줄, 한 줄에 하나씩 — 그냥 키워드만 쓰거나
            "그룹명:유의어1,유의어2" 형식으로 묶을 수 있어요 (예: "선풍기:선풍기,미니선풍기")
          </p>
          {keywordLines.map((line, i) => (
            <input
              key={i}
              value={line}
              onChange={(e) => {
                const next = [...keywordLines];
                next[i] = e.target.value;
                setKeywordLines(next);
              }}
              placeholder={`후보 아이템 ${i + 1}`}
              className="border border-paperLine bg-white px-3 py-2 text-sm"
            />
          ))}
          {keywordLines.length < 5 && (
            <button
              onClick={() => setKeywordLines([...keywordLines, ''])}
              className="text-xs text-inkSoft hover:text-ink underline self-start"
            >
              + 줄 추가
            </button>
          )}
        </div>
      )}

      {mode === 'category' && (
        <div className="mb-4">
          <p className="text-xs text-inkSoft mb-2">최대 3개 선택</p>
          <div className="flex flex-wrap gap-2">
            {SHOPPING_CATEGORIES.map((c) => (
              <button
                key={c.code}
                onClick={() => toggleCategory(c.code)}
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  categoryCodes.includes(c.code)
                    ? 'bg-ink text-white border-ink'
                    : 'bg-[#F5F4F1] border-transparent text-ink hover:bg-[#EEECE8]'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'shoppingKeyword' && (
        <div className="grid gap-3 mb-4">
          <div>
            <label className="text-xs text-inkSoft">카테고리 (1개)</label>
            <select
              value={shoppingCategory}
              onChange={(e) => setShoppingCategory(e.target.value)}
              className="border border-paperLine bg-white px-3 py-2 text-sm w-full mt-1"
            >
              <option value="">선택하세요</option>
              {SHOPPING_CATEGORIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <p className="text-xs text-inkSoft">
              그 카테고리 안에서 비교할 키워드 (최대 5개)
            </p>
            {shoppingKeywords.map((k, i) => (
              <input
                key={i}
                value={k}
                onChange={(e) => {
                  const next = [...shoppingKeywords];
                  next[i] = e.target.value;
                  setShoppingKeywords(next);
                }}
                placeholder={`후보 키워드 ${i + 1}`}
                className="border border-paperLine bg-white px-3 py-2 text-sm"
              />
            ))}
            {shoppingKeywords.length < 5 && (
              <button
                onClick={() => setShoppingKeywords([...shoppingKeywords, ''])}
                className="text-xs text-inkSoft hover:text-ink underline self-start"
              >
                + 줄 추가
              </button>
            )}
          </div>
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={isPending}
        className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isPending ? '조회 중...' : '트렌드 조회'}
      </button>

      {error && <p className="text-sm text-red-700 mt-3">⚠️ {error}</p>}

      {result && (
        <div className="mt-6 grid gap-4">
          {result.results.map((r) => {
            const data = r.data;
            const max = Math.max(1, ...data.map((d) => d.ratio));
            const half = Math.floor(data.length / 2);
            const earlyAvg =
              data.slice(0, half).reduce((s, d) => s + d.ratio, 0) /
              Math.max(1, half);
            const lateAvg =
              data.slice(half).reduce((s, d) => s + d.ratio, 0) /
              Math.max(1, data.length - half);
            const change =
              earlyAvg > 0 ? ((lateAvg - earlyAvg) / earlyAvg) * 100 : 0;

            return (
              <div key={r.title} className="border border-paperLine rounded-lg p-4">
                <span className="text-sm font-semibold">{r.title}</span>

                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-accent mb-1.5">
                    🛒 쿠팡 실제 판매 현황 (메인 채널)
                  </p>
                  {loadingCoupang && (
                    <p className="text-[11px] text-inkSoft">조회 중...</p>
                  )}
                  {!loadingCoupang && coupangByTitle && (
                    <>
                      {(coupangByTitle[r.title] || []).length === 0 ? (
                        <p className="text-[11px] text-inkSoft">
                          데이터 없음 (검색 실패 또는 결과 없음)
                        </p>
                      ) : (
                        <div className="grid gap-1.5 sm:grid-cols-3">
                          {coupangByTitle[r.title].map((c, j) => (
                            <a
                              key={j}
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex gap-1.5 border border-paperLine rounded-md p-1.5 hover:border-accent transition-colors"
                            >
                              {c.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={c.imageUrl}
                                  alt={c.name}
                                  className="w-10 h-10 rounded object-cover shrink-0 bg-[#EEECE8]"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded shrink-0 bg-[#EEECE8]" />
                              )}
                              <div className="min-w-0">
                                <p className="text-[11px] text-ink line-clamp-2 leading-snug">
                                  {c.name}
                                </p>
                                <p className="text-[10px] text-inkSoft">
                                  {c.price ? `${c.price}원` : ''}
                                  {c.reviewCount ? ` · 리뷰 ${c.reviewCount}개` : ''}
                                </p>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-paperLine">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[11px] font-semibold text-inkSoft">
                      📈 네이버 검색 관심도 (보조 지표)
                    </p>
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                        change > 10
                          ? 'bg-profitBg text-profit'
                          : change < -10
                          ? 'bg-red-100 text-red-700'
                          : 'bg-paperLine text-inkSoft'
                      }`}
                    >
                      {change > 0 ? '+' : ''}
                      {change.toFixed(1)}% (전반 대비 후반)
                    </span>
                  </div>
                  <div className="flex items-end gap-[2px] h-10 opacity-70">
                    {data.map((d, i) => (
                      <div
                        key={i}
                        title={`${d.period}: ${d.ratio}`}
                        className="flex-1 bg-ink/70 rounded-sm"
                        style={{ height: `${Math.max(2, (d.ratio / max) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-inkSoft mt-1">
                    <span>{data[0]?.period}</span>
                    <span>{data[data.length - 1]?.period}</span>
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
