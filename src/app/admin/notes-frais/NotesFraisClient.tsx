'use client';

import { useMemo, useState } from 'react';
import type { CategorieNoteFrais, NoteFrais, StatutNoteFrais } from '@/lib/types/database';

const CATEGORIE_LABEL: Record<CategorieNoteFrais, string> = {
  carburant:      'Carburant',
  materiel:       'Matériel',
  outillage:      'Outillage',
  transport:      'Transport',
  restauration:   'Restauration',
  fournitures:    'Fournitures',
  sous_traitance: 'Sous-traitance',
  autre:          'Autre',
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

export function NotesFraisClient({ initialData }: { initialData: NoteFrais[] }) {
  const [notes] = useState<NoteFrais[]>(initialData);
  const [filter, setFilter] = useState<StatutFilter>('tous');

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
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink dark:text-[#F0ECE4]">Notes de frais</h1>
          <p className="text-[11px] text-ink-muted mt-0.5 dark:text-[#C8C2B8]">
            {notes.length} note{notes.length > 1 ? 's' : ''} — gestion des dépenses techniciens
          </p>
        </div>
        <button
          type="button"
          onClick={() => alert('Drawer de création à implémenter dans le prochain sprint.')}
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:opacity-90"
        >
          ➕ Nouvelle note
        </button>
      </header>

      {/* Tabs filtre statut */}
      <div className="flex flex-wrap gap-0.5 border-b border-sand-border -mb-px dark:border-[#2C2A24]">
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
                  ? 'bg-cream border-navy text-navy dark:bg-[#1C1A16] dark:text-[#A8C4F2] dark:border-[#7AA8E8]'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-[rgba(27,58,107,.2)] dark:text-[#C8C2B8] dark:hover:text-[#F0ECE4]')
              }
            >
              {t.label}
              <span className="text-[10px] font-bold text-ink-muted bg-sand-mid px-1.5 py-0.5 rounded-full dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tableau */}
      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[860px]">
            <thead>
              <tr className="bg-sand dark:bg-[#221E1A]">
                {['Date', 'Technicien', 'Titre', 'Catégorie', 'Montant TTC', 'Statut', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px] dark:text-[#C8C2B8]">
                    Aucune note de frais{filter !== 'tous' ? ` au statut « ${STATUT_BADGE[filter as StatutNoteFrais]?.label.toLowerCase() ?? filter} »` : ''}.
                  </td>
                </tr>
              ) : (
                filtered.map((n) => {
                  const badge = STATUT_BADGE[n.statut];
                  return (
                    <tr key={n.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#3D3A32] dark:hover:bg-[#2A2520]">
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">
                        {fmtDate(n.date_depense)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="text-xs font-semibold dark:text-[#F0ECE4]">
                          {n.technicien_nom ?? n.technicien_email}
                        </div>
                        {n.technicien_nom && (
                          <div className="text-[10px] text-ink-muted font-mono dark:text-[#C8C2B8]">
                            {n.technicien_email}
                          </div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs dark:text-[#F0ECE4]">
                        <div className="font-semibold">{n.titre}</div>
                        {n.fournisseur && (
                          <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">{n.fournisseur}</div>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid dark:text-[#C8C2B8]">
                        {CATEGORIE_LABEL[n.categorie]}
                      </td>
                      <td className="px-3.5 py-2.5 text-[12px] font-mono font-bold whitespace-nowrap dark:text-white">
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
                          onClick={() => alert(`Détail note ${n.id} — drawer à implémenter.`)}
                          className="text-[11px] text-navy hover:underline font-bold dark:text-[#A8C4F2]"
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
    </div>
  );
}
