'use client';

import { useRef, useState, useTransition } from 'react';
import {
  addItemNote,
  deleteItemNote,
  setItemNotePinned,
  addNoteCategory,
  deleteNoteCategory,
} from '@/app/dashboard/sourcing/list/noteActions';
import { shrinkImageForUpload } from '@/lib/clientImage';

// 라벨은 자유롭게 추가/삭제하니 색은 고정 매핑 대신 순서대로 돌려쓴다.
const COLOR_CYCLE = [
  'bg-profitBg text-profit',
  'bg-accentBg text-accent',
  'bg-warnBg text-warn',
  'bg-paperLine text-inkSoft',
];

function colorFor(categories: { id: string; label: string }[], label: string): string {
  const idx = categories.findIndex((c) => c.label === label);
  if (idx === -1) return 'bg-paperLine text-inkSoft';
  return COLOR_CYCLE[idx % COLOR_CYCLE.length];
}

// 소싱 아이템/공급처 등 여러 대상에 재사용하는 메모 타임라인 - 단일
// 텍스트 필드(content/notes)와 달리 날짜별로 여러 건을 계속 쌓을 수
// 있고, 사진도 같이 남길 수 있다. 동업자와 같이 보는 걸 전제로, 쌓일수록
// 찾기 쉽도록 카테고리 필터와 중요 메모 고정 기능을 더했다. 카테고리는
// 코드에 고정하지 않고(사용자마다 메모 성격이 달라서) 체크리스트 기본
// 항목처럼 화면에서 직접 추가/삭제한다.
export default function NoteTimeline({
  entityType,
  entityId,
  notes,
  categories,
}: {
  entityType: string;
  entityId: string;
  notes: any[];
  categories: { id: string; label: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [newPinned, setNewPinned] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');

  const visible = filterCategory ? notes.filter((n) => n.category === filterCategory) : notes;
  const pinned = [...visible.filter((n) => n.pinned)].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const regular = [...visible.filter((n) => !n.pinned)].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  function NoteCard({ n }: { n: any }) {
    return (
      <div className="bg-paper rounded px-2 py-1.5 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-inkSoft">
              {new Date(n.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              {n.author_email && ` · ${n.author_email.split('@')[0]}`}
            </span>
            {n.category && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${colorFor(categories, n.category)}`}>
                {n.category}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => startTransition(() => setItemNotePinned(n.id, !n.pinned))}
              disabled={isPending}
              className={n.pinned ? 'text-accent' : 'text-inkSoft hover:text-ink'}
            >
              {n.pinned ? '📌 고정 해제' : '📌 고정'}
            </button>
            <button
              onClick={() => startTransition(() => deleteItemNote(n.id))}
              disabled={isPending}
              className="text-inkSoft hover:text-red-700"
            >
              삭제
            </button>
          </div>
        </div>
        {n.body && <p className="text-ink whitespace-pre-wrap break-words mt-1">{n.body}</p>}
        {n.image_url && (
          <a href={n.image_url} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={n.image_url} alt="" className="mt-1.5 max-h-40 rounded border border-paperLine" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md ring-1 ring-paperLine p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-inkSoft">메모 기록 ({notes.length})</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 mb-2">
        <button
          onClick={() => setFilterCategory(null)}
          className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
            filterCategory === null ? 'bg-accent text-white' : 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine'
          }`}
        >
          전체
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilterCategory(filterCategory === c.label ? null : c.label)}
            className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
              filterCategory === c.label ? 'bg-accent text-white' : 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {pinned.length > 0 && (
        <div className="grid gap-2 mb-2">
          <span className="text-[11px] font-semibold text-accent">📌 고정된 메모</span>
          {pinned.map((n) => (
            <NoteCard key={n.id} n={n} />
          ))}
        </div>
      )}

      {regular.length > 0 && (
        <div className="grid gap-2">
          {regular.map((n) => (
            <NoteCard key={n.id} n={n} />
          ))}
        </div>
      )}

      {notes.length > 0 && visible.length === 0 && (
        <p className="text-[11px] text-inkSoft">이 카테고리에는 메모가 없어요.</p>
      )}

      <form
        ref={formRef}
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            if (file) fd.set('image', file);
            if (newCategory) fd.set('category', newCategory);
            fd.set('pinned', newPinned ? 'true' : 'false');
            const res = await addItemNote(entityType, entityId, fd);
            if (!res || 'error' in res) {
              setError(res?.error ?? '요청이 실패했어요. 다시 시도해주세요.');
              return;
            }
            formRef.current?.reset();
            setFile(null);
            setPreviewUrl(null);
            setNewCategory(null);
            setNewPinned(false);
          })
        }
        className="grid gap-1.5 mt-3 pt-3 border-t border-paperLine"
      >
        <textarea
          name="body"
          placeholder="새 메모 (공장 답변, 진행 상황 등 - 결론 위주로 짧게)"
          rows={2}
          className="border border-paperLine bg-white px-2 py-1.5 text-xs w-full"
        />

        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setNewCategory(newCategory === c.label ? null : c.label)}
              className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                newCategory === c.label
                  ? colorFor(categories, c.label) + ' ring-1 ring-inset ring-accent'
                  : 'bg-paper text-inkSoft ring-1 ring-inset ring-paperLine'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-inkSoft">
          <input
            type="checkbox"
            checked={newPinned}
            onChange={(e) => setNewPinned(e.target.checked)}
          />
          📌 중요 메모로 고정 (맨 위에 항상 표시)
        </label>

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
              <img src={previewUrl} alt="" className="h-8 w-8 object-cover rounded border border-paperLine" />
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

      <div className="mt-3 pt-3 border-t border-paperLine">
        <button
          type="button"
          onClick={() => setManagingCategories((v) => !v)}
          className="text-[11px] text-inkSoft hover:text-ink"
        >
          ⚙️ 카테고리 관리 (모든 메모 공통) {managingCategories ? '▲' : '▼'}
        </button>
        {managingCategories && (
          <div className="mt-2 grid gap-1.5">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 bg-paper rounded px-2 py-1 text-xs">
                <span>{c.label}</span>
                <button
                  onClick={() => startTransition(() => deleteNoteCategory(c.id))}
                  disabled={isPending}
                  className="text-inkSoft hover:text-red-700"
                >
                  삭제
                </button>
              </div>
            ))}
            <form
              action={() =>
                startTransition(async () => {
                  await addNoteCategory(newCategoryLabel);
                  setNewCategoryLabel('');
                })
              }
              className="flex gap-2"
            >
              <input
                value={newCategoryLabel}
                onChange={(e) => setNewCategoryLabel(e.target.value)}
                placeholder="새 카테고리 (예: 선적, 발주확정)"
                className="border border-paperLine bg-white px-2 py-1 text-xs flex-1"
              />
              <button
                type="submit"
                disabled={isPending || !newCategoryLabel.trim()}
                className="text-xs text-accent font-semibold disabled:opacity-50"
              >
                + 추가
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
