'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ModalShell, ModalFooter } from './CreateInterventionModal';
import { deleteCreneau, blockCreneau } from './actions';

// On bascule un slot creneaux_disponibles statut='bloque' vers 'libre' en
// le supprimant + recréation côté actions. Plus simple : on a juste besoin
// d'un debloquer (= delete) + recreate libre. Mais pour ne pas perdre le
// créneau, on va simplement update statut → 'libre'. Il n'y a pas d'action
// "unblock", on en ajoute une simple ici via update direct côté client n'est
// pas possible (pas d'accès direct DB), donc on utilise blockCreneau pour
// remettre dans creneaux_bloques si besoin.
//
// MVP : on gère le motif via un champ libre stocké visuellement uniquement
// dans creneaux_bloques (lié par date+heure). Pour la simplicité, on offre :
//   - Débloquer (delete via deleteCreneau si l'admin a posé un creneau
//     bloque manuellement, sinon désactivé)
//   - Modifier le motif (update via blockCreneau dans creneaux_bloques)

export function BlockedSlotModal({
  slotId,
  slotInfo,
  initialMotif,
  onClose,
  onChanged,
}: {
  slotId: string;
  slotInfo: { date: string; heure_debut: string; heure_fin: string };
  initialMotif: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [motif, setMotif] = useState(initialMotif ?? '');

  const dateLabel = new Date(slotInfo.date + 'T12:00:00').toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  function applyUnblock() {
    if (!confirm('Débloquer ce créneau ? Il sera supprimé du planning.')) return;
    setError(null);
    startTransition(async () => {
      // Supprime la ligne creneaux_disponibles bloquée. L'admin peut
      // re-générer un slot libre depuis l'onglet "Gérer" si besoin.
      const res = await deleteCreneau(slotId);
      if (!res.ok) { setError(res.error); return; }
      onChanged();
      onClose();
      router.refresh();
    });
  }

  function applyUpdateMotif() {
    setError(null);
    startTransition(async () => {
      // Insère/upsert un creneau_bloques pour ce jour+heure avec le motif.
      const res = await blockCreneau({
        date: slotInfo.date,
        heure: slotInfo.heure_debut,
        motif: motif.trim() || undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      onChanged();
      router.refresh();
    });
  }

  return (
    <ModalShell
      title="Créneau bloqué"
      subtitle={`${dateLabel} · ${slotInfo.heure_debut} → ${slotInfo.heure_fin}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">
            Motif de blocage
          </label>
          <textarea
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            rows={3}
            placeholder="Ex : congé annuel, déplacement chantier, formation…"
            className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
          />
        </div>

        {error && (
          <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-lg px-3 py-2 font-semibold">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyUnblock}
            disabled={pending}
            className="bg-[#1F6B45] text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            ✓ Débloquer le créneau
          </button>
        </div>
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)]"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={applyUpdateMotif}
          disabled={pending}
          className="bg-navy text-white px-5 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50"
        >
          {pending ? '…' : 'Enregistrer le motif'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
