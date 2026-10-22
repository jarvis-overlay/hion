'use client';

import { useRef, useState, useTransition } from 'react';
import { addItemNote, deleteItemNote } from '@/app/dashboard/sourcing/list/noteActions';
import { shrinkImageForUpload } from '@/lib/clientImage';

// 소싱 아이템/공급처 등 여러 대상에 재사용하는 메모 타임라인 - 단일
// 텍스트 필드(content/notes)와 달리 날짜별로 여러 건을 계속 쌓을 수
// 있고, 사진도 같이 남길 수 있다.
export default function NoteTimeline({
  entityType,
  entityId,
  notes,
}: {
  entityType: string;
  entityId: string;
  notes: any[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const sorted = [...notes].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <span className="text-xs font-semibold text-inkSoft">메모 기록 ({notes.length})</span>

      {sorted.length > 0 && (
        <div className="grid gap-2 mt-2">
          {sorted.map((n) => (
            <div key={n.id} className="bg-paper rounded px-2 py-1.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="text-inkSoft">
                  {new Date(n.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  {n.author_email && ` · ${n.author_email.split('@')[0]}`}
                </span>
                <button
                  onClick={() => startTransition(() => deleteItemNote(n.id))}
                  disabled={isPending}
                  className="text-inkSoft hover:text-red-700 shrink-0"
                >
                  삭제
                </button>
              </div>
              {n.body && (
                <p className="text-ink whitespace-pre-wrap break-words mt-1">{n.body}</p>
              )}
              {n.image_url && (
                <a href={n.image_url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={n.image_url}
                    alt=""
                    className="mt-1.5 max-h-40 rounded border border-paperLine"
                  />
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        ref={formRef}
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            if (file) fd.set('image', file);
            const res = await addItemNote(entityType, entityId, fd);
            if (!res || 'error' in res) {
              setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
              return;
            }
            formRef.current?.reset();
            setFile(null);
            setPreviewUrl(null);
          })
        }
        className="grid gap-1.5 mt-3"
      >
        <textarea
          name="body"
          placeholder="새 메모 (공장 답변, 진행 상황 등)"
          rows={2}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] text-accent font-semibold cursor-pointer">
            {file ? '사진 변경' : '+ 사진 첨부'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const raw = e.target.files?.[0] || null;
                const f = raw ? await shrinkImageForUpload(raw) : null;
                setFile(f);
                setPreviewUrl(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
          {previewUrl && (
            <div className="flex items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt=""
                className="h-8 w-8 object-cover rounded border border-paperLine"
              />
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setPreviewUrl(null);
                }}
                className="text-[11px] text-inkSoft hover:text-red-700"
              >
                제거
              </button>
            </div>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary py-1 px-3 text-xs font-semibold disabled:opacity-50 ml-auto"
          >
            {isPending ? '저장 중...' : '기록 추가'}
          </button>
        </div>
        {error && <p className="text-[11px] text-warn bg-warnBg rounded px-2 py-1">{error}</p>}
      </form>
    </div>
  );
}
