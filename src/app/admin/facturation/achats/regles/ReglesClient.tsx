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

  const inputCls =
    'w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-ink-mid max-w-[560px]">
          À la capture d&apos;un achat, la première règle active (par priorité croissante)
          dont le motif apparaît dans le nom du fournisseur pré-remplit la catégorie
          comptable et la déductibilité. Les règles « apprises » sont créées
          automatiquement quand tu corriges une catégorie à la validation.
        </p>
        <button
          type="button"
          onClick={() => { setDrawer({ ...EMPTY }); setFeedback(null); }}
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center gap-1.5 min-h-[40px]"
        >
          <Plus size={14} aria-hidden /> Nouvelle règle
        </button>
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
        <div className="text-center py-14 text-ink-muted text-[13px] bg-cream rounded-xl border border-sand-border">
          Aucune règle pour l&apos;instant. Elles se créeront aussi automatiquement au fil des validations.
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setDrawer({ ...EMPTY })}
              className="text-navy font-bold underline hover:no-underline text-[12px]"
            >
              Créer une première règle
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-cream rounded-xl border border-sand-border overflow-x-auto">
          <table className="w-full text-left min-w-[760px]">
            <thead>
              <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="px-3.5 py-2.5 font-bold">Motif</th>
                <th className="px-3.5 py-2.5 font-bold">Catégorie comptable</th>
                <th className="px-3.5 py-2.5 font-bold">Déductibilité</th>
                <th className="px-3.5 py-2.5 font-bold">Priorité</th>
                <th className="px-3.5 py-2.5 font-bold">Origine</th>
                <th className="px-3.5 py-2.5 font-bold">Actif</th>
                <th className="px-3.5 py-2.5 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initial.map((r) => (
                <tr key={r.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-2.5 text-xs font-bold text-navy">{r.motif}</td>
                  <td className="px-3.5 py-2.5 text-[12px]">{r.categorie_comptable ?? '—'}</td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono">{r.taux_deductibilite != null ? `${r.taux_deductibilite} %` : '—'}</td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono">{r.priorite}</td>
                  <td className="px-3.5 py-2.5">
                    {r.apprise ? (
                      <span
                        className="inline-block text-[9px] font-bold uppercase tracking-wider text-[#8A5A1A] bg-amber-light border border-[#E8C896] rounded px-1.5 py-0.5"
                        title={`Créée par apprentissage — confirmée ${r.occurrences} fois`}
                      >
                        Apprise ×{r.occurrences}
                      </span>
                    ) : (
                      <span className="text-[10px] text-ink-muted">Manuelle</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={r.actif}
                        disabled={pending}
                        onChange={(e) => run(() => setRegleMappingActif(r.id, e.target.checked), 'Règle mise à jour.')}
                        className="accent-[#1B3A6B]"
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
                      className="text-[11px] font-semibold text-navy hover:underline inline-flex items-center gap-1 mr-3"
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
                      className="text-[11px] font-semibold text-terra hover:underline inline-flex items-center gap-1 disabled:opacity-50"
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
              <h2 className="text-[14px] font-bold text-ink">
                {drawer.id ? 'Éditer la règle' : 'Nouvelle règle'}
              </h2>
              <button type="button" onClick={() => setDrawer(null)} className="text-ink-muted hover:text-ink" aria-label="Fermer">
                <X size={16} aria-hidden />
              </button>
            </div>

            <div>
              <label className="text-xs font-semibold text-ink-mid block mb-1.5">Motif * (contenu dans le nom fournisseur)</label>
              <input
                value={drawer.motif}
                onChange={(e) => setDrawer({ ...drawer, motif: e.target.value })}
                placeholder="Q8, Brico, Proximus…"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-mid block mb-1.5">Catégorie comptable</label>
              <input
                value={drawer.categorie_comptable ?? ''}
                onChange={(e) => setDrawer({ ...drawer, categorie_comptable: e.target.value })}
                placeholder="Carburant, Télécom…"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink-mid block mb-1.5">Déductibilité (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={drawer.taux_deductibilite ?? ''}
                  onChange={(e) => setDrawer({
                    ...drawer,
                    taux_deductibilite: e.target.value === '' ? null : Number(e.target.value),
                  })}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-mid block mb-1.5">Priorité (croissante)</label>
                <input
                  type="number"
                  min={1}
                  value={drawer.priorite ?? 100}
                  onChange={(e) => setDrawer({ ...drawer, priorite: parseInt(e.target.value, 10) || 100 })}
                  className={`${inputCls} font-mono`}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={drawer.actif ?? true}
                onChange={(e) => setDrawer({ ...drawer, actif: e.target.checked })}
                className="accent-[#1B3A6B]"
              />
              Active
            </label>

            <div className="flex gap-2 pt-2 border-t border-sand-border">
              <button
                type="button"
                onClick={() => run(() => saveRegleMapping(drawer), drawer.id ? 'Règle mise à jour.' : 'Règle créée.')}
                disabled={pending || !drawer.motif.trim()}
                className="bg-navy text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] flex-1"
              >
                {pending ? '…' : 'Enregistrer'}
              </button>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                disabled={pending}
                className="bg-white text-ink-mid border border-sand-border px-4 py-2.5 rounded-lg text-[13px] font-bold hover:bg-sand-hover disabled:opacity-50 min-h-[44px]"
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
