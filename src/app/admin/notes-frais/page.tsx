import { getNotesFrais } from './actions';
import { NotesFraisClient } from './NotesFraisClient';

export const dynamic = 'force-dynamic';

export default async function NotesFraisPage() {
  const result = await getNotesFrais();
  const notes = result.ok ? result.data : [];
  return <NotesFraisClient initialData={notes} />;
}
