'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFormState, saveFormState } from '@/app/dashboard/sales/formStateActions';

// 입력칸에 적어둔 내용을 저장해서, 만들기를 돌린 뒤나 새로고침/재방문 후에도 그대로 남기고,
// 만들기를 돌릴 때마다 그때의 입력을 기록으로 남겨 "이전 입력으로 되돌리기"를 할 수 있게 한다.
// 저장은 두 곳에 한다: 이 브라우저(localStorage, 즉시) + 서버(다른 PC·브라우저에서도 보이게).
// 서버 저장이 안 돼도 이 브라우저 저장으로 계속 동작한다. 사진 파일은 저장하지 않는다(글/설정만).
const MAX_HISTORY = 10;
const LOCAL_DELAY = 300;
const SERVER_DELAY = 1200;

export interface FormRecord<T> {
  at: number;
  values: T;
}

export type SaveStatus = 'loading' | 'saving' | 'server' | 'local';

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

function mergeHistory<T>(a: FormRecord<T>[], b: FormRecord<T>[]): FormRecord<T>[] {
  const byAt = new Map<number, FormRecord<T>>();
  for (const r of [...a, ...b]) if (r && typeof r.at === 'number' && !byAt.has(r.at)) byAt.set(r.at, r);
  return Array.from(byAt.values())
    .sort((x, y) => y.at - x.at)
    .slice(0, MAX_HISTORY);
}

