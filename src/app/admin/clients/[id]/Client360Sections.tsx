'use client';

// Sections interactives de la fiche client 360° (Mode Appel phase 2) :
// tableaux Interventions et Occupants avec repli « Voir plus ». Composants
// client légers — les données arrivent sérialisées du server component
// (page.tsx via getClient360), aucun fetch ici.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, ExternalLink } from 'lucide-react';
import { StatutBadge } from '@/components/StatutBadge';
import type { Client360Intervention, Client360Occupant } from './client360';

const IV_VISIBLE = 15;
const OCC_VISIBLE = 10;

function fmtDateBe(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-BE', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Brussels',
    });
  } catch {
    return iso;
  }
}

function VoirPlus({ hidden, onClick }: { hidden: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-2 text-[11px] font-bold text-navy hover:bg-sand-hover border-t border-sand-mid"
    >
      Voir plus ({hidden} de plus)
    </button>
  );
}

const TH_CLASS = 'px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap';

// ─── Interventions ──────────────────────────────────────────────────────

export function InterventionsSection({ items }: { items: Client360Intervention[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, IV_VISIBLE);

  return (
    <section>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-mid mb-3">
        Interventions ({items.length})
      </h2>
      {items.length === 0 ? (
        <div className="bg-cream border border-sand-border rounded-2xl p-6 text-center text-[13px] text-ink-muted">
          Aucune intervention liée à ce client.
        </div>
      ) : (
        <div className="bg-cream rounded-2xl border border-sand-border overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sand">
                {['Réf.', 'Date', 'Statut', 'Adresse', 'Rapport'].map((h) => (
                  <th key={h} className={TH_CLASS}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((iv) => (
                <tr
                  key={iv.id}
                  onClick={() => router.push(`/admin/interventions/${iv.id}`)}
                  className="border-b border-sand-mid hover:bg-sand-hover cursor-pointer"
                >
                  <td className="px-3.5 py-2.5 font-mono text-xs font-bold text-navy whitespace-nowrap">
                    {iv.ref ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                    {fmtDateBe(iv.date_effective)}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <StatutBadge statut={iv.statut} />
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid">
                    {iv.adresse ?? <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    {iv.rapport?.statut === 'transmis' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy">
                        <FileText size={12} /> Rapport
                      </span>
                    ) : iv.rapport_historique_url ? (
                      <a
                        href={iv.rapport_historique_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-navy hover:underline"
                      >
                        <ExternalLink size={12} /> Drive
                      </a>
                    ) : (
                      <span className="text-ink-muted text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!expanded && items.length > IV_VISIBLE && (
            <VoirPlus hidden={items.length - IV_VISIBLE} onClick={() => setExpanded(true)} />
          )}
        </div>
      )}
    </section>
  );
}

// ─── Occupants connus ───────────────────────────────────────────────────

export function OccupantsSection({ items }: { items: Client360Occupant[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const visible = expanded ? items : items.slice(0, OCC_VISIBLE);

  return (
    <section>
      <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-mid mb-3">
        Occupants connus ({items.length})
      </h2>
      <div className="bg-cream rounded-2xl border border-sand-border overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-sand">
              {['Nom', 'Téléphone', 'Email', 'Apt.', 'Dossier'].map((h) => (
                <th key={h} className={TH_CLASS}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((o, i) => (
              <tr
                key={`${o.intervention_id}-${i}`}
                onClick={() => router.push(`/admin/interventions/${o.intervention_id}`)}
                className="border-b border-sand-mid hover:bg-sand-hover cursor-pointer"
              >
                <td className="px-3.5 py-2 text-[12px] font-semibold text-ink whitespace-nowrap">
                  {[o.prenom, o.nom].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="px-3.5 py-2 font-mono text-[11px] text-ink-mid whitespace-nowrap">
                  {o.telephone ?? '—'}
                </td>
                <td className="px-3.5 py-2 font-mono text-[11px] text-ink-mid">
                  {o.email ?? '—'}
                </td>
                <td className="px-3.5 py-2 text-[11px] text-ink-mid whitespace-nowrap">
                  {o.appartement ?? '—'}
                </td>
                <td className="px-3.5 py-2 font-mono text-[11px] font-bold text-navy whitespace-nowrap">
                  {o.intervention_ref ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!expanded && items.length > OCC_VISIBLE && (
          <VoirPlus hidden={items.length - OCC_VISIBLE} onClick={() => setExpanded(true)} />
        )}
      </div>
    </section>
  );
}
