import { getMyNotes, getSharedWithMeNotes } from './actions';
import NotesListClient from './NotesListClient';

export default async function NotesPage() {
  const [mine, shared] = await Promise.all([getMyNotes(), getSharedWithMeNotes()]);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-1">업무수첩</h1>
      <p className="text-sm text-inkSoft mb-5">
        노트를 적고, 필요하면 다른 계정과 공유할 수 있어요.
      </p>

      <NotesListClient
        myNotes={mine.notes}
        myNotesError={mine.error}
        sharedNotes={shared.notes}
        sharedNotesError={shared.error}
      />
    </div>
  );
}
