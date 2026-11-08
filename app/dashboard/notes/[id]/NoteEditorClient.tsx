'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEditor, EditorContent, useEditorState, type JSONContent } from '@tiptap/react';
import { noteEditorExtensions } from '@/lib/notes/editorExtensions';
import { saveNote, deleteNote, type NoteDetail } from '../actions';
import ShareDialog from './ShareDialog';
import HistoryPanel from './HistoryPanel';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const VIEW_ONLY_SAVE_ERROR = '보기 전용 노트라 저장할 수 없어요.';

export default function NoteEditorClient({ note }: { note: NoteDetail }) {
  const router = useRouter();
  const canEdit = note.permission === 'owner' || note.permission === 'edit';

  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [forcedReadOnly, setForcedReadOnly] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 서버가 저장 중 보기 전용으로 판단하면 바로 편집을 잠근다(원래도
  // view면 처음부터 editable=false).
  const editable = canEdit && !forcedReadOnly;

  const titleRef = useRef(title);
  titleRef.current = title;
  const baseRevRef = useRef(note.rev);
  const savingRef = useRef(false);
  const pendingRef = useRef<{ title: string; body: JSONContent } | null>(null);
  const retryCountRef = useRef(0);
  // 재시도 타이머는 항상 "발화 시점의 최신 내용"으로 저장한다(스냅샷을
  // 들고 있지 않음) - 그래야 1차 실패 → 재입력 → 2차 실패처럼 연속으로
  // 실패해도, 늦게 발화한 재시도 타이머가 오래된 내용으로 최신 입력을
  // 덮어쓰는 일이 생기지 않는다. 대신 실패를 새로 처리할 때마다(또는
  // 성공 시) 기존에 걸려있는 타이머는 항상 먼저 지운다 - 안 그러면 1차
  // 실패 때 예약한 타이머가 2차 실패 처리에서 안 지워지고 그대로 발화해
  // 버린다.
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualRetryRef = useRef<{ title: string; body: JSONContent } | null>(null);

  const editor = useEditor({
    extensions: noteEditorExtensions,
    content: note.body,
    editable,
    immediatelyRender: false,
    onUpdate: () => {
      scheduleSave();
    },
  });

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        heading1: e.isActive('heading', { level: 1 }),
        heading2: e.isActive('heading', { level: 2 }),
        blockquote: e.isActive('blockquote'),
        codeBlock: e.isActive('codeBlock'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        taskList: e.isActive('taskList'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  async function doSave(titleToSave: string, bodyToSave: JSONContent) {
    if (savingRef.current) {
      pendingRef.current = { title: titleToSave, body: bodyToSave };
      return;
    }
    savingRef.current = true;
    setStatus('saving');
    setErrorMessage(null);

    const result = await saveNote(note.id, baseRevRef.current, titleToSave, bodyToSave);
    savingRef.current = false;

    if ('error' in result) {
      handleSaveError(titleToSave, bodyToSave, result.error, result.retryable !== false);
      return;
    }

    // 이 저장이 성공했으니, 혹시 남아있는 "낡은 내용" 재시도 타이머는
    // 반드시 지운다 - 안 지우면 늦게 발화해서 지금 막 성공한 최신 저장을
    // 낡은 내용으로 덮어쓸 수 있다.
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    baseRevRef.current = result.rev;
    retryCountRef.current = 0;
    manualRetryRef.current = null;
    setStatus('saved');
    if (result.conflictMessage) setConflictMessage(result.conflictMessage);

    if (pendingRef.current) {
      const next = pendingRef.current;
      pendingRef.current = null;
      doSave(next.title, next.body);
    }
  }

  function handleSaveError(
    titleToSave: string,
    bodyToSave: JSONContent,
    message: string,
    retryable: boolean
  ) {
    // 새로운 실패를 처리할 때는 항상 먼저 기존에 걸려있는 재시도 타이머를
    // 지운다 - 안 지우면 이번 실패보다 먼저 예약된 "낡은 내용" 타이머가
    // 그대로 남아 있다가 나중에 발화해서 최신 입력을 덮어쓸 수 있다.
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (message === VIEW_ONLY_SAVE_ERROR) {
      setForcedReadOnly(true);
      setStatus('error');
      setErrorMessage('이 노트는 보기 전용으로 바뀌었어요. 입력하신 내용은 저장되지 않았어요.');
      return;
    }

    // retryable=false: 재시도해도 같은 이유로 또 실패하는 에러(제목/내용
    // 길이 초과 등). 자동 재시도를 걸지 않고 서버가 준 구체적인 메시지를
    // 바로 보여준다 - 사용자가 입력을 고치면(제목을 줄이면) 다음 자동저장이
    // 스스로 다시 성공한다.
    if (!retryable) {
      retryCountRef.current = 0;
      manualRetryRef.current = null;
      setStatus('error');
      setErrorMessage(message);
      return;
    }

    setStatus('error');
    manualRetryRef.current = { title: titleToSave, body: bodyToSave };

    if (retryCountRef.current < 1) {
      retryCountRef.current += 1;
      setErrorMessage('저장 못 했어요 — 다시 시도 중...');
      // 재시도가 실제로 발화하는 시점엔 그때 예약했던 titleToSave/bodyToSave
      // (낡은 스냅샷)를 쓰지 않고, 항상 에디터의 "지금" 최신 내용으로
      // 저장한다 - 그래야 1차 실패 이후 사용자가 더 입력한 내용이 있어도
      // 이 타이머가 그걸 낡은 내용으로 덮어쓰는 일이 없다.
      retryTimeoutRef.current = setTimeout(() => {
        retryTimeoutRef.current = null;
        if (!editor) return;
        doSave(titleRef.current, editor.getJSON());
      }, 2000);
    } else {
      setErrorMessage('저장 실패. 눌러서 다시 저장');
    }
  }

  function scheduleSave() {
    if (!editable) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!editor) return;
      doSave(titleRef.current, editor.getJSON());
    }, 800);
  }

  function handleTitleChange(value: string) {
    setTitle(value);
    scheduleSave();
  }

  function handleManualRetry() {
    const pending = manualRetryRef.current;
    if (!pending) return;
    retryCountRef.current = 0;
    doSave(pending.title, pending.body);
  }

  function handleDelete() {
    if (!confirm('정말 삭제할까요? 되돌릴 수 없어요.')) return;
    setIsDeleting(true);
    deleteNote(note.id).then((result) => {
      setIsDeleting(false);
      if ('error' in result) {
        alert(result.error);
        return;
      }
      router.push('/dashboard/notes');
    });
  }

  const statusLabel =
    status === 'saving'
      ? '저장 중...'
      : status === 'saved'
        ? '저장됨'
        : status === 'error'
          ? errorMessage || '오류'
          : !editor
            ? '불러오는 중...'
            : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => router.push('/dashboard/notes')}
          className="text-sm text-inkSoft hover:text-ink"
        >
          ← 목록으로
        </button>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${status === 'error' ? 'text-red-700' : 'text-inkSoft'}`}
          >
            {statusLabel}
          </span>
          {status === 'error' && errorMessage === '저장 실패. 눌러서 다시 저장' && (
            <button
              type="button"
              onClick={handleManualRetry}
              className="text-xs font-semibold text-accent underline"
            >
              다시 저장
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="text-sm px-3 py-1.5 rounded-lg border border-paperLine hover:bg-paper/60"
          >
            변경 이력
          </button>
          {note.permission === 'owner' && (
            <>
              <button
                type="button"
                onClick={() => setShowShare(true)}
                className="text-sm px-3 py-1.5 rounded-lg border border-paperLine hover:bg-paper/60"
              >
                공유
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-sm px-3 py-1.5 rounded-lg border border-paperLine text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                삭제
              </button>
            </>
          )}
        </div>
      </div>

      {!canEdit && (
        <p className="text-sm text-inkSoft mb-3 bg-paperLine/50 rounded-lg px-3 py-2">
          {note.ownerEmail}님이 공유한 노트 · 보기 전용
        </p>
      )}
      {note.permission === 'edit' && (
        <p className="text-sm text-inkSoft mb-3 bg-paperLine/50 rounded-lg px-3 py-2">
          {note.ownerEmail}님이 공유한 노트 · 편집 가능 — 고치면 원본이 바뀌어요
        </p>
      )}

      {conflictMessage && (
        <div className="flex items-start justify-between gap-3 bg-warnBg text-warn rounded-lg px-3 py-2 mb-3 text-sm">
          <span>{conflictMessage}</span>
          <button
            type="button"
            onClick={() => setConflictMessage(null)}
            className="shrink-0 font-semibold"
          >
            닫기
          </button>
        </div>
      )}

      <input
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        disabled={!editable}
        maxLength={300}
        placeholder="제목을 입력하세요"
        className="w-full text-xl font-bold mb-3 bg-transparent border-b border-paperLine pb-2 outline-none disabled:text-inkSoft"
      />

      {editable && editor && (
        <div className="flex flex-wrap items-center gap-1 mb-2 p-1.5 card">
          <ToolbarButton
            label="H1"
            active={toolbarState?.heading1}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          />
          <ToolbarButton
            label="H2"
            active={toolbarState?.heading2}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <Divider />
          <ToolbarButton
            label="B"
            active={toolbarState?.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            label="I"
            active={toolbarState?.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            label="U"
            active={toolbarState?.underline}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <ToolbarButton
            label="S"
            active={toolbarState?.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          />
          <Divider />
          <select
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              if (!value) editor.chain().focus().unsetFontSize().run();
              else editor.chain().focus().setFontSize(value).run();
              e.target.value = '';
            }}
            className="text-xs border border-paperLine rounded-md px-1.5 py-1"
          >
            <option value="">글자 크기</option>
            <option value="12px">작게</option>
            <option value="16px">보통</option>
            <option value="20px">크게</option>
            <option value="28px">아주 크게</option>
          </select>
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title="글자 색"
              onClick={() => editor.chain().focus().setColor(color).run()}
              className="w-5 h-5 rounded-full border border-paperLine"
              style={{ backgroundColor: color }}
            />
          ))}
          <button
            type="button"
            title="글자 색 지우기"
            onClick={() => editor.chain().focus().unsetColor().run()}
            className="text-xs text-inkSoft px-1"
          >
            x
          </button>
          <Divider />
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title="형광펜"
              onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
              className="w-5 h-5 rounded-md border border-paperLine"
              style={{ backgroundColor: color }}
            />
          ))}
          <button
            type="button"
            title="형광펜 지우기"
            onClick={() => editor.chain().focus().unsetHighlight().run()}
            className="text-xs text-inkSoft px-1"
          >
            x
          </button>
          <Divider />
          <ToolbarButton
            label="인용"
            active={toolbarState?.blockquote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
          <ToolbarButton
            label="코드"
            active={toolbarState?.codeBlock}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
          <ToolbarButton
            label="목록"
            active={toolbarState?.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            label="번호"
            active={toolbarState?.orderedList}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            label="체크"
            active={toolbarState?.taskList}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          />
          <Divider />
          <ToolbarButton
            label="되돌리기"
            disabled={!toolbarState?.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          />
          <ToolbarButton
            label="다시하기"
            disabled={!toolbarState?.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          />
        </div>
      )}

      <div className="card p-4 min-h-[50vh] note-editor">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <p className="text-sm text-inkSoft">불러오는 중...</p>
        )}
      </div>

      {showShare && note.permission === 'owner' && (
        <ShareDialog noteId={note.id} onClose={() => setShowShare(false)} />
      )}
      {showHistory && <HistoryPanel noteId={note.id} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

const TEXT_COLORS = ['#1F2430', '#F5285C', '#2563EB', '#10B981', '#F59E0B', '#7C3AED'];
const HIGHLIGHT_COLORS = ['#FFF3A3', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA'];

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-xs font-semibold px-2 py-1.5 rounded-md transition-colors disabled:opacity-40 ${
        active ? 'bg-accentBg text-accent' : 'text-ink hover:bg-paper'
      }`}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-paperLine mx-0.5" />;
}
