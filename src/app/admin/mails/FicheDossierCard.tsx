'use client';

// Carte « Fiche dossier » (Mails V2 Phase 3 — U2) : synthèse structurée de
// l'analyse IA, rendue dans le volet de lecture entre la barre d'actions et
// le corps du mail, uniquement quand une analyse existe. Absorbe l'ex-
// accordion « Détail analyse » de MailAnalyseActions.
//
// Réutilise : MailAnalyseBadges (classification/langue/urgent/dossier),
// formatDateFr (créneau), OCCUPANT_TYPE_LABELS (types d'occupant). Les
// valeurs absentes (anciennes lignes : acp_nom/syndic_nom/classification
// null) s'affichent « — », pattern maison.

import Link from 'next/link';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import type { MailAnalyse } from './MailAnalyseTypes';
import { MailAnalyseBadges } from './MailAnalyseBadges';
import { formatDateFr } from './MailAnalyseActions';
import { OCCUPANT_TYPE_LABELS } from './ConfirmCreateForm';

interface Props {
  analyse: MailAnalyse;
  // Scroll fluide vers la zone MailAnalyseActions (ConfirmCreateForm).
  onScrollToActions: () => void;
  // Ouvre le composer inline existant (setReplyOpen de MailsClient).
  onReply: () => void;
}

const DASH = '—';

function occupantTypeLabel(type: string): string {
  return OCCUPANT_TYPE_LABELS.find((t) => t.value === type)?.label ?? type;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="text-[12px] text-ink mt-0.5 break-words">{children}</div>
    </div>
  );
}

export function FicheDossierCard({ analyse, onScrollToActions, onReply }: Props) {
  const occupants = analyse.occupants_extraits ?? [];
  const creneauTxt = analyse.creneau
    ? `${formatDateFr(analyse.creneau.date)} ${analyse.creneau.heure_debut} → ${analyse.creneau.heure_fin} — ${analyse.creneau.technicien_nom}${analyse.fenetre_etendue ? ' (fenêtre étendue)' : ''}`
    : null;
  // Même condition que le rendu du ConfirmCreateForm dans MailAnalyseActions.
  const showCreate = analyse.type === 'demande_intervention' && !analyse.dossier_match_id;

  return (
    <div className="mx-4 mt-3 bg-cream border border-sand-border rounded-xl p-3">
      {/* En-tête : titre + badges existants réutilisés */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">
          Fiche dossier
        </span>
        <MailAnalyseBadges analyse={analyse} />
      </div>

      {/* Grille label/valeur — 1 colonne sur étroit, 2 au-delà */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Type d'intervention">{analyse.type_intervention ?? DASH}</Field>
        <Field label="Adresse extraite">{analyse.adresse_extraite ?? DASH}</Field>
        <Field label="ACP">{analyse.acp_nom ?? DASH}</Field>
        <Field label="Syndic">{analyse.syndic_nom ?? DASH}</Field>
        <Field label="N° dossier mentionné">
          {analyse.numero_dossier_mentionne
            ? <span className="font-mono">{analyse.numero_dossier_mentionne}</span>
            : DASH}
        </Field>
        <Field label="Créneau proposé">{creneauTxt ?? DASH}</Field>
      </div>

      {/* Résumé IA pleine largeur */}
      <div className="mt-2.5">
        <Field label="Résumé IA">{analyse.resume ?? DASH}</Field>
      </div>

      {/* Occupants extraits */}
      <div className="mt-3 pt-2.5 border-t border-sand-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-1.5">
          Occupants
        </div>
        {occupants.length === 0 ? (
          <span className="text-[11px] text-ink-muted italic">Aucun occupant extrait.</span>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] border-collapse min-w-[480px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-muted">
                  <th className="font-medium py-1 pr-3">Étage/Apt</th>
                  <th className="font-medium py-1 pr-3">Nom</th>
                  <th className="font-medium py-1 pr-3">Téléphone</th>
                  <th className="font-medium py-1 pr-3">Email</th>
                  <th className="font-medium py-1">Type</th>
                </tr>
              </thead>
              <tbody className="text-ink">
                {occupants.map((o, i) => {
                  const zone = [o.etage, o.appartement].filter(Boolean).join(' / ');
                  const nom = `${o.prenom} ${o.nom}`.trim();
                  return (
                    <tr key={i} className="border-t border-sand-border">
                      <td className="py-1 pr-3 whitespace-nowrap">{zone || DASH}</td>
                      <td className="py-1 pr-3">{nom || DASH}</td>
                      <td className="py-1 pr-3 font-mono whitespace-nowrap">{o.telephone || DASH}</td>
                      <td className="py-1 pr-3 font-mono break-all">{o.email || DASH}</td>
                      <td className="py-1 whitespace-nowrap">{occupantTypeLabel(o.type)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dossier lié */}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          Dossier
        </span>
        {analyse.dossier ? (
          <Link
            href={`/admin/interventions/${analyse.dossier.id}`}
            className="font-sora inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold hover:underline"
            style={{
              background: 'var(--color-navy-pale)',
              color: 'var(--color-navy)',
              border: '1px solid var(--color-navy-light)',
            }}
          >
            Dossier {analyse.dossier.ref ?? '?'}
          </Link>
        ) : (
          <span className="text-[11px] text-ink-muted italic">Aucun dossier lié.</span>
        )}
      </div>

      {/* Avertissements */}
      {analyse.errors && analyse.errors.length > 0 && (
        <div
          className="mt-2.5 p-2 rounded text-[11px]"
          style={{ background: 'var(--color-amber-light)', color: 'var(--color-amber-foxo)' }}
        >
          <div className="font-bold mb-1 inline-flex items-center gap-1">
            <AlertTriangle size={11} aria-hidden />
            Avertissements :
          </div>
          <ul className="list-disc pl-4 space-y-0.5 m-0">
            {analyse.errors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {/* Actions de pied de carte */}
      <div className="mt-3 pt-2.5 border-t border-sand-border flex flex-wrap gap-2">
        {showCreate && (
          <button
            type="button"
            onClick={onScrollToActions}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-bold min-h-[44px]"
            style={{ background: 'var(--color-navy)', color: 'var(--color-cream)' }}
          >
            <ClipboardList size={14} aria-hidden />
            Créer l&apos;intervention
          </button>
        )}
        <button
          type="button"
          onClick={onReply}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-bold min-h-[44px]"
          style={{ background: 'var(--color-cream)', color: 'var(--color-navy)', border: '1px solid var(--color-navy)' }}
        >
          ↩ Répondre
        </button>
      </div>
    </div>
  );
}
