'use client';

import { useState, useTransition } from 'react';
import { runTranslateToChinese, runTranslateToKorean } from '@/app/dashboard/sourcing/translate/actions';
import { useDraft } from '@/lib/useDraft';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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
  const [text, setText] = useDraft('sourcing-translate-draft');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  function handleTranslate() {
    setError(null);
    setCopiedNotice(null);
    const inputSnapshot = text;
    startTransition(async () => {
      if (direction === 'ko-zh') {
        const res = await runTranslateToChinese(inputSnapshot);
        if (!res || 'error' in res) {
          setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
          return;
        }
        setHistory((prev) => [
          { id: crypto.randomUUID(), direction, input: inputSnapshot, casual: res.data.casual, formal: res.data.formal },
          ...prev,
        ]);
        // 공장 채팅창에 바로 붙여넣을 수 있게 결과를 자동으로 클립보드에
        // 복사해둔다 - 번역 결과가 2톤(편한/격식)이라 격식 톤을 기본으로
        // 복사하고, 편한 톤을 쓰고 싶으면 해당 카드의 복사 버튼을 누르면
        // 된다.
        const toCopy = res.data.formal || res.data.casual;
        if (toCopy && (await copyToClipboard(toCopy))) {
          setCopiedNotice(res.data.formal ? '격식 톤이 클립보드에 복사됐어요' : '번역 결과가 클립보드에 복사됐어요');
        }
      } else {
        const res = await runTranslateToKorean(inputSnapshot);
        if (!res || 'error' in res) {
          setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
          return;
        }
        setHistory((prev) => [
          { id: crypto.randomUUID(), direction, input: inputSnapshot, translation: res.translation },
          ...prev,
        ]);
        if (res.translation && (await copyToClipboard(res.translation))) {
          setCopiedNotice('번역 결과가 클립보드에 복사됐어요');
        }
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
