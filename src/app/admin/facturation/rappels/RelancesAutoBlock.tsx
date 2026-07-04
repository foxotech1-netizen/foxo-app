'use client';

// Bloc « Relances automatiques » de la page Rappels : aperçu dry-run des
// relances dues (moteur relances.ts), envoi confirmé (limit 20), et toggle
// « Suspendre les relances » par facture. S'ajoute AU-DESSUS de la page
// manuelle existante, sans la remplacer.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Zap, Send, RefreshCw, PauseCircle, PlayCircle } from 'lucide-react';
import type { RelanceCandidate } from '@/lib/facturation/relances';
import { previewRelancesDues, envoyerRelancesDues, setRelancesPause } from './actions';

const NIVEAU_LABEL: Record<number, string> = {
  1: 'Rappel',
  2: 'Deuxième rappel',
  3: 'Dernier rappel',
};

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export function RelancesAutoBlock() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [candidates, setCandidates] = useState<RelanceCandidate[] | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [pausePending, setPausePending] = useState<string | null>(null);

  function handlePreview() {
    setFeedback(null);
    startTransition(async () => {
      const res = await previewRelancesDues();
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setCandidates(res.data!.candidates);
    });
  }

  function handleSend() {
    const n = Math.min(candidates?.length ?? 0, 20);
    if (n === 0) return;
    if (!confirm(`Envoyer ces ${n} relance(s) par email (PDF joint) ?`)) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await envoyerRelancesDues();
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      const d = res.data!;
      setFeedback({
        kind: d.erreurs.length > 0 ? 'err' : 'ok',
        msg: `${d.envoyees}/${Math.min(d.candidates.length, 20)} relance(s) envoyée(s)`
          + (d.erreurs.length > 0
            ? ` — ${d.erreurs.length} erreur(s) : ${d.erreurs.map((e) => `${e.numero} (${e.error})`).join(' ; ').slice(0, 300)}`
            : '.'),
      });
      setCandidates(null);
      router.refresh();
    });
  }

  function handlePause(c: RelanceCandidate) {
    setPausePending(c.facture_id);
    startTransition(async () => {
      const res = await setRelancesPause(c.facture_id, true);
      setPausePending(null);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setCandidates((prev) => (prev ?? []).filter((x) => x.facture_id !== c.facture_id));
      setFeedback({ kind: 'ok', msg: `Relances suspendues pour ${c.numero}.` });
    });
  }

  return (
    <section className="bg-cream rounded-xl border border-sand-border p-4 space-y-3 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-bold text-ink flex items-center gap-1.5">
            <Zap size={15} aria-hidden className="text-[var(--color-amber-foxo)]" /> Relances automatiques
          </h2>
          <p className="text-[11px] text-ink-muted mt-0.5 max-w-[560px]">
            Niveaux selon les délais de <code>relance_delais_jours</code> (défaut 7, 14, 30 jours après
            échéance) — ton croissant, PDF et QR de paiement joints. Aperçu d&apos;abord, envoi après confirmation (20 max par passage).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePreview}
            disabled={pending}
            className="bg-white text-navy border border-navy-light px-3.5 py-2 rounded-lg text-[12px] font-bold hover:bg-navy-pale disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[40px]"
          >
            <RefreshCw size={14} aria-hidden className={pending ? 'animate-spin' : undefined} />
            Aperçu des relances dues
          </button>
          {candidates && candidates.length > 0 && (
            <button
              type="button"
              onClick={handleSend}
              disabled={pending}
              className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5 min-h-[40px]"
            >
              <Send size={14} aria-hidden /> Envoyer ces {Math.min(candidates.length, 20)} relance(s)
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={
            'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra')
          }
        >
          {feedback.msg}
        </div>
      )}

      {candidates !== null && (
        candidates.length === 0 ? (
          <p className="text-[12px] text-ink-mid italic">
            Aucune relance due — toutes les factures en retard ont déjà reçu le niveau correspondant, ou sont suspendues.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[680px]">
              <thead>
                <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted">
                  <th className="px-2.5 py-2 font-bold">Facture</th>
                  <th className="px-2.5 py-2 font-bold">Client</th>
                  <th className="px-2.5 py-2 font-bold text-right">TTC</th>
                  <th className="px-2.5 py-2 font-bold">Retard</th>
                  <th className="px-2.5 py-2 font-bold">Niveau dû</th>
                  <th className="px-2.5 py-2 font-bold text-right">Suspendre</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.facture_id} className="border-b border-sand-mid">
                    <td className="px-2.5 py-2">
                      <Link href={`/admin/facturation/${c.facture_id}`} className="font-mono text-xs font-bold text-navy hover:underline">
                        {c.numero}
                      </Link>
                    </td>
                    <td className="px-2.5 py-2 text-[12px]">{c.client_nom ?? '—'}</td>
                    <td className="px-2.5 py-2 text-[12px] font-mono text-right whitespace-nowrap">{fmtMoney(c.montant_ttc)}</td>
                    <td className="px-2.5 py-2 text-[12px] font-mono">{c.jours_de_retard} j</td>
                    <td className="px-2.5 py-2">
                      <span className={
                        'inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ' +
                        (c.niveau_du === 1
                          ? 'bg-navy-pale text-navy border-navy-light dark:text-white'
                          : c.niveau_du === 2
                            ? 'bg-amber-light text-[#8A5A1A] border-[#E8C896]'
                            : 'bg-terra-light text-terra border-terra-mid')
                      }>
                        {c.niveau_du} — {NIVEAU_LABEL[c.niveau_du]}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handlePause(c)}
                        disabled={pending || pausePending === c.facture_id}
                        title="Suspendre les relances pour cette facture (relances_pause)."
                        className="text-[11px] font-semibold text-ink-mid hover:text-terra inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <PauseCircle size={13} aria-hidden /> Suspendre
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}

// Badge + toggle compact pour le détail facture.
export function RelancesPauseBadge({
  factureId,
  paused,
}: {
  factureId: string;
  paused: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      await setRelancesPause(factureId, !paused);
      router.refresh();
    });
  }

  if (!paused) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title="Suspendre les relances automatiques pour cette facture."
        className="text-[10px] font-semibold text-ink-muted hover:text-terra inline-flex items-center gap-1 disabled:opacity-50"
      >
        <PauseCircle size={12} aria-hidden /> Suspendre les relances
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-[#8A5A1A] bg-amber-light border border-[#E8C896] rounded px-1.5 py-0.5">
        Relances suspendues
      </span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="text-[10px] font-semibold text-navy hover:underline inline-flex items-center gap-1 disabled:opacity-50"
      >
        <PlayCircle size={12} aria-hidden /> Réactiver
      </button>
    </span>
  );
}
