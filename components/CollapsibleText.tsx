'use client';

import { useState } from 'react';

// 상품 메모, 번역/중국어 메시지 결과처럼 길어질 수 있는 텍스트를
// 기본으로 두 줄 정도만 보이게 접어두고 "더보기"로 펼쳐볼 수 있게 하는
// 공용 컴포넌트. 글자수로 잘라내는(slice) 방식은 줄바꿈이 많은
// 텍스트(예: 사이즈별 수량 목록)에서 글자수는 적어도 줄 수가 많아 여전히
// 화면을 꽉 채우는 문제가 있어서, 실제 접힌 모습은 CSS line-clamp으로
// "보이는 줄 수" 자체를 제한한다 - maxChars/줄바꿈 개수는 "이 텍스트가
// 접을 만큼 긴지"만 판단하는 기준으로 쓴다.
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
  const lineBreaks = (text.match(/\n/g) || []).length;
  const isLong = text.length > maxChars || lineBreaks >= 2;

  return (
    <div>
      <p
        className={`whitespace-pre-wrap break-words ${className} ${
          !expanded && isLong ? 'line-clamp-2 overflow-hidden' : ''
        }`}
      >
        {render ? render(text) : text}
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
