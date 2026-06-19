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

export function CreateInterventionButton({ techs }: { techs: Utilisateur[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-bold bg-navy text-white hover:opacity-90 min-h-[40px]"
      >
        <Plus size={15} /> Créer une intervention
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
