'use client';

import { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { noteEditorExtensions } from '@/lib/notes/editorExtensions';
import {
  getNoteHistory,
  getNoteHistoryEntry,
  type NoteHistoryDetail,
  type NoteHistoryListItem,
} from '../actions';

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

export default function HistoryPanel({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<NoteHistoryListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NoteHistoryDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let active = true;
    getNoteHistory(noteId).then((result) => {
      if (!active) return;
      if ('error' in result) {
        setListError(result.error);
        setEntries([]);
      } else {
        setEntries(result.entries);
      }
    });
    return () => {
      active = false;
    };
  }, [noteId]);

  function handleSelect(historyId: string) {
    setDetailError(null);
    setLoadingDetail(true);
    setSelected(null);
    getNoteHistoryEntry(historyId).then((result) => {
      setLoadingDetail(false);
      if ('error' in result) {
        setDetailError(result.error);
        return;
      }
      setSelected(result.entry);
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="font-display text-base font-bold">변경 이력</h2>
          <button type="button" onClick={onClose} className="text-sm text-inkSoft">
            닫기
          </button>
        </div>

        <div className="flex gap-4 flex-1 min-h-0">
          <div className="w-48 shrink-0 overflow-y-auto border-r border-paperLine pr-3">
            {listError && <p className="text-xs text-red-700 mb-2">⚠️ {listError}</p>}
            {entries === null ? (
              <p className="text-sm text-inkSoft">불러오는 중...</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-inkSoft">이력이 없어요.</p>
            ) : (
              <div className="grid gap-1">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => handleSelect(entry.id)}
                    className={`text-left text-xs px-2 py-1.5 rounded-lg hover:bg-paper/60 ${
                      selected?.id === entry.id ? 'bg-accentBg text-accent' : ''
                    }`}
                  >
                    <p className="font-semibold truncate">rev {entry.rev} · {entry.title || '(제목 없음)'}</p>
                    <p className="text-inkSoft mt-0.5">
                      {formatDate(entry.editedAt)}
                      {entry.editedByEmail ? ` · ${entry.editedByEmail}` : ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {detailError && <p className="text-sm text-red-700">⚠️ {detailError}</p>}
            {loadingDetail && <p className="text-sm text-inkSoft">불러오는 중...</p>}
            {!loadingDetail && !detailError && !selected && (
              <p className="text-sm text-inkSoft">왼쪽에서 이력을 선택해주세요.</p>
            )}
            {selected && <ReadOnlyHistoryView key={selected.id} entry={selected} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// key={entry.id}로 선택할 때마다 새 인스턴스를 만들어서 매번 다른 문서를
// 보여준다(에디터 인스턴스를 재사용하며 setContent로 바꾸는 대신, 보기전용
// 뷰라 상태가 가벼워서 다시 만드는 쪽이 더 단순하고 안전함).
function ReadOnlyHistoryView({ entry }: { entry: NoteHistoryDetail }) {
  const editor = useEditor({
    extensions: noteEditorExtensions,
    content: entry.body,
    editable: false,
    immediatelyRender: false,
  });

  return (
    <div>
      <p className="font-semibold mb-2">{entry.title || '(제목 없음)'}</p>
      <div className="note-history-view">
        {editor ? <EditorContent editor={editor} /> : <p className="text-sm text-inkSoft">불러오는 중...</p>}
      </div>
    </div>
  );
}
