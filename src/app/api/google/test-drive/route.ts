import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { testDriveConnection } from '@/lib/google-drive';
import { loadTokens } from '@/lib/google-auth';

export const dynamic = 'force-dynamic';

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
];

// Vérifie l'accès aux 2 dossiers racines Drive (RAPPORTS + FACTURES).
// Renvoie { rapports: {ok, name?, error?, status?}, factures: {...},
// scopes: { granted: string[], missing: string[], has_drive_full: bool } }.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  // Diagnostic scope : log + retour pour la UI
  const tokens = await loadTokens();
  const grantedRaw = tokens?.scope ?? '';
  const granted = grantedRaw.split(/\s+/).filter(Boolean);
  const missing = REQUIRED_SCOPES.filter((s) => !granted.includes(s));
  const hasDriveFull = granted.includes('https://www.googleapis.com/auth/drive');
  const hasDriveFile = granted.includes('https://www.googleapis.com/auth/drive.file');

  console.error('[drive-test] scopes diagnostic', {
    account: tokens?.email,
    granted,
    missing,
    has_drive_full: hasDriveFull,
    has_drive_file_only: hasDriveFile && !hasDriveFull,
  });

  const result = await testDriveConnection();
  return NextResponse.json({
    ok: true,
    ...result,
    scopes: {
      granted,
      missing,
      has_drive_full: hasDriveFull,
      has_drive_file_only: hasDriveFile && !hasDriveFull,
      account: tokens?.email ?? null,
    },
  });
}
