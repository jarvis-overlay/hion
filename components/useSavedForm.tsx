'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 입력칸에 적어둔 내용을 이 브라우저에 저장해서, 만들기를 돌린 뒤나 새로고침/재방문 후에도 그대로 남기고,
// 만들기를 돌릴 때마다 그때의 입력을 기록으로 남겨 "이전 입력으로 되돌리기"를 할 수 있게 한다.
// 저장 위치는 이 브라우저(localStorage)라서 다른 PC·브라우저와는 공유되지 않고, 사진 파일은 저장하지 않는다(글/설정만).
const MAX_HISTORY = 10;

export interface FormRecord<T> {
  at: number;
  values: T;
}

function readJson<V>(key: string, fallback: V): V {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as V) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 공간이 없거나 막혀 있어도 화면은 정상 동작해야 한다
  }
}

export function useSavedForm<T extends Record<string, unknown>>(key: string, values: T, apply: (v: Partial<T>) => void) {
  const storageKey = `hion:form:${key}`;
  const historyKey = `${storageKey}:history`;
  const [history, setHistory] = useState<FormRecord<T>[]>([]);
  const [ready, setReady] = useState(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // 처음 열 때 저장된 입력을 불러온다 (불러오기 전에는 저장하지 않아서 빈 값이 덮어쓰지 못한다)
  useEffect(() => {
    const saved = readJson<Partial<T> | null>(storageKey, null);
    if (saved && typeof saved === 'object') applyRef.current(saved);
    setHistory(readJson<FormRecord<T>[]>(historyKey, []));
    setReady(true);
  }, [storageKey, historyKey]);

  const json = JSON.stringify(values);
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => writeJson(storageKey, valuesRef.current), 300);
    return () => window.clearTimeout(t);
  }, [json, ready, storageKey]);

  // 만들기를 돌릴 때 그 시점의 입력을 기록으로 남긴다 (같은 내용이 연속이면 하나만)
  const snapshot = useCallback(() => {
    const current = valuesRef.current;
    setHistory((prev) => {
      if (prev[0] && JSON.stringify(prev[0].values) === JSON.stringify(current)) return prev;
      const next = [{ at: Date.now(), values: current }, ...prev].slice(0, MAX_HISTORY);
      writeJson(historyKey, next);
      return next;
    });
  }, [historyKey]);

  const restore = useCallback((index: number) => {
    setHistory((prev) => {
      const rec = prev[index];
      if (rec) applyRef.current(rec.values);
      return prev;
    });
  }, []);

  return { history, snapshot, restore };
}

function fmt(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 이전에 돌렸던 입력 목록에서 골라 입력칸에 다시 채운다
export function FormHistoryPicker<T>({
  history,
  onRestore,
  describe,
}: {
  history: FormRecord<T>[];
  onRestore: (index: number) => void;
  describe: (v: T) => string;
}) {
  if (history.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="text-inkSoft">이전에 돌린 입력으로 되돌리기</span>
      <select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value === '') return;
          onRestore(Number(e.target.value));
          e.target.value = '';
        }}
        className="border border-paperLine bg-white px-2 py-1 text-xs max-w-full"
      >
        <option value="">선택하세요 ({history.length}개)</option>
        {history.map((h, i) => (
          <option key={h.at} value={i}>
            {fmt(h.at)} · {describe(h.values).slice(0, 40)}
          </option>
        ))}
      </select>
    </div>
  );
}
