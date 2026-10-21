'use client';

// Bouton « Créer une intervention » (page /admin/interventions) : ouvre le
// ColdInterventionModal (création à froid). Reçoit la liste des techniciens
// déjà fetchée par la page serveur. Sur création → router.refresh() pour
// recharger la liste server-rendered.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { Utilisateur } from '@/lib/types/database';
import { ColdInterventionModal } from './ColdInterventionModal';

export function CreateInterventionButton({
  techs,
  label = 'Créer une intervention',
  variante = 'navy',
}: {
  techs: Utilisateur[];
  /** Libellé du bouton (« Nouvelle intervention » sur le tableau de bord). */
  label?: string;
  /** primaire = bouton ambre de la maquette ; navy = bouton secondaire marine. */
  variante?: 'primaire' | 'navy';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={variante === 'primaire' ? 'fx-btn-primary' : 'fx-btn-small fx-btn-small-navy'}
      >
        <Plus size={15} aria-hidden /> {label}
      </button>
      {open && (
        <ColdInterventionModal
          techs={techs}
          onClose={() => setOpen(false)}
          onCreated={() => router.refresh()}
        />
      )}
    </>
  );
}
