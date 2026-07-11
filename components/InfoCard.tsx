'use client';

import { useTransition } from 'react';
import { deleteSourcingNote } from '@/app/dashboard/sourcing/info/actions';

export default function InfoCard({ note }: { note: any }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="card p-4 flex flex-col gap-2">
      <h3 className="font-semibold text-sm">{note.title}</h3>
      {note.link && (
        <a
          href={note.link}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-profit underline break-all"
        >
          {note.link}
        </a>
      )}
      {note.content && (
        <p className="text-xs text-ink whitespace-pre-wrap">{note.content}</p>
      )}
      <div className="flex items-center justify-between mt-1 pt-2 border-t border-paperLine">
        <span className="text-[11px] text-inkSoft">
          {note.author_email?.split('@')[0]} ·{' '}
          {new Date(note.created_at).toLocaleDateString('ko-KR')}
        </span>
        <button
          onClick={() => startTransition(() => deleteSourcingNote(note.id))}
          disabled={isPending}
          className="text-xs text-inkSoft hover:text-red-700"
        >
          삭제
        </button>
      </div>
    </div>
  );
}
