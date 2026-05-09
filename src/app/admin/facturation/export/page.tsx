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
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">
          Export comptable
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Génère et envoie l&apos;export CSV des factures à ton comptable
        </div>
      </div>

      <div>
        <ExportClient emailComptable={emailComptable} history={history} />
      </div>
    </>
  );
}
