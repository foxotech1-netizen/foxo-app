'use client';

// Gestion des règles de mapping : table + drawer de création/édition
// (pattern fournisseurs), toggle actif direct, suppression définitive.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Trash2, Pencil } from 'lucide-react';
import type { RegleMapping } from '@/lib/types/database';
import {
  saveRegleMapping,
  setRegleMappingActif,
  deleteRegleMapping,
  type RegleMappingInput,
} from '../actions';

const EMPTY: RegleMappingInput = {
  motif: '',
  categorie_comptable: '',
  taux_deductibilite: 100,
  priorite: 100,
  actif: true,
};

export function ReglesClient({ initial }: { initial: RegleMapping[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [drawer, setDrawer] = useState<RegleMappingInput | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error ?? 'Erreur.' }); return; }
      setFeedback({ kind: 'ok', msg: okMsg });
      setDrawer(null);
      router.refresh();
    });
  }

  const inputCls = 'w-full px-3 py-2 border border-sand-border rounded-lg fx-body bg-cream outline-none focus:border-navy-mid';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="fx-meta text-ink-mid max-w-[560px]">
          À la capture d&apos;un achat, la première règle active (par priorité croissante)
          dont le motif apparaît dans le nom du fournisseur pré-remplit la catégorie
          comptable et la déductibilité. Les règles « apprises » sont créées
          automatiquement quand tu corriges une catégorie à la validation.
        </p>
        <button
          type="button"
          onClick={() => { setDrawer({ ...EMPTY }); setFeedback(null); }}
          className="fx-label bg-navy text-cream px-3.5 py-2 rounded-lg font-semibold hover:opacity-90 inline-flex items-center gap-1.5 min-h-[40px]"
        >
          <Plus size={14} aria-hidden /> Nouvelle règle
        </button>
      </div>

      {feedback && (
        <div
          className={'fx-label rounded-lg px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra-ink')
          }
        >
          {feedback.msg}
        </div>
      )}

      {initial.length === 0 ? (
        <div className="fx-body text-center py-14 text-ink-mid bg-cream rounded-xl border border-sand-border">
          Aucune règle pour l&apos;instant. Elles se créeront aussi automatiquement au fil des validations.
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setDrawer({ ...EMPTY })}
              className="fx-label text-navy font-semibold underline hover:no-underline"
            >
              Créer une première règle
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-cream rounded-xl border border-sand-border overflow-x-auto">
          <table className="w-full text-left min-w-[760px]">
            <thead>
              <tr className="fx-eyebrow border-b border-sand-border text-ink-mid">
                <th className="px-3.5 py-2.5 font-semibold">Motif</th>
                <th className="px-3.5 py-2.5 font-semibold">Catégorie comptable</th>
                <th className="px-3.5 py-2.5 font-semibold">Déductibilité</th>
                <th className="px-3.5 py-2.5 font-semibold">Priorité</th>
                <th className="px-3.5 py-2.5 font-semibold">Origine</th>
                <th className="px-3.5 py-2.5 font-semibold">Actif</th>
                <th className="px-3.5 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initial.map((r) => (
                <tr key={r.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="fx-body-dense px-3.5 py-2.5 font-semibold text-navy">{r.motif}</td>
                  <td className="fx-body-dense px-3.5 py-2.5">{r.categorie_comptable ?? '—'}</td>
                  <td className="fx-small px-3.5 py-2.5 tabular-nums">{r.taux_deductibilite != null ? `${r.taux_deductibilite} %` : '—'}</td>
                  <td className="fx-small px-3.5 py-2.5 tabular-nums">{r.priorite}</td>
                  <td className="px-3.5 py-2.5">
                    {r.apprise ? (
                      <span
                        className="fx-eyebrow inline-block font-semibold text-amber-ink bg-amber-light border border-[var(--color-amber-foxo)]/30 rounded px-1.5 py-0.5"
                        title={`Créée par apprentissage — confirmée ${r.occurrences} fois`}
                      >
                        Apprise ×{r.occurrences}
                      </span>
                    ) : (
                      <span className="fx-small text-ink-mid">Manuelle</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <label className="fx-small inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.actif}
                        disabled={pending}
                        onChange={(e) => run(() => setRegleMappingActif(r.id, e.target.checked), 'Règle mise à jour.')}
                        className="accent-[var(--color-navy)]"
                      />
                      {r.actif ? 'Oui' : 'Non'}
                    </label>
                  </td>
                  <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        setDrawer({
                          id: r.id,
                          motif: r.motif,
                          categorie_comptable: r.categorie_comptable ?? '',
                          taux_deductibilite: r.taux_deductibilite,
                          priorite: r.priorite,
                          actif: r.actif,
                        });
                        setFeedback(null);
                      }}
                      className="fx-small font-semibold text-navy hover:underline inline-flex items-center gap-1 mr-3"
                    >
                      <Pencil size={12} aria-hidden /> Éditer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Supprimer définitivement la règle « ${r.motif} » ?`)) return;
                        run(() => deleteRegleMapping(r.id), 'Règle supprimée.');
                      }}
                      disabled={pending}
                      className="fx-small font-semibold text-terra-ink hover:underline inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Trash2 size={12} aria-hidden /> Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer création / édition */}
      {drawer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
          <div className="bg-sand h-full w-full max-w-[400px] overflow-y-auto p-5 space-y-4 border-l border-sand-border">
            <div className="flex items-center justify-between">
              <h2 className="fx-h3 font-semibold text-ink">
                {drawer.id ? 'Éditer la règle' : 'Nouvelle règle'}
              </h2>
              <button type="button" onClick={() => setDrawer(null)} className="text-ink-mid hover:text-ink" aria-label="Fermer">
                <X size={16} aria-hidden />
              </button>
            </div>

            <div>
              <label className="fx-label font-semibold text-ink-mid block mb-1.5">Motif * (contenu dans le nom fournisseur)</label>
              <input
                value={drawer.motif}
                onChange={(e) => setDrawer({ ...drawer, motif: e.target.value })}
                placeholder="Q8, Brico, Proximus…"
                className={inputCls}
              />
            </div>
            <div>
              <label className="fx-label font-semibold text-ink-mid block mb-1.5">Catégorie comptable</label>
              <input
                value={drawer.categorie_comptable ?? ''}
                onChange={(e) => setDrawer({ ...drawer, categorie_comptable: e.target.value })}
                placeholder="Carburant, Télécom…"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="fx-label font-semibold text-ink-mid block mb-1.5">Déductibilité (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={drawer.taux_deductibilite ?? ''}
                  onChange={(e) => setDrawer({
                    ...drawer,
                    taux_deductibilite: e.target.value === '' ? null : Number(e.target.value),
                  })}
                  className={`${inputCls} tabular-nums`}
                />
              </div>
              <div>
                <label className="fx-label font-semibold text-ink-mid block mb-1.5">Priorité (croissante)</label>
                <input
                  type="number"
                  min={1}
                  value={drawer.priorite ?? 100}
                  onChange={(e) => setDrawer({ ...drawer, priorite: parseInt(e.target.value, 10) || 100 })}
                  className={`${inputCls} tabular-nums`}
                />
              </div>
            </div>
            <label className="fx-label flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={drawer.actif ?? true}
                onChange={(e) => setDrawer({ ...drawer, actif: e.target.checked })}
                className="accent-[var(--color-navy)]"
              />
              Active
            </label>

            <div className="flex gap-2 pt-2 border-t border-sand-border">
              <button
                type="button"
                onClick={() => run(() => saveRegleMapping(drawer), drawer.id ? 'Règle mise à jour.' : 'Règle créée.')}
                disabled={pending || !drawer.motif.trim()}
                className="fx-body bg-navy text-cream px-4 py-2.5 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 min-h-[44px] flex-1"
              >
                {pending ? '…' : 'Enregistrer'}
              </button>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                disabled={pending}
                className="fx-body bg-cream text-ink-mid border border-sand-border px-4 py-2.5 rounded-lg font-semibold hover:bg-sand-hover disabled:opacity-50 min-h-[44px]"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
