'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ModalShell, ModalFooter } from './CreateInterventionModal';
import {
  freeSlot,
  moveIntervention,
  updateInterventionFromSlot,
  getInterventionForSlot,
  listFreeSlotsForMove,
} from './actions';
import type { Utilisateur } from '@/lib/types/database';

const STATUTS = ['confirmee', 'realisee', 'rapport', 'cloturee', 'attente', 'en_suspens'] as const;
type Statut = (typeof STATUTS)[number];

const STATUT_LABEL: Record<Statut, string> = {
  confirmee: 'Confirmée',
  realisee: 'Réalisée',
  rapport: 'Rapport disponible',
  cloturee: 'Clôturée',
  attente: 'En attente',
  en_suspens: 'En suspens',
};

interface Intervention {
  id: string;
  ref: string | null;
  type: string | null;
  description: string | null;
  statut: string;
  acp_nom: string | null;
  syndic_nom: string | null;
  technicien_id: string | null;
  particulier_nom: string | null;
}

export function ReservedSlotModal({
  slotId,
  interventionId,
  slotInfo,
  techs,
  onClose,
  onChanged,
}: {
  slotId: string;
  interventionId: string;
  slotInfo: { date: string; heure_debut: string; heure_fin: string };
  techs: Utilisateur[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [iv, setIv] = useState<Intervention | null>(null);
  const [loadingIv, setLoadingIv] = useState(true);

  const [description, setDescription] = useState('');
  const [techId, setTechId] = useState<string>('');
  const [statut, setStatut] = useState<Statut>('confirmee');

  // Move flow
  const [movePanel, setMovePanel] = useState(false);
  const [freeSlots, setFreeSlots] = useState<Array<{ id: string; date: string; heure_debut: string; heure_fin: string; technicien_id: string | null }>>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await getInterventionForSlot(interventionId);
      if (!mounted) return;
      if (!res.ok) { setError(res.error); setLoadingIv(false); return; }
      const data = res.data!;
      setIv(data);
      setDescription(data.description ?? '');
      setTechId(data.technicien_id ?? '');
      setStatut((data.statut as Statut) ?? 'confirmee');
      setLoadingIv(false);
    })();
    return () => { mounted = false; };
  }, [interventionId]);

  function applyChanges() {
    setError(null);
    startTransition(async () => {
      const res = await updateInterventionFromSlot({
        intervention_id: interventionId,
        description,
        technicien_id: techId || null,
        statut,
      });
      if (!res.ok) { setError(res.error); return; }
      onChanged();
      router.refresh();
    });
  }

  function applyFree() {
    if (!confirm('Libérer ce créneau ? L\'intervention repassera en "En attente".')) return;
    setError(null);
    startTransition(async () => {
      const res = await freeSlot({ creneau_id: slotId });
      if (!res.ok) { setError(res.error); return; }
      onChanged();
      onClose();
      router.refresh();
    });
  }

  async function openMovePanel() {
    setError(null);
    setMovePanel(true);
    const today = new Date();
    const fromIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const toDate = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    const toIso = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`;
    const res = await listFreeSlotsForMove({ technicien_id: iv?.technicien_id, from_date: fromIso, to_date: toIso });
    if (!res.ok) { setError(res.error); return; }
    setFreeSlots(res.data ?? []);
  }

  function applyMove(targetSlotId: string) {
    setError(null);
    startTransition(async () => {
      const res = await moveIntervention({ from_creneau_id: slotId, to_creneau_id: targetSlotId });
      if (!res.ok) { setError(res.error); return; }
      onChanged();
      onClose();
      router.refresh();
    });
  }

  const dateLabel = new Date(slotInfo.date + 'T12:00:00').toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const techMap = new Map(techs.map((t) => [t.id, t]));

  return (
    <ModalShell
      title="Créneau réservé"
      subtitle={`${dateLabel} · ${slotInfo.heure_debut} → ${slotInfo.heure_fin}`}
      onClose={onClose}
    >
      {loadingIv && (
        <div className="text-[13px] text-ink-muted text-center py-6 dark:text-[#C8C2B8]">Chargement…</div>
      )}

      {iv && !movePanel && (
        <div className="space-y-4">
          {/* Récap */}
          <div className="bg-navy-pale border border-navy-light rounded-xl p-3 dark:bg-[#1B3A6B] dark:border-[#2A5298]">
            <div className="text-[10px] uppercase tracking-wider font-bold text-navy/70 dark:text-white/70">
              Intervention liée
            </div>
            <div className="font-extrabold text-[15px] text-navy mt-1 font-mono dark:text-white">
              {iv.ref ?? '—'}
            </div>
            <div className="text-[12px] text-navy/80 mt-0.5 dark:text-white/80">
              {iv.acp_nom ?? iv.particulier_nom ?? '—'}
              {iv.syndic_nom ? ` · ${iv.syndic_nom}` : ''}
              {iv.type ? ` · ${iv.type}` : ''}
            </div>
            <Link
              href={`/admin?id=${iv.id}`}
              className="inline-block mt-2 text-[11px] text-navy underline hover:no-underline dark:text-white"
              onClick={onClose}
            >
              → Voir le dossier complet
            </Link>
          </div>

          {/* Modifs */}
          <div>
            <Label>Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Technicien</Label>
              <select
                value={techId}
                onChange={(e) => setTechId(e.target.value)}
                className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
              >
                <option value="">— Aucun —</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {[t.prenom, t.nom].filter(Boolean).join(' ') || t.email}
                  </option>
                ))}
              </select>
              {techId && techMap.get(techId) && techId !== iv.technicien_id && (
                <p className="text-[10px] text-ink-muted mt-1 italic dark:text-[#C8C2B8]">
                  Note : changer de tech ici met à jour l&apos;intervention mais pas le créneau du tech d&apos;origine.
                </p>
              )}
            </div>
            <div>
              <Label>Statut</Label>
              <select
                value={statut}
                onChange={(e) => setStatut(e.target.value as Statut)}
                className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
              >
                {STATUTS.map((s) => (
                  <option key={s} value={s}>{STATUT_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-lg px-3 py-2 font-semibold">
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openMovePanel}
              disabled={pending}
              className="bg-[#A17244] text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
            >
              ↔ Déplacer le RDV
            </button>
            <button
              type="button"
              onClick={applyFree}
              disabled={pending}
              className="bg-terra-light text-terra border border-terra-mid px-3 py-2 rounded-lg text-[12px] font-bold disabled:opacity-50 dark:bg-[#5A2E18] dark:text-[#FFB897] dark:border-[#7A3F22]"
            >
              ↩ Libérer le créneau
            </button>
          </div>
        </div>
      )}

      {iv && movePanel && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setMovePanel(false)}
            className="text-[12px] text-ink-mid hover:text-navy dark:text-[#C8C2B8]"
          >
            ← Retour
          </button>
          <div className="text-[12px] text-ink-mid dark:text-[#C8C2B8]">
            Sélectionne un nouveau créneau libre {iv.technicien_id ? 'pour ce technicien' : ''} :
          </div>
          {freeSlots.length === 0 ? (
            <div className="bg-amber-light border border-[#E8C896] rounded-lg p-3 text-[12px] text-[#8A5A1A] dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]">
              Aucun créneau libre dans les 2 prochains mois. Crée des créneaux dans l&apos;onglet « Gérer ».
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
              {freeSlots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applyMove(s.id)}
                  disabled={pending}
                  className="w-full text-left bg-white hover:bg-navy-pale border border-sand-border rounded-md px-3 py-2 flex items-center justify-between text-[13px] disabled:opacity-50 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
                >
                  <span>
                    {new Date(s.date + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'long' })}
                  </span>
                  <span className="font-mono font-bold text-navy dark:text-[#A8C4F2]">
                    {s.heure_debut} → {s.heure_fin}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!movePanel && (
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={applyChanges}
            disabled={pending || loadingIv}
            className="bg-navy text-white px-5 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            {pending ? '…' : 'Appliquer'}
          </button>
        </ModalFooter>
      )}
    </ModalShell>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-ink-mid block mb-1.5 dark:text-[#C8C2B8]">
      {children}
    </label>
  );
}
