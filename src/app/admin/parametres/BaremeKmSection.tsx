'use client';

// Section « Barème kilométrique » des Paramètres : liste des taux SPF
// (date_debut, taux_eur_km, actif) + ajout + désactivation. Aucun taux
// codé en dur : tout vient de la table bareme_km.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Route } from 'lucide-react';
import type { BaremeKm } from '@/lib/types/database';
import { addTauxKm, setTauxKmActif } from './bareme-actions';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function BaremeKmSection({ initial }: { initial: BaremeKm[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [dateDebut, setDateDebut] = useState('');
  const [taux, setTaux] = useState('');

  function handleAdd() {
    setFeedback(null);
    const t = Number(taux.replace(',', '.'));
    startTransition(async () => {
      const res = await addTauxKm(dateDebut, t);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setFeedback({ kind: 'ok', msg: 'Taux ajouté.' });
      setDateDebut('');
      setTaux('');
      router.refresh();
    });
  }

  function handleToggle(row: BaremeKm) {
    setFeedback(null);
    startTransition(async () => {
      const res = await setTauxKmActif(row.id, !row.actif);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      router.refresh();
    });
  }

  return (
    <section className="bg-cream rounded-xl border border-sand-border p-5 space-y-4">
      <div>
        <h2 className="fxs-block-title text-ink flex items-center gap-1.5">
          <Route size={16} aria-hidden /> Barème kilométrique
        </h2>
        <p className="text-[11px] text-ink-muted mt-0.5">
          Taux SPF en vigueur — à mettre à jour à chaque publication officielle.
          Utilisé pour les indemnités kilométriques des notes de frais (montant = km × taux du jour de la dépense).
        </p>
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

      {initial.length === 0 ? (
        <p className="text-[12px] text-ink-mid italic">
          Aucun taux configuré — les indemnités kilométriques sont indisponibles côté technicien tant qu&apos;un taux n&apos;est pas ajouté.
        </p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted">
              <th className="py-2 pr-3 font-bold">Applicable dès le</th>
              <th className="py-2 pr-3 font-bold">Taux (€/km)</th>
              <th className="py-2 pr-3 font-bold">Statut</th>
              <th className="py-2 font-bold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((r) => (
              <tr key={r.id} className="border-b border-sand-mid">
                <td className="py-2 pr-3 text-[12px] font-mono">{fmtDate(r.date_debut)}</td>
                <td className="py-2 pr-3 text-[12px] font-mono font-bold">{Number(r.taux_eur_km).toFixed(4)}</td>
                <td className="py-2 pr-3">
                  <span className={
                    'inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ' +
                    (r.actif ? 'bg-ok-light text-ok border-ok-mid' : 'bg-sand-mid text-ink-muted border-sand-border')
                  }>
                    {r.actif ? 'Actif' : 'Désactivé'}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleToggle(r)}
                    disabled={pending}
                    className="text-[11px] font-semibold text-navy hover:underline disabled:opacity-50"
                  >
                    {r.actif ? 'Désactiver' : 'Réactiver'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-sand-border pt-3">
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Applicable dès le</label>
          <input
            type="date"
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
            className="px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Taux (€/km)</label>
          <input
            value={taux}
            onChange={(e) => setTaux(e.target.value)}
            inputMode="decimal"
            placeholder="0.4265"
            className="px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono w-[120px]"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={pending || !dateDebut || !taux.trim()}
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[38px]"
        >
          {pending ? '…' : 'Ajouter le taux'}
        </button>
      </div>
    </section>
  );
}
