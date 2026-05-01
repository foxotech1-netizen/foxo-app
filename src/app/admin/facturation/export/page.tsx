import { createClient } from '@/lib/supabase/server';
import { ExportClient } from './ExportClient';

export const dynamic = 'force-dynamic';

export default async function ExportComptablePage() {
  const supabase = await createClient();

  const { data: param } = await supabase
    .from('parametres').select('valeur').eq('cle', 'email_comptable').maybeSingle();
  const emailComptable = (param?.valeur ?? '').toString().trim() || null;

  // Historique des exports comptables — on les enregistre dans
  // sms_logs.type='export_comptable' (table générique des envois admin).
  const { data: hist } = await supabase
    .from('sms_logs')
    .select('id, message, status, sent_at, sent_by, error')
    .eq('type', 'export_comptable')
    .order('sent_at', { ascending: false })
    .limit(20);

  type HistRow = {
    id: string;
    message: string | null;
    status: string | null;
    sent_at: string | null;
    sent_by: string | null;
    error: string | null;
  };
  const history = ((hist ?? []) as HistRow[]).map((h) => ({
    id: h.id,
    message: h.message,
    status: h.status,
    sent_at: h.sent_at,
    sent_by: h.sent_by,
    error: h.error,
  }));

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Export comptable</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Génère et envoie l&apos;export CSV des factures à ton comptable.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5">
        <ExportClient emailComptable={emailComptable} history={history} />
      </div>
    </>
  );
}
