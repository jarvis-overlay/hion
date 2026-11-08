'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createNote, deleteNote, type NoteListItem, type SharedNoteListItem } from './actions';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotesListClient({
  myNotes,
  myNotesError,
  sharedNotes,
  sharedNotesError,
}: {
  myNotes: NoteListItem[];
  myNotesError: string | null;
  sharedNotes: SharedNoteListItem[];
  sharedNotesError: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'shared'>('mine');
  const [isPending, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);
  // "+ 새 노트"를 빠르게 두 번 누르면 isPending 상태 반영 전에 두 번째
  // 클릭이 먼저 들어가 빈 노트가 중복 생성될 수 있다 - ref 플래그로 그
  // 타이밍 틈을 막는다.
  const creatingRef = useRef(false);

  function handleCreate() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreateError(null);
    startTransition(async () => {
      const result = await createNote();
      creatingRef.current = false;
      if ('error' in result) {
        setCreateError(result.error);
        return;
      }
      router.push(`/dashboard/notes/${result.id}`);
    });
  }

  function handleDelete(id: string) {
    if (!confirm('정말 삭제할까요? 되돌릴 수 없어요.')) return;
    startTransition(async () => {
      const result = await deleteNote(id);
      if ('error' in result) {
        alert(result.error);
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-paperLine/60 p-1 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setTab('mine')}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
              tab === 'mine' ? 'bg-white text-accent shadow-card' : 'text-inkSoft'
            }`}
          >
            내 수첩
          </button>
          <button
            type="button"
            onClick={() => setTab('shared')}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
              tab === 'shared' ? 'bg-white text-accent shadow-card' : 'text-inkSoft'
            }`}
          >
            공유받은 수첩
            {sharedNotes.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center text-[11px] bg-accentBg text-accent rounded-full px-1.5 py-0.5">
                {sharedNotes.length}
              </span>
            )}
          </button>
        </div>

        {tab === 'mine' && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
          >
            + 새 노트
          </button>
        )}
      </div>

      {createError && <p className="text-sm text-red-700 mb-3">⚠️ {createError}</p>}

      {tab === 'mine' && (
        <div>
          {myNotesError && <p className="text-sm text-red-700 mb-3">⚠️ {myNotesError}</p>}
          {myNotes.length === 0 && !myNotesError ? (
            <p className="text-sm text-inkSoft">
              아직 노트가 없어요. 위에서 + 새 노트를 눌러 시작해보세요.
            </p>
          ) : (
            <div className="grid gap-2">
              {myNotes.map((note) => (
                <div
                  key={note.id}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <Link href={`/dashboard/notes/${note.id}`} className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{note.title || '(제목 없음)'}</p>
                    <p className="text-xs text-inkSoft mt-0.5">
                      {formatDate(note.updatedAt)}
                      {note.updatedByEmail ? ` · ${note.updatedByEmail}` : ''}
                    </p>
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(note.id)}
                    disabled={isPending}
                    className="text-xs text-inkSoft hover:text-red-700 shrink-0"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'shared' && (
        <div>
          {sharedNotesError && <p className="text-sm text-red-700 mb-3">⚠️ {sharedNotesError}</p>}
          {sharedNotes.length === 0 && !sharedNotesError ? (
            <p className="text-sm text-inkSoft">아직 공유받은 노트가 없어요.</p>
          ) : (
            <div className="grid gap-2">
              {sharedNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/dashboard/notes/${note.id}`}
                  className="card p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{note.title || '(제목 없음)'}</p>
                    <p className="text-xs text-inkSoft mt-0.5">
                      {note.ownerEmail} · {formatDate(note.updatedAt)}
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-semibold rounded-full px-2 py-1 shrink-0 ${
                      note.permission === 'edit' ? 'bg-profitBg text-profit' : 'bg-paperLine text-inkSoft'
                    }`}
                  >
                    {note.permission === 'edit' ? '편집 가능' : '보기 전용'}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