export function useSavedForm<T extends Record<string, unknown>>(key: string, values: T, apply: (v: Partial<T>) => void) {
  const storageKey = `hion:form:${key}`;
  const historyKey = `${storageKey}:history`;
  const atKey = `${storageKey}:at`;
  const [history, setHistory] = useState<FormRecord<T>[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('loading');
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const historyRef = useRef<FormRecord<T>[]>([]);
  const atRef = useRef(0); // 현재 입력을 마지막으로 저장한 시각 (이 브라우저/서버 중 더 새로운 쪽을 고르는 기준)
  const baselineRef = useRef<string | null>(null); // 마지막으로 저장(또는 불러온) 입력의 JSON - 같으면 다시 저장하지 않는다
  const serverTimer = useRef<number | null>(null);
  const localFlush = useRef<(() => void) | null>(null);

  const pushServer = useCallback(
    (delay: number) => {
      if (serverTimer.current) window.clearTimeout(serverTimer.current);
      const run = async () => {
        serverTimer.current = null;
        setStatus('saving');
        try {
          const res = await saveFormState(key, {
            current: { at: atRef.current || Date.now(), values: valuesRef.current },
            history: historyRef.current,
          });
          setStatus(res && 'success' in res ? 'server' : 'local');
        } catch {
          setStatus('local');
        }
      };
      serverTimer.current = window.setTimeout(run, delay);
    },
    [key]
  );

  // 처음 열 때: 이 브라우저에 저장된 입력을 바로 채우고, 서버에 저장된 게 더 새로우면 그걸로 채운다
  // (불러오기 전에는 저장하지 않아서 빈 값이 덮어쓰지 못한다)
  useEffect(() => {
    let cancelled = false;
    const saved = readJson<Partial<T> | null>(storageKey, null);
    if (saved && typeof saved === 'object') applyRef.current(saved);
    atRef.current = Number(readJson<number>(atKey, 0)) || 0;
    const localHistory = readJson<FormRecord<T>[]>(historyKey, []);
    historyRef.current = Array.isArray(localHistory) ? localHistory : [];
    setHistory(historyRef.current);
    setReady(true);

    loadFormState(key)
      .then((res) => {
        if (cancelled) return;
        if (!res || 'error' in res) {
          setStatus('local');
          return;
        }
        const merged = mergeHistory(historyRef.current, res.history as unknown as FormRecord<T>[]);
        historyRef.current = merged;
        setHistory(merged);
        writeJson(historyKey, merged);
        if (res.current && res.current.at > atRef.current) {
          // 다른 PC/브라우저에서 더 나중에 적은 입력이 있으면 그걸 채운다
          const incoming = res.current.values as Partial<T>;
          baselineRef.current = JSON.stringify({ ...valuesRef.current, ...incoming });
          applyRef.current(incoming);
          atRef.current = res.current.at;
          writeJson(storageKey, incoming);
          writeJson(atKey, res.current.at);
          setStatus('server');
        } else if (saved && (!res.current || atRef.current > res.current.at)) {
          // 서버에 없거나 이 브라우저 입력이 더 새로우면 서버로 올려둔다
          pushServer(0);
        } else {
          setStatus('server');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('local');
      });
    return () => {
      cancelled = true;
    };
  }, [key, storageKey, historyKey, atKey, pushServer]);

  const json = JSON.stringify(values);
  useEffect(() => {
    if (!ready) return;
    if (baselineRef.current === null) {
      baselineRef.current = json; // 불러온 직후의 입력이 기준 - 이것과 같은 동안은 저장할 필요 없음
      return;
    }
    if (json === baselineRef.current) return;
    const write = () => {
      localFlush.current = null;
      baselineRef.current = json;
      const at = Date.now();
      atRef.current = at;
      writeJson(storageKey, valuesRef.current);
      writeJson(atKey, at);
      pushServer(SERVER_DELAY);
    };
    localFlush.current = write;
    const t = window.setTimeout(write, LOCAL_DELAY);
    return () => window.clearTimeout(t);
  }, [json, ready, storageKey, atKey, pushServer]);

  // 화면을 떠날 때(다른 탭으로 이동 등) 아직 저장 안 된 입력이 있으면 바로 저장한다
  useEffect(() => {
    return () => {
      const flush = localFlush.current;
      if (flush) flush();
      if (serverTimer.current) {
        window.clearTimeout(serverTimer.current);
        serverTimer.current = null;
        void saveFormState(key, {
          current: { at: atRef.current || Date.now(), values: valuesRef.current },
          history: historyRef.current,
        }).catch(() => undefined);
      }
    };
  }, [key]);

  // 만들기를 돌릴 때 그 시점의 입력을 기록으로 남긴다 (같은 내용이 연속이면 하나만)
  const snapshot = useCallback(() => {
    const current = valuesRef.current;
    const prev = historyRef.current;
    const next =
      prev[0] && JSON.stringify(prev[0].values) === JSON.stringify(current)
        ? prev
        : [{ at: Date.now(), values: current }, ...prev].slice(0, MAX_HISTORY);
    historyRef.current = next;
    setHistory(next);
    writeJson(historyKey, next);
    const at = Date.now();
    atRef.current = at;
    baselineRef.current = JSON.stringify(current);
    writeJson(storageKey, current);
    writeJson(atKey, at);
    pushServer(0); // 만들기는 오래 걸리니 기록은 바로 서버에도 남긴다
  }, [historyKey, storageKey, atKey, pushServer]);

  const restore = useCallback((index: number) => {
    const rec = historyRef.current[index];
    if (rec) applyRef.current(rec.values);
  }, []);

  return { history, snapshot, restore, status };
}

function fmt(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  loading: '저장된 입력 확인 중...',
  saving: '저장 중...',
  server: '입력한 내용은 자동 저장돼요 (서버에 저장 - 다른 PC에서도 불러와요)',
  local: '입력한 내용은 이 브라우저에만 저장돼요 (서버 저장에 실패했어요)',
};

// 자동 저장 상태 + 이전에 돌렸던 입력 목록에서 골라 입력칸에 다시 채운다
export function FormHistoryPicker<T>({
  history,
  onRestore,
  describe,
  status,
}: {
  history: FormRecord<T>[];
  onRestore: (index: number) => void;
  describe: (v: T) => string;
  status?: SaveStatus;
}) {
  if (history.length === 0 && !status) return null;
  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
      {status && <span className={status === 'local' ? 'text-warn' : 'text-inkSoft'}>{STATUS_TEXT[status]}</span>}
      {history.length > 0 && (
        <>
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
        </>
      )}
    </div>
  );
}
