'use client';

import { useState, useEffect, useTransition } from 'react';
import { Sparkles, Zap, CalendarClock, Check, AlertTriangle } from 'lucide-react';
import { ModalShell, ModalFooter } from '@/app/admin/planning/CreateInterventionModal';
import { proposeSlotForIntervention } from '@/app/admin/planning/actions';
import { assignTechnician } from './actions';
import type { ProposeCreneauResult } from '@/lib/mails/propose-creneau';

// Une suggestion = un créneau non-null retourné par proposeCreneau.
type Suggestion = NonNullable<ProposeCreneauResult['primary']>;

interface PlanRowModalProps {
  intervention: { id: string; ref: string | null; adresse: string | null; urgence: boolean };
  onClose: () => void;
  onScheduled: () => void; // le parent rafraîchira la liste
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function PlanRowModal({ intervention, onClose, onScheduled }: PlanRowModalProps) {
  const [adresse, setAdresse] = useState(intervention.adresse ?? '');
  const [urgence, setUrgence] = useState(intervention.urgence);
  const [result, setResult] = useState<ProposeCreneauResult | null>(null);
  const [searched, setSearched] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [isProposing, startProposing] = useTransition();
  const [isActing, setActing] = useState(false);

  function runPropose() {
    setMsg(null);
    startProposing(async () => {
      const r = await proposeSlotForIntervention({
        adresse: adresse.trim() || null,
        urgence,
      });
      setResult(r);
      setSearched(true);
    });
  }

  // Lance automatiquement la proposition au montage, avec les valeurs
  // préremplies depuis la ligne. Une seule fois.
  useEffect(() => {
    runPropose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applySuggestion(s: Suggestion) {
    setMsg(null);
    setActing(true);
    // (a) Assigne le technicien suggéré (server action).
    const a = await assignTechnician(intervention.id, s.technicien_id);
    if (a && a.error) {
      setMsg({ kind: 'err', text: a.error });
      setActing(false);
      return;
    }
    // (b) Planifie + réserve le créneau (route schedule).
    try {
      const r = await fetch(`/api/admin/interventions/${intervention.id}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: s.date, heure: s.heure_debut, creneau_id: s.creneau_id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setMsg({ kind: 'err', text: j.error ?? 'Échec de la planification.' });
        setActing(false);
        return;
      }
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Erreur réseau.' });
      setActing(false);
      return;
    }
    // (c) Succès.
    onScheduled();
    onClose();
  }

  const noResult = searched && result && !result.primary && !result.alternative;

  return (
    <ModalShell
      title={`Planifier — ${intervention.ref ?? ''}`}
      subtitle="Assigne le technicien et réserve le meilleur créneau libre"
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
        </div>

        {/* Urgence + re-proposer */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
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
          <button
            type="button"
            onClick={runPropose}
            disabled={isProposing || isActing}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold border border-navy bg-navy text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Sparkles size={14} /> Re-proposer
          </button>
        </div>

        {/* Message d'erreur global */}
        {msg && (
          <div
            className={
              'text-[12px] rounded-lg px-3 py-2 border font-semibold ' +
              (msg.kind === 'ok'
                ? 'bg-ok-light border-ok-mid text-ok'
                : 'bg-terra-light border-terra-mid text-terra')
            }
          >
            {msg.text}
          </div>
        )}

        {/* États de recherche / résultats */}
        {isProposing ? (
          <div className="text-[13px] text-ink-muted text-center py-4 italic">
            Recherche du meilleur créneau…
          </div>
        ) : searched ? (
          <div className="space-y-3">
            {result?.fenetre_etendue && (
              <div className="bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg px-3 py-2 text-[12px] inline-flex items-start gap-1.5 w-full">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>Aucun créneau proche — proposition au-delà de 10 jours.</span>
              </div>
            )}

            {result?.primary && (
              <SuggestionCard
                label="Recommandé"
                highlight
                suggestion={result.primary}
                disabled={isActing}
                onApply={applySuggestion}
              />
            )}
            {result?.alternative && (
              <SuggestionCard
                label="Alternative"
                suggestion={result.alternative}
                disabled={isActing}
                onApply={applySuggestion}
              />
            )}

            {noResult && (
              <div className="bg-sand border border-sand-border rounded-lg px-3 py-3 text-[12px] text-ink-mid text-center">
                Aucun créneau libre. Ajoutez des disponibilités dans Planning.
              </div>
            )}
          </div>
        ) : null}
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={isActing}
          className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)]"
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
  onApply,
  disabled,
  highlight,
}: {
  label: string;
  suggestion: Suggestion;
  onApply: (s: Suggestion) => void;
  disabled?: boolean;
  highlight?: boolean;
}) {
  const s = suggestion;
  return (
    <div
      className={
        'rounded-xl p-3 border ' +
        (highlight ? 'bg-navy-pale border-navy-light' : 'bg-white border-sand-border')
      }
    >
      <div className="text-[10px] uppercase tracking-wider font-bold text-ink-muted mb-1 inline-flex items-center gap-1">
        <CalendarClock size={12} /> {label}
      </div>
      <div className="text-[13px] font-extrabold text-ink capitalize">{fmtDate(s.date)}</div>
      <div className="text-[12px] text-ink-mid mt-0.5">
        <span className="font-mono font-bold">{s.heure_debut} → {s.heure_fin}</span>
        {' · '}
        {s.technicien_nom}
      </div>
      <button
        type="button"
        onClick={() => onApply(s)}
        disabled={disabled}
        className="mt-2.5 w-full bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
      >
        <Check size={13} /> {disabled ? 'En cours…' : 'Assigner & planifier'}
      </button>
    </div>
  );
}
