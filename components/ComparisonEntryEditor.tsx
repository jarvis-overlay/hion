'use client';

import { useState } from 'react';
import type { ComparisonInput, ComparisonPriceInput } from '@/app/dashboard/sourcing/list/actions';

export const MARKET_SIZE_LABEL: Record<string, string> = { high: '상', mid: '중', low: '하' };

function PlatformPriceList({
  label,
  platform,
  entries,
  onChange,
}: {
  label: string;
  platform: 'coupang' | 'naver';
  entries: ComparisonPriceInput[];
  onChange: (next: ComparisonPriceInput[]) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] font-semibold text-inkSoft">{label}</span>
      {entries.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={p.priceRange}
            onChange={(e) => {
              const next = [...entries];
              next[i] = { ...p, priceRange: e.target.value };
              onChange(next);
            }}
            placeholder={`${label} 형성 가격대`}
            className="border border-paperLine bg-white px-2 py-1.5 text-xs flex-1 min-w-0"
          />
          <select
            value={p.marketSize}
            onChange={(e) => {
              const next = [...entries];
              next[i] = { ...p, marketSize: e.target.value as ComparisonPriceInput['marketSize'] };
              onChange(next);
            }}
            className="border border-paperLine bg-white px-1.5 py-1.5 text-xs"
          >
            <option value="">시장규모</option>
            <option value="high">상</option>
            <option value="mid">중</option>
            <option value="low">하</option>
          </select>
          <button
            type="button"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
            className="text-inkSoft hover:text-red-700 text-xs px-1"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...entries, { platform, priceRange: '', marketSize: '' }])}
        className="text-left text-[11px] text-accent font-semibold self-start"
      >
        + {label} 항목 추가
      </button>
    </div>
  );
}

// 비교 상품 하나(링크 + 쿠팡/네이버 가격대·시장규모 여러 건)를 만드는
// 입력 UI. 등록 폼(아직 sourcing_item_id가 없는 상태 - 로컬 draft로만
// 쌓았다가 최종 등록 시 한번에 제출)과 이미 저장된 카드(바로 서버에
// 저장) 양쪽에서 똑같이 쓴다 - 완성된 비교 데이터를 어떻게 처리할지는
// onSave 콜백에 맡긴다.
export default function ComparisonEntryEditor({ onSave }: { onSave: (c: ComparisonInput) => void }) {
  const [link, setLink] = useState('');
  const [coupang, setCoupang] = useState<ComparisonPriceInput[]>([]);
  const [naver, setNaver] = useState<ComparisonPriceInput[]>([]);

  function handleSave() {
    if (!link.trim() && coupang.length === 0 && naver.length === 0) return;
    onSave({ link: link.trim(), prices: [...coupang, ...naver] });
    setLink('');
    setCoupang([]);
    setNaver([]);
  }

  return (
    <div className="grid gap-2 bg-paper rounded-md p-3">
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="비교 상품 링크"
        className="border border-paperLine bg-white px-2 py-1.5 text-xs"
      />
      <PlatformPriceList label="쿠팡" platform="coupang" entries={coupang} onChange={setCoupang} />
      <PlatformPriceList label="네이버" platform="naver" entries={naver} onChange={setNaver} />
      <button
        type="button"
        onClick={handleSave}
        className="btn-primary py-1.5 text-xs font-semibold self-start px-4"
      >
        비교 상품 추가
      </button>
    </div>
  );
}
