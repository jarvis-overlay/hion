'use client';

import { useState } from 'react';

// 상품 메모, 번역/중국어 메시지 결과처럼 길어질 수 있는 텍스트를
// 기본으로 접어두고 "더보기"로 펼쳐볼 수 있게 하는 공용 컴포넌트 -
// 화면이 너무 길어져서 불편하다는 요청으로 추가함.
export default function CollapsibleText({
  text,
  maxChars = 200,
  className = '',
  render,
}: {
  text: string;
  maxChars?: number;
  className?: string;
  render?: (text: string) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > maxChars;
  const shown = expanded || !isLong ? text : text.slice(0, maxChars) + '…';

  return (
    <div>
      <p className={`whitespace-pre-wrap break-words ${className}`}>
        {render ? render(shown) : shown}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-accent font-semibold mt-0.5"
        >
          {expanded ? '접기 ▲' : '더보기 ▼'}
        </button>
      )}
    </div>
  );
}
