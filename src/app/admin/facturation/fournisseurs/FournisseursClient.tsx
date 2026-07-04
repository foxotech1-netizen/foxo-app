'use client';

// Liste des fournisseurs + création/édition en drawer latéral. Soft delete.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Trash2, Pencil } from 'lucide-react';
import type { Fournisseur } from '@/lib/types/database';
import { saveFournisseur, deleteFournisseur, type FournisseurInput } from '../achats/actions';

const EMPTY: FournisseurInput = {
  nom: '',
  tva: '',
  peppol_id: '',
  email: '',
  telephone: '',
  iban: '',
  adresse: '',
  conditions_paiement_jours: 30,
  categorie_comptable_defaut: '',
  notes: '',
  actif: true,
};

export function FournisseursClient({ initial }: { initial: Fournisseur[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<FournisseurInput | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initial;
    return initial.filter((f) =>
      [f.nom, f.tva, f.email].filter(Boolean).some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [initial, query]);

  function openEdit(f: Fournisseur) {
    setDrawer({
      id: f.id,
      nom: f.nom,
      tva: f.tva ?? '',
      peppol_id: f.peppol_id ?? '',
      email: f.email ?? '',
      telephone: f.telephone ?? '',
      iban: f.iban ?? '',
      adresse: f.adresse ?? '',
      conditions_paiement_jours: f.conditions_paiement_jours ?? 30,
      categorie_comptable_defaut: f.categorie_comptable_defaut ?? '',
      notes: f.notes ?? '',
      actif: f.actif,
    });
  }

  function handleSave() {
    if (!drawer) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await saveFournisseur(drawer);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setFeedback({ kind: 'ok', msg: drawer.id ? 'Fournisseur mis à jour.' : 'Fournisseur créé.' });
      setDrawer(null);
      router.refresh();
    });
  }

  function handleDelete(f: Fournisseur) {
    if (!confirm(`Supprimer le fournisseur « ${f.nom} » ?\n\nLes factures d'achat liées gardent leur historique.`)) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteFournisseur(f.id);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setFeedback({ kind: 'ok', msg: 'Fournisseur supprimé.' });
      router.refresh();
    });
  }

  const inputCls =
    'w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid';

  function Field({
    label, value, onChange, placeholder, mono, type = 'text',
  }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; mono?: boolean; type?: string;
  }) {
    return (
      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">{label}</label>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputCls} ${mono ? 'font-mono' : ''}`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher (nom, TVA, email)…"
          className="px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid w-full sm:w-[280px]"
        />
        <button
          type="button"
          onClick={() => { setDrawer({ ...EMPTY }); setFeedback(null); }}
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center gap-1.5 min-h-[40px]"
        >
          <Plus size={14} aria-hidden /> Nouveau fournisseur
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

      {filtered.length === 0 ? (
        <div className="text-center py-14 text-ink-muted text-[13px] bg-cream rounded-xl border border-sand-border">
          Aucun fournisseur{query ? ' pour cette recherche' : ''}.
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setDrawer({ ...EMPTY })}
              className="text-navy font-bold underline hover:no-underline text-[12px]"
            >
              Créer le premier fournisseur
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-cream rounded-xl border border-sand-border overflow-x-auto">
          <table className="w-full text-left min-w-[760px]">
            <thead>
              <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="px-3.5 py-2.5 font-bold">Nom</th>
                <th className="px-3.5 py-2.5 font-bold">TVA</th>
                <th className="px-3.5 py-2.5 font-bold">Email</th>
                <th className="px-3.5 py-2.5 font-bold">Délai</th>
                <th className="px-3.5 py-2.5 font-bold">Catégorie défaut</th>
                <th className="px-3.5 py-2.5 font-bold">Actif</th>
                <th className="px-3.5 py-2.5 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-2.5 text-xs font-bold text-navy">{f.nom}</td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid">{f.tva ?? '—'}</td>
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid">{f.email ?? '—'}</td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid">{f.conditions_paiement_jours ?? 30} j</td>
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid">{f.categorie_comptable_defaut ?? '—'}</td>
                  <td className="px-3.5 py-2.5">
                    <span className={
                      'inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ' +
                      (f.actif ? 'bg-ok-light text-ok border-ok-mid' : 'bg-sand-mid text-ink-muted border-sand-border')
                    }>
                      {f.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => { openEdit(f); setFeedback(null); }}
                      className="text-[11px] font-semibold text-navy hover:underline inline-flex items-center gap-1 mr-3"
                    >
                      <Pencil size={12} aria-hidden /> Éditer
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(f)}
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
          <div className="bg-sand h-full w-full max-w-[420px] overflow-y-auto p-5 space-y-4 border-l border-sand-border">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-ink">
                {drawer.id ? 'Éditer le fournisseur' : 'Nouveau fournisseur'}
              </h2>
              <button
                type="button"
                onClick={() => setDrawer(null)}
                className="text-ink-muted hover:text-ink"
                aria-label="Fermer"
              >
                <X size={16} aria-hidden />
              </button>
            </div>

            <Field label="Nom *" value={drawer.nom} onChange={(v) => setDrawer({ ...drawer, nom: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="N° TVA" value={drawer.tva ?? ''} onChange={(v) => setDrawer({ ...drawer, tva: v })} placeholder="BE0123456789" mono />
              <Field label="Peppol ID" value={drawer.peppol_id ?? ''} onChange={(v) => setDrawer({ ...drawer, peppol_id: v })} placeholder="0208:…" mono />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email" type="email" value={drawer.email ?? ''} onChange={(v) => setDrawer({ ...drawer, email: v })} />
              <Field label="Téléphone" value={drawer.telephone ?? ''} onChange={(v) => setDrawer({ ...drawer, telephone: v })} />
            </div>
            <Field label="IBAN" value={drawer.iban ?? ''} onChange={(v) => setDrawer({ ...drawer, iban: v })} placeholder="BE…" mono />
            <div>
              <label className="text-xs font-semibold text-ink-mid block mb-1.5">Adresse</label>
              <textarea
                value={drawer.adresse ?? ''}
                onChange={(e) => setDrawer({ ...drawer, adresse: e.target.value })}
                rows={2}
                className={`${inputCls} resize-y`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink-mid block mb-1.5">Délai paiement (jours)</label>
                <input
                  type="number"
                  min={0}
                  value={drawer.conditions_paiement_jours ?? 30}
                  onChange={(e) => setDrawer({ ...drawer, conditions_paiement_jours: parseInt(e.target.value, 10) || 0 })}
                  className={`${inputCls} font-mono`}
                />
              </div>
              <Field
                label="Catégorie comptable défaut"
                value={drawer.categorie_comptable_defaut ?? ''}
                onChange={(v) => setDrawer({ ...drawer, categorie_comptable_defaut: v })}
                placeholder="Carburant…"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-mid block mb-1.5">Notes</label>
              <textarea
                value={drawer.notes ?? ''}
                onChange={(e) => setDrawer({ ...drawer, notes: e.target.value })}
                rows={2}
                className={`${inputCls} resize-y`}
              />
            </div>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                checked={drawer.actif ?? true}
                onChange={(e) => setDrawer({ ...drawer, actif: e.target.checked })}
                className="accent-[#1B3A6B]"
              />
              Actif
            </label>

            <div className="flex gap-2 pt-2 border-t border-sand-border">
              <button
                type="button"
                onClick={handleSave}
                disabled={pending || !drawer.nom.trim()}
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
