'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Facture } from '@/lib/types/database';
import { setParametre } from '../actions';

type FactureLite = Pick<Facture, 'id' | 'numero' | 'client_nom' | 'client_syndic' | 'reference' | 'montant_ttc' | 'date_echeance'> & {
  rappel_envoye_at: string | null;
  rappel_count: number | null;
};

interface RappelParams {
  rappels_auto_actifs: boolean;
  rappel_delai_j1: string;
  rappel_delai_j2: string;
  rappel_template_email: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function daysBetween(fromIso: string, toIso: string): number {
  const f = new Date(fromIso);
  const t = new Date(toIso);
  return Math.floor((t.getTime() - f.getTime()) / 86_400_000);
}

export function RappelsClient({
  initialParams, enRetard, todayIso,
}: {
  initialParams: RappelParams;
  enRetard: FactureLite[];
  todayIso: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [params, setParams] = useState<RappelParams>(initialParams);
  const [paramSaveMsg, setParamSaveMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [paramsSaving, setParamsSaving] = useState(false);
  // Suivi de l'envoi par facture (id → { sending, msg, sent })
  const [sendState, setSendState] = useState<Record<string, { sending: boolean; msg?: string; kind?: 'ok' | 'err' }>>({});

  async function saveAllParams() {
    setParamsSaving(true);
    setParamSaveMsg(null);
    const updates: { cle: string; valeur: string }[] = [
      { cle: 'rappels_auto_actifs', valeur: params.rappels_auto_actifs ? 'true' : 'false' },
      { cle: 'rappel_delai_j1', valeur: String(parseInt(params.rappel_delai_j1, 10) || 7) },
      { cle: 'rappel_delai_j2', valeur: String(parseInt(params.rappel_delai_j2, 10) || 14) },
      { cle: 'rappel_template_email', valeur: params.rappel_template_email },
    ];
    let ok = true;
    let firstErr = '';
    for (const u of updates) {
      const r = await setParametre(u.cle, u.valeur);
      if (!r.ok) { ok = false; firstErr = firstErr || r.error; }
    }
    setParamsSaving(false);
    setParamSaveMsg(ok
      ? { kind: 'ok', msg: '✓ Paramètres enregistrés.' }
      : { kind: 'err', msg: firstErr || 'Erreur de sauvegarde.' },
    );
    if (ok) router.refresh();
  }

  function sendRappel(id: string) {
    setSendState((s) => ({ ...s, [id]: { sending: true } }));
    startTransition(async () => {
      try {
        const r = await fetch(`/api/admin/facturation/send-rappel/${id}`, { method: 'POST' });
        const data = await r.json();
        if (!data.ok) {
          setSendState((s) => ({ ...s, [id]: { sending: false, kind: 'err', msg: data.error ?? 'Échec envoi.' } }));
          return;
        }
        setSendState((s) => ({
          ...s,
          [id]: { sending: false, kind: 'ok', msg: `Envoyé à ${data.email_sent_to ?? '—'}` },
        }));
        router.refresh();
      } catch (e) {
        setSendState((s) => ({ ...s, [id]: { sending: false, kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' } }));
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Paramètres */}
      <section className="bg-cream rounded-xl border border-sand-border p-4 space-y-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div>
          <h2 className="text-[13px] font-extrabold text-ink dark:text-[#F0ECE4]">⚙️ Paramètres rappels</h2>
          <p className="text-[11px] text-ink-muted mt-0.5 dark:text-[#C8C2B8]">
            Variables disponibles dans le template : <code className="font-mono">{'{ref}'}</code>{' '}
            <code className="font-mono">{'{montant}'}</code>{' '}
            <code className="font-mono">{'{jours}'}</code>{' '}
            <code className="font-mono">{'{client}'}</code>
          </p>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer text-[13px] dark:text-[#F0ECE4]">
          <input
            type="checkbox"
            checked={params.rappels_auto_actifs}
            onChange={(e) => setParams((p) => ({ ...p, rappels_auto_actifs: e.target.checked }))}
            className="w-4 h-4 accent-[#1B3A6B]"
          />
          <span className="font-bold">Rappels automatiques actifs</span>
          <span className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">
            (un cron enverra les rappels selon les délais ci-dessous)
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1 dark:text-[#C8C2B8]">
              Délai avant 1ᵉʳ rappel (jours après échéance)
            </label>
            <input
              type="number"
              min={0}
              value={params.rappel_delai_j1}
              onChange={(e) => setParams((p) => ({ ...p, rappel_delai_j1: e.target.value }))}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1 dark:text-[#C8C2B8]">
              Délai avant 2ᵉ rappel (jours après le 1er)
            </label>
            <input
              type="number"
              min={0}
              value={params.rappel_delai_j2}
              onChange={(e) => setParams((p) => ({ ...p, rappel_delai_j2: e.target.value }))}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1 dark:text-[#C8C2B8]">
            Template email rappel
          </label>
          <textarea
            value={params.rappel_template_email}
            onChange={(e) => setParams((p) => ({ ...p, rappel_template_email: e.target.value }))}
            rows={8}
            className="w-full px-3 py-2 border border-sand-border rounded-lg text-[12px] bg-white outline-none focus:border-navy-mid resize-y font-mono dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveAllParams}
            disabled={paramsSaving}
            className="bg-navy text-white px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50"
          >
            {paramsSaving ? 'Enregistrement…' : '💾 Enregistrer les paramètres'}
          </button>
          {paramSaveMsg && (
            <span className={
              'text-[11px] font-semibold ' +
              (paramSaveMsg.kind === 'ok' ? 'text-ok' : 'text-terra')
            }>
              {paramSaveMsg.msg}
            </span>
          )}
        </div>
      </section>

      {/* Factures en retard */}
      <section>
        <h2 className="text-[13px] font-extrabold text-ink mb-2 flex items-center gap-2 dark:text-[#F0ECE4]">
          🔔 Factures en retard
          <span className="text-[10px] font-bold text-ink-muted bg-sand-mid px-2 py-0.5 rounded-full dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]">
            {enRetard.length}
          </span>
        </h2>
        {enRetard.length === 0 ? (
          <div className="bg-cream rounded-xl border border-sand-border p-6 text-center text-[12px] text-ink-muted dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#C8C2B8]">
            Aucune facture en retard. 🎉
          </div>
        ) : (
          <div className="bg-cream rounded-xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#3D3A32]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[860px]">
                <thead>
                  <tr className="bg-sand dark:bg-[#221E1A]">
                    {['N°', 'Client', 'Référence', 'Échéance', 'Retard', 'Montant', 'Dernier rappel', 'Action'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {enRetard.map((f) => {
                    const retardJours = f.date_echeance ? Math.max(0, daysBetween(f.date_echeance, todayIso)) : 0;
                    const state = sendState[f.id];
                    return (
                      <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#3D3A32] dark:hover:bg-[#2A2520]">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link href={`/admin/facturation/${f.id}`} className="font-mono text-xs font-bold text-navy hover:underline dark:text-[#A8C4F2]">
                            {f.numero}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs font-semibold dark:text-[#F0ECE4]">{f.client_nom ?? '—'}</div>
                          {f.client_syndic && <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">{f.client_syndic}</div>}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-ink-mid dark:text-[#C8C2B8]">{f.reference ?? '—'}</td>
                        <td className="px-3 py-2 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">{fmtDate(f.date_echeance)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-block text-[10px] font-bold rounded-full px-2 py-0.5 bg-terra-light text-terra border border-terra-mid">
                            {retardJours}j
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[12px] font-mono font-bold whitespace-nowrap dark:text-white">{fmtMoney(f.montant_ttc)}</td>
                        <td className="px-3 py-2 text-[10px] text-ink-mid whitespace-nowrap dark:text-[#C8C2B8]">
                          {f.rappel_envoye_at
                            ? <>{fmtDate(f.rappel_envoye_at)} {f.rappel_count && f.rappel_count > 1 ? `(×${f.rappel_count})` : ''}</>
                            : <span className="italic">jamais</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => sendRappel(f.id)}
                            disabled={state?.sending}
                            className="bg-[#A17244] text-white px-2.5 py-1 rounded text-[10px] font-bold hover:opacity-90 disabled:opacity-50"
                          >
                            {state?.sending ? '…' : '📤 Envoyer rappel'}
                          </button>
                          {state?.msg && (
                            <div className={'mt-1 text-[10px] font-semibold ' + (state.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                              {state.msg}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
