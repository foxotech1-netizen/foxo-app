'use client';

import { useState, useTransition } from 'react';
import { Sparkles, Zap, CalendarClock, AlertTriangle, Check } from 'lucide-react';
import { ModalShell, ModalFooter } from './CreateInterventionModal';
import { proposeSlotForIntervention } from './actions';
import type { ProposeCreneauResult } from '@/lib/mails/propose-creneau';

// Une suggestion = un créneau non-null retourné par proposeCreneau.
// Dérivée du résultat pour ne pas dépendre d'un export supplémentaire.
type Suggestion = NonNullable<ProposeCreneauResult['primary']>;

interface ProposeSlotModalProps {
  onClose: () => void;
  onSelect: (slot: {
    id: string;
    date: string;
    heure_debut: string;
    heure_fin: string;
    technicien_id: string | null;
  }) => void;
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function ProposeSlotModal({ onClose, onSelect }: ProposeSlotModalProps) {
  const [adresse, setAdresse] = useState('');
  const [urgence, setUrgence] = useState(false);
  const [result, setResult] = useState<ProposeCreneauResult | null>(null);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function runPropose() {
    startTransition(async () => {
      const r = await proposeSlotForIntervention({
        adresse: adresse.trim() || null,
        urgence,
      });
      setResult(r);
      setSearched(true);
    });
  }

  const noResult = searched && result && !result.primary && !result.alternative;

  return (
    <ModalShell
      title="Proposer un créneau"
      subtitle="Trouve les meilleurs créneaux libres selon l'adresse et l'urgence"
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Adresse */}
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">
            Adresse de l&apos;intervention
          </label>
          <input
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
            placeholder="Rue, numéro, code postal, ville"
            className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          />
          <p className="text-[10px] text-ink-muted italic mt-1">
            Optionnel — sert à privilégier les créneaux proches d&apos;autres interventions du jour.
          </p>
        </div>

        {/* Urgence */}
        <label className="flex items-center gap-2 text-[13px] cursor-pointer">
          <input
            type="checkbox"
            checked={urgence}
            onChange={(e) => setUrgence(e.target.checked)}
            className="accent-[#C4622D]"
          />
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Zap size={14} /> Intervention urgente
          </span>
        </label>

        {/* Bouton Proposer */}
        <button
          type="button"
          onClick={runPropose}
          disabled={isPending}
          className="w-full bg-navy text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          <Sparkles size={14} />
          {isPending ? 'Recherche en cours…' : 'Proposer'}
        </button>

        {/* Résultats */}
        {searched && !isPending && (
          <div className="space-y-3">
            {result?.fenetre_etendue && (
              <div className="bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg px-3 py-2 text-[12px] inline-flex items-start gap-1.5 w-full">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>Aucun créneau disponible dans les prochains jours — proposition au-delà de 10 jours.</span>
              </div>
            )}

            {result?.primary && (
              <SuggestionCard
                label="Créneau recommandé"
                highlight
                suggestion={result.primary}
                onSelect={onSelect}
              />
            )}
            {result?.alternative && (
              <SuggestionCard
                label="Alternative"
                suggestion={result.alternative}
                onSelect={onSelect}
              />
            )}

            {noResult && (
              <div className="bg-sand border border-sand-border rounded-lg px-3 py-3 text-[12px] text-ink-mid text-center">
                Aucun créneau libre trouvé. Ajoutez des disponibilités dans l&apos;onglet
                {' '}« Gérer les disponibilités ».
              </div>
            )}
          </div>
        )}
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-[13px] font-semibold dark:bg-[rgba(255,255,255,.06)]"
        >
          Fermer
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

function SuggestionCard({
  label,
  suggestion,
  onSelect,
  highlight,
}: {
  label: string;
  suggestion: Suggestion;
  onSelect: ProposeSlotModalProps['onSelect'];
  highlight?: boolean;
}) {
  const s = suggestion;
  return (
    <div
      className={
        'rounded-xl p-3 border ' +
        (highlight
          ? 'bg-navy-pale border-navy-light'
          : 'bg-white border-sand-border')
      }
    >
      <div className="text-[10px] uppercase tracking-wider font-bold text-ink-muted mb-1 inline-flex items-center gap-1">
        <CalendarClock size={12} /> {label}
      </div>
      <div className="text-[13px] font-extrabold text-ink capitalize">
        {fmtDate(s.date)}
      </div>
      <div className="text-[12px] text-ink-mid mt-0.5">
        <span className="font-mono font-bold">{s.heure_debut} → {s.heure_fin}</span>
        {' · '}
        {s.technicien_nom}
      </div>
      <button
        type="button"
        onClick={() =>
          onSelect({
            id: s.creneau_id,
            date: s.date,
            heure_debut: s.heure_debut,
            heure_fin: s.heure_fin,
            technicien_id: s.technicien_id,
          })
        }
        className="mt-2.5 w-full bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center justify-center gap-1.5"
      >
        <Check size={13} /> Planifier ce créneau
      </button>
    </div>
  );
}
