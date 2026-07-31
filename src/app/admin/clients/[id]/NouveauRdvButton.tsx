'use client';

// Bouton « Nouveau RDV » de la fiche client 360° (Mode Appel phase 3) :
// ouvre le ColdInterventionModal pré-rempli (buildRdvInitial côté serveur).
// Sur création → redirection vers la fiche du dossier créé (l'id est fourni
// par onCreated) ; à défaut, refresh de la fiche client.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarPlus } from 'lucide-react';
import type { Utilisateur } from '@/lib/types/database';
import {
  ColdInterventionModal,
  type ColdInterventionInitial,
} from '@/app/admin/interventions/ColdInterventionModal';

export function NouveauRdvButton({
  techs,
  initial,
}: {
  techs: Utilisateur[];
  initial: ColdInterventionInitial;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-bold bg-navy text-white hover:opacity-90 min-h-[40px]"
      >
        <CalendarPlus size={15} /> Nouveau RDV
      </button>
      {open && (
        <ColdInterventionModal
          techs={techs}
          initial={initial}
          onClose={() => setOpen(false)}
          onCreated={(created) => {
            if (created) router.push(`/admin/interventions/${created.intervention_id}`);
            else router.refresh();
          }}
        />
      )}
    </>
  );
}
