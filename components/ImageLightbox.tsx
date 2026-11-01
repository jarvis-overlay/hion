'use client';

// 이미지 미리보기(확대) 창: 좌우 화살표/키보드로 넘겨보고, 그 자리에서 바로 내려받을 수 있다.
import { useEffect, useState } from 'react';
import { downloadImage } from '@/lib/clientDownload';

export interface LightboxItem {
  url: string;
  title: string; // 설명 (예: 컷 이름)
  fileName: string; // 내려받을 때 파일 이름
}

export default function ImageLightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
    }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, items.length, onIndex, onClose]);

  useEffect(() => setErr(null), [index]);

  if (!item) return null;

  async function handleDownload() {
    setBusy(true);
    setErr(null);
    try {
      await downloadImage(item.url, item.fileName);
    } catch (e: any) {
      setErr(e?.message || '다운로드에 실패했어요. 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="이미지 미리보기"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white text-sm" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <span className="font-semibold">{item.title}</span>
          <span className="ml-2 text-white/60 text-xs">
            {index + 1} / {items.length}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {busy ? '받는 중...' : '다운로드'}
          </button>
          <button type="button" onClick={onClose} className="rounded-full bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25">
            닫기 (Esc)
          </button>
        </div>
      </div>
      {err && (
        <p className="mx-4 mb-1 text-xs text-warn bg-warnBg rounded px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          {err}
        </p>
      )}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-14 pb-4">
        {hasPrev && (
          <button
            type="button"
            aria-label="이전 이미지"
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index - 1);
            }}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 text-white text-xl hover:bg-white/30"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.title}
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-full object-contain rounded bg-white shadow-2xl"
        />
        {hasNext && (
          <button
            type="button"
            aria-label="다음 이미지"
            onClick={(e) => {
              e.stopPropagation();
              onIndex(index + 1);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 text-white text-xl hover:bg-white/30"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
