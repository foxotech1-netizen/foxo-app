import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { NoteFrais } from '@/lib/types/database';
import { NotesFraisTechClient } from './NotesFraisTechClient';

export const dynamic = 'force-dynamic';

export default async function TechNotesFraisPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) redirect('/auth/login');

  const email = user.email.toLowerCase();

  // Service-role pour bypass RLS — l'ownership est filtrée explicitement
  // sur technicien_email (le tech ne voit que ses propres notes).
  const admin = createAdminClient();
  const { data } = await admin
    .from('notes_frais')
    .select('*')
    .eq('technicien_email', email)
    .is('deleted_at', null)
    .order('date_depense', { ascending: false });

  return (
    <NotesFraisTechClient
      initialData={(data ?? []) as NoteFrais[]}
      techEmail={email}
    />
  );
}
