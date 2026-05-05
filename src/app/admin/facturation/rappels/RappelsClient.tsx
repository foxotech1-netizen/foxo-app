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

  // Sélection multiple pour envoi groupé.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState<{ current: number; total: number; errors: number } | null>(null);
  const [batchMsg, setBatchMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  function toggleOne(id: string, checked: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  }
  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(enRetard.map((f) => f.id)) : new Set());
  }
  const allChecked = enRetard.length > 0 && selected.size === enRetard.length;
  const someChecked = selected.size > 0 && selected.size < enRetard.length;

  async function sendOneRaw(id: string): Promise<{ ok: boolean; error?: string; email_sent_to?: string }> {
    try {
      const r = await fetch(`/api/admin/facturation/send-rappel/${id}`, { method: 'POST' });
      return (await r.json()) as { ok: boolean; error?: string; email_sent_to?: string };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Erreur réseau.' };
    }
  }

  async function sendBulk() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBatchMsg(null);
    setBatch({ current: 0, total: ids.length, errors: 0 });
    let errors = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setBatch({ current: i + 1, total: ids.length, errors });
      setSendState((s) => ({ ...s, [id]: { sending: true } }));
      const res = await sendOneRaw(id);
      if (!res.ok) {
        errors++;
        setBatch({ current: i + 1, total: ids.length, errors });
        setSendState((s) => ({ ...s, [id]: { sending: false, kind: 'err', msg: res.error ?? 'Échec envoi.' } }));
      } else {
        setSendState((s) => ({
          ...s,
          [id]: { sending: false, kind: 'ok', msg: `Envoyé à ${res.email_sent_to ?? '—'}` },
        }));
      }
    }
    setBatch(null);
    setSelected(new Set());
    setBatchMsg({
      kind: errors > 0 ? 'err' : 'ok',
      msg: errors > 0
        ? `${ids.length - errors}/${ids.length} rappel${ids.length > 1 ? 's' : ''} envoyé${ids.length > 1 ? 's' : ''} — ${errors} erreur${errors > 1 ? 's' : ''}.`
        : `✓ ${ids.length} rappel${ids.length > 1 ? 's' : ''} envoyé${ids.length > 1 ? 's' : ''}.`,
    });
    router.refresh();
  }

  // Estime la date du prochain rappel : dernier rappel + 15j
  // (la cadence métier par défaut côté FoxO). Si jamais envoyé,
  // il sera basé sur la date d'échéance dépassée → "imminent".
  function nextRappelEstimate(rappelEnvoyeAt: string | null): string {
    if (!rappelEnvoyeAt) return 'imminent';
    const d = new Date(rappelEnvoyeAt);
    d.setDate(d.getDate() + 15);
    return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

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
      <section className="bg-cream rounded-xl border border-sand-border p-4 space-y-4">
        <div>
          <h2 className="text-[13px] font-extrabold text-ink">⚙️ Paramètres rappels</h2>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Variables disponibles dans le template : <code className="font-mono">{'{ref}'}</code>{' '}
            <code className="font-mono">{'{montant}'}</code>{' '}
            <code className="font-mono">{'{jours}'}</code>{' '}
            <code className="font-mono">{'{client}'}</code>
          </p>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer text-[13px]">
          <input
            type="checkbox"
            checked={params.rappels_auto_actifs}
            onChange={(e) => setParams((p) => ({ ...p, rappels_auto_actifs: e.target.checked }))}
            className="w-4 h-4 accent-[#1B3A6B]"
          />
          <span className="font-bold">Rappels automatiques actifs</span>
          <span className="text-[10px] text-ink-muted">
            (un cron enverra les rappels selon les délais ci-dessous)
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">
              Délai avant 1ᵉʳ rappel (jours après échéance)
            </label>
            <input
              type="number"
              min={0}
              value={params.rappel_delai_j1}
              onChange={(e) => setParams((p) => ({ ...p, rappel_delai_j1: e.target.value }))}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">
              Délai avant 2ᵉ rappel (jours après le 1er)
            </label>
            <input
              type="number"
              min={0}
              value={params.rappel_delai_j2}
              onChange={(e) => setParams((p) => ({ ...p, rappel_delai_j2: e.target.value }))}
              className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">
            Template email rappel
          </label>
          <textarea
            value={params.rappel_template_email}
            onChange={(e) => setParams((p) => ({ ...p, rappel_template_email: e.target.value }))}
            rows={8}
            className="w-full px-3 py-2 border border-sand-border rounded-lg text-[12px] bg-white outline-none focus:border-navy-mid resize-y font-mono"
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
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-[13px] font-extrabold text-ink flex items-center gap-2">
            🔔 Factures en retard
            <span className="text-[10px] font-bold text-ink-muted bg-sand-mid px-2 py-0.5 rounded-full dark:bg-[rgba(255,255,255,.06)]">
              {enRetard.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={sendBulk}
            disabled={selected.size === 0 || Boolean(batch)}
            className="bg-navy text-white px-3 py-1.5 rounded text-[11px] font-bold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {batch
              ? `Envoi ${batch.current}/${batch.total}…`
              : `📨 Envoyer les rappels sélectionnés (${selected.size})`}
          </button>
        </div>

        {batch && (
          <div className="mb-2 bg-navy-pale border border-navy-light rounded-md px-2.5 py-1.5">
            <div className="text-[11px] text-navy font-semibold mb-1">
              Envoi en cours… {batch.current}/{batch.total}
              {batch.errors > 0 && (
                <span className="text-terra ml-2">· {batch.errors} erreur{batch.errors > 1 ? 's' : ''}</span>
              )}
            </div>
            <div className="h-1.5 bg-sand-mid rounded-full overflow-hidden">
              <div
                className="h-full bg-navy transition-all"
                style={{ width: `${Math.round((batch.current / batch.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {batchMsg && (
          <div className={
            'mb-2 px-3 py-2 text-[11px] font-semibold rounded-md border ' +
            (batchMsg.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra')
          }>
            {batchMsg.msg}
          </div>
        )}
        {enRetard.length === 0 ? (
          <div className="bg-cream rounded-xl border border-sand-border p-6 text-center text-[12px] text-ink-muted">
            Aucune facture en retard. 🎉
          </div>
        ) : (
          <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[860px]">
                <thead>
                  <tr className="bg-sand">
                    <th className="px-3 py-2 border-b border-sand-border w-8">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => { if (el) el.indeterminate = someChecked; }}
                        onChange={(e) => toggleAll(e.target.checked)}
                        className="w-4 h-4 accent-[#1B3A6B] cursor-pointer"
                        aria-label="Tout sélectionner"
                      />
                    </th>
                    {['N°', 'Client', 'Référence', 'Échéance', 'Retard', 'Montant', 'Dernier rappel', 'Prochain rappel', 'Action'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {enRetard.map((f) => {
                    const retardJours = f.date_echeance ? Math.max(0, daysBetween(f.date_echeance, todayIso)) : 0;
                    const state = sendState[f.id];
                    const checked = selected.has(f.id);
                    return (
                      <tr key={f.id} className={'border-b border-sand-mid hover:bg-sand-hover ' + (checked ? 'bg-navy-pale/40/40' : '')}>
                        <td className="px-3 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => toggleOne(f.id, e.target.checked)}
                            disabled={Boolean(batch) || state?.sending}
                            className="w-4 h-4 accent-[#1B3A6B] cursor-pointer"
                            aria-label={`Sélectionner ${f.numero}`}
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link href={`/admin/facturation/${f.id}`} className="font-mono text-xs font-bold text-navy hover:underline">
                            {f.numero}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-xs font-semibold">{f.client_nom ?? '—'}</div>
                          {f.client_syndic && <div className="text-[10px] text-ink-muted">{f.client_syndic}</div>}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-ink-mid">{f.reference ?? '—'}</td>
                        <td className="px-3 py-2 text-[11px] text-ink-mid font-mono whitespace-nowrap">{fmtDate(f.date_echeance)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-block text-[10px] font-bold rounded-full px-2 py-0.5 bg-terra-light text-terra border border-terra-mid">
                            {retardJours}j
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[12px] font-mono font-bold whitespace-nowrap dark:text-white">{fmtMoney(f.montant_ttc)}</td>
                        <td className="px-3 py-2 text-[10px] text-ink-mid whitespace-nowrap">
                          {f.rappel_envoye_at
                            ? <>{fmtDate(f.rappel_envoye_at)} {f.rappel_count && f.rappel_count > 1 ? `(×${f.rappel_count})` : ''}</>
                            : <span className="italic">jamais</span>}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-ink-mid whitespace-nowrap">
                          {nextRappelEstimate(f.rappel_envoye_at)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => sendRappel(f.id)}
                            disabled={state?.sending || Boolean(batch)}
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
