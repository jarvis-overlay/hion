import Link from 'next/link';
import { getNote } from '../actions';
import NoteEditorClient from './NoteEditorClient';

export default async function NoteDetailPage({ params }: { params: { id: string } }) {
  const result = await getNote(params.id);

  if ('error' in result) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="card max-w-sm p-8 text-center">
          <h1 className="font-display text-lg font-bold mb-2">{result.error}</h1>
          <Link href="/dashboard/notes" className="btn-primary inline-block px-4 py-2 text-sm mt-2">
            목록으로
          </Link>
        </div>
      </main>
    );
  }

  return <NoteEditorClient note={result.note} />;
}
