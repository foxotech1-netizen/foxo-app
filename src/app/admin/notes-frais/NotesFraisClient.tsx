'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CategorieNoteFrais, NoteFrais, StatutNoteFrais } from '@/lib/types/database';
import { categorieComptable } from '@/lib/types/database';
import { NoteFraisDrawer } from './NoteFraisDrawer';

const CATEGORIE_LABEL: Record<CategorieNoteFrais, string> = {
  carburant:      'Carburant',
  materiel:       'Matériel',
  outillage:      'Outillage',
  transport:      'Transport',
  restauration:   'Restauration (legacy)',
  fournitures:    'Fournitures',
  sous_traitance: 'Sous-traitance',
  autre:          'Autre',
  restaurant:     'Restaurant',
  cafe_client:    'Café client',
  repas_travail:  'Repas de travail',
  reception:      'Réception',
  telephonie:     'Téléphonie',
  formation:      'Formation',
  autre_achat:    'Autre achat',
};

// Tabs de filtrage. 'tous' = pas de filtre statut.
type StatutFilter = 'tous' | StatutNoteFrais;
const STATUT_TABS: { key: StatutFilter; label: string }[] = [
  { key: 'tous',       label: 'Toutes'      },
  { key: 'brouillon',  label: 'Brouillon'   },
  { key: 'soumise',    label: 'Soumises'    },
  { key: 'approuvee',  label: 'Approuvées'  },
  { key: 'rejetee',    label: 'Rejetées'    },
  { key: 'remboursee', label: 'Remboursées' },
];

const STATUT_BADGE: Record<StatutNoteFrais, { fg: string; bg: string; label: string }> = {
  brouillon:  { fg: '#6B6558', bg: '#EDEAE3', label: 'Brouillon'  },
  soumise:    { fg: '#1B3A6B', bg: '#D6E4F7', label: 'Soumise'    },
  approuvee:  { fg: '#1F6B45', bg: '#D4EDE2', label: 'Approuvée'  },
  rejetee:    { fg: '#C4622D', bg: '#F7EDE5', label: 'Rejetée'    },
  remboursee: { fg: '#7C3AED', bg: '#F5F3FF', label: 'Remboursée' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Lit la déductibilité depuis la DB (champs calculés par le trigger)
// avec fallback sur le helper TS — utile pour les rows pas encore
// mises à jour ou pour l'affichage optimiste avant insert.
function deductibiliteOf(n: NoteFrais): { taux: number; comptable: 'professionnel' | 'representation' } {
  if (typeof n.taux_deductibilite === 'number' && (n.categorie_comptable === 'professionnel' || n.categorie_comptable === 'representation')) {
    return { taux: n.taux_deductibilite, comptable: n.categorie_comptable };
  }
  const c = categorieComptable(n.categorie);
  return { taux: c.tauxDeductibilite, comptable: c.comptable };
}

export function NotesFraisClient({ initialData }: { initialData: NoteFrais[] }) {
  const [notes, setNotes] = useState<NoteFrais[]>(initialData);
  const [filter, setFilter] = useState<StatutFilter>('tous');
  const [selectedNote, setSelectedNote] = useState<NoteFrais | null>(null);

  const filtered = useMemo(
    () => filter === 'tous' ? notes : notes.filter((n) => n.statut === filter),
    [notes, filter],
  );

  const counts = useMemo(() => {
    const acc: Record<StatutFilter, number> = {
      tous: notes.length, brouillon: 0, soumise: 0, approuvee: 0, rejetee: 0, remboursee: 0,
    };
    for (const n of notes) acc[n.statut]++;
    return acc;
  }, [notes]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-end flex-wrap gap-3 mb-2 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Notes de <span>frais</span>
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {notes.length} note{notes.length > 1 ? 's' : ''} — gestion des dépenses techniciens
          </div>
        </div>
        <button
          type="button"
          onClick={() => alert('Drawer de création à implémenter dans le prochain sprint.')}
          className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm inline-flex items-center gap-1.5"
        >
          <Plus size={14} />
          Nouvelle note
        </button>
      </div>

      {/* Tabs filtre statut */}
      <div className="flex flex-wrap gap-0.5 border-b border-sand-border -mb-px">
        {STATUT_TABS.map((t) => {
          const active = filter === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={
                'flex items-center gap-1.5 px-3.5 py-2 rounded-t-lg text-[12px] font-bold border-b-2 transition-colors ' +
                (active
                  ? 'bg-cream border-navy text-navy'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-[rgba(27,58,107,.2)]')
              }
            >
              {t.label}
              <span className="text-[10px] font-bold text-ink-muted bg-sand-mid px-1.5 py-0.5 rounded-full">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tableau */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-[var(--table-bg)]">
                {['Date', 'Technicien', 'Titre', 'Catégorie', 'Déductibilité', 'Montant TTC', 'Statut', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-ink-muted text-[13px]">
                    Aucune note de frais{filter !== 'tous' ? ` au statut « ${STATUT_BADGE[filter as StatutNoteFrais]?.label.toLowerCase() ?? filter} »` : ''}.
                  </td>
                </tr>
              ) : (
                filtered.map((n) => {
                  const badge = STATUT_BADGE[n.statut];
                  return (
                    <tr key={n.id} className="border-b border-sand-mid hover:bg-sand-hover">
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                        {fmtDate(n.date_depense)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="text-xs font-semibold">
                          {n.technicien_nom ?? n.technicien_email}
                        </div>
                        {n.technicien_nom && (
                          <div className="text-[10px] text-ink-muted font-mono">
                            {n.technicien_email}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs">
                        <div className="font-semibold">{n.titre}</div>
                        {n.fournisseur && (
                          <div className="text-[10px] text-ink-muted">{n.fournisseur}</div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid">
                        {CATEGORIE_LABEL[n.categorie]}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        {(() => {
                          const d = deductibiliteOf(n);
                          const isFull = d.taux >= 100;
                          return (
                            <span
                              className={
                                'inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ' +
                                (isFull
                                  ? 'bg-ok-light text-ok border-ok-mid'
                                  : 'bg-amber-light text-[#8A5A1A] border-[#E8C896]')
                              }
                              title={d.comptable === 'representation'
                                ? 'Frais de représentation — TVA non récupérable'
                                : 'Frais professionnel — TVA récupérable'}
                            >
                              {d.taux}% déductible
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3.5 py-2.5 text-[12px] font-mono font-bold whitespace-nowrap">
                        {fmtMoney(n.montant_ttc)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span
                          className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{ color: badge.fg, background: badge.bg }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedNote(n)}
                          className="text-[11px] text-navy hover:underline font-bold"
                        >
                          Voir
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedNote && (
        <NoteFraisDrawer
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onUpdate={(patch) => {
            setNotes((prev) => prev.map((n) => n.id === selectedNote.id ? { ...n, ...patch } : n));
            setSelectedNote((prev) => prev ? { ...prev, ...patch } : null);
          }}
        />
      )}
    </div>
  );
}
