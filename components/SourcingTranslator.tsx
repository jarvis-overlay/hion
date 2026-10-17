'use client';

import { useState, useTransition } from 'react';
import { runTranslateToChinese, runTranslateToKorean } from '@/app/dashboard/sourcing/translate/actions';

type Direction = 'ko-zh' | 'zh-ko';

interface HistoryEntry {
  id: string;
  direction: Direction;
  input: string;
  casual?: string;
  formal?: string;
  translation?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // 클립보드 권한이 없는 브라우저 - 조용히 무시 (텍스트는 화면에 그대로 보이니 직접 선택 복사 가능)
        }
      }}
      className="text-[11px] text-accent font-semibold underline shrink-0"
    >
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

export default function SourcingTranslator() {
  const [direction, setDirection] = useState<Direction>('ko-zh');
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  function handleTranslate() {
    setError(null);
    const inputSnapshot = text;
    startTransition(async () => {
      if (direction === 'ko-zh') {
        const res = await runTranslateToChinese(inputSnapshot);
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setHistory((prev) => [
          { id: crypto.randomUUID(), direction, input: inputSnapshot, casual: res.data.casual, formal: res.data.formal },
          ...prev,
        ]);
      } else {
        const res = await runTranslateToKorean(inputSnapshot);
        if ('error' in res) {
          setError(res.error);
          return;
        }
        setHistory((prev) => [
          { id: crypto.randomUUID(), direction, input: inputSnapshot, translation: res.translation },
          ...prev,
        ]);
      }
      setText('');
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setDirection('ko-zh')}
          className={`flex-1 px-3 py-2 text-sm font-semibold border ${
            direction === 'ko-zh' ? 'bg-ink text-white border-ink' : 'border-paperLine text-inkSoft'
          }`}
        >
          한국어 → 중국어
        </button>
        <button
          type="button"
          onClick={() => setDirection('zh-ko')}
          className={`flex-1 px-3 py-2 text-sm font-semibold border ${
            direction === 'zh-ko' ? 'bg-ink text-white border-ink' : 'border-paperLine text-inkSoft'
          }`}
        >
          중국어 → 한국어
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={
          direction === 'ko-zh'
            ? '예) MADE IN CHINA 스티커를 제품과 포장박스에 부착해야 합니다. 화이트 색상 샘플 200개 먼저 주문하겠습니다.'
            : '공장에서 받은 중국어 메시지를 붙여넣으세요.'
        }
        className="border border-paperLine bg-white px-3 py-2 text-sm w-full"
      />

      <button
        onClick={handleTranslate}
        disabled={isPending || !text.trim()}
        className="btn-primary px-4 py-2.5 text-sm font-semibold justify-self-start disabled:opacity-40"
      >
        {isPending ? '번역 중...' : '번역하기'}
      </button>

      {error && <p className="text-xs text-warn bg-warnBg rounded-md px-3 py-2">{error}</p>}

      {history.length > 0 && (
        <div className="grid gap-3">
          {history.map((h) => (
            <div key={h.id} className="card p-4 grid gap-2.5">
              <p className="text-xs text-inkSoft whitespace-pre-wrap">{h.input}</p>
              {h.direction === 'ko-zh' ? (
                <div className="grid gap-2">
                  {h.casual && (
                    <div className="rounded bg-paper px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] text-inkSoft font-semibold uppercase tracking-wide">
                          편한 톤
                        </span>
                        <CopyButton text={h.casual} />
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{h.casual}</p>
                    </div>
                  )}
                  {h.formal && (
                    <div className="rounded bg-paper px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] text-inkSoft font-semibold uppercase tracking-wide">
                          격식 톤
                        </span>
                        <CopyButton text={h.formal} />
                      </div>
                      <p className="text-sm mt-1 whitespace-pre-wrap">{h.formal}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded bg-paper px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] text-inkSoft font-semibold uppercase tracking-wide">번역</span>
                    <CopyButton text={h.translation || ''} />
                  </div>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{h.translation}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
