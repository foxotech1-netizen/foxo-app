// Construction du pré-remplissage « Nouveau RDV » (Mode Appel phase 3)
// depuis les données de la fiche client 360°. Fonction serveur
// (createAdminClient), aucun appel IA.
//
// Règles :
//   - client ACP → mode syndic, ACP (objet complet via client.acp_id) et
//     organisation (acps.syndic_id_ref, repli clients.syndic_id_ref)
//     pré-sélectionnées, adresse de l'ACP ;
//   - autre → mode particulier avec les coordonnées du client ;
//   - occupants : les 5 plus récents de la 360° (déjà dédoublonnés),
//     mappés en SlotOccupant éditables dans le modal.

import { createAdminClient } from '@/lib/supabase/admin';
import type { Acp, Client, Organisation } from '@/lib/types/database';
import type { ColdInterventionInitial } from '@/app/admin/interventions/ColdInterventionModal';
import type { SlotOccupant } from '@/app/admin/planning/actions';
import type { Client360Occupant } from './client360';

const MAX_OCCUPANTS_PREFILL = 5;

function toSlotOccupants(occupants: Client360Occupant[]): SlotOccupant[] {
  return occupants.slice(0, MAX_OCCUPANTS_PREFILL).map((o) => ({
    appartement: o.appartement ?? '',
    etage: '',
    prenom: o.prenom ?? '',
    nom: o.nom ?? '',
    email: o.email ?? '',
    telephone: o.telephone ?? '',
    conf: 'en_attente' as const,
    instructions: '',
    contact_preference: 'email' as const,
  }));
}

export async function buildRdvInitial(
  client: Client,
  occupants: Client360Occupant[],
): Promise<ColdInterventionInitial> {
  const slotOccupants = toSlotOccupants(occupants);

  // ── Client particulier / entreprise → mode particulier ──
  if (client.type !== 'acp') {
    return {
      demandeurType: 'particulier',
      occupants: slotOccupants,
      particulier: {
        prenom: client.prenom ?? '',
        nom: client.nom,
        email: client.email ?? '',
        tel: client.telephone ?? '',
        rue: client.adresse ?? '',
        cp: client.code_postal ?? '',
        ville: client.ville ?? '',
        bce: client.bce ?? '',
      },
    };
  }

  // ── Client ACP → mode syndic ──
  const admin = createAdminClient();
  let acp: Acp | null = null;
  if (client.acp_id) {
    const { data, error } = await admin.from('acps').select('*').eq('id', client.acp_id).maybeSingle();
    if (error) console.warn('[rdv-initial] acp:', error.message);
    acp = (data as Acp | null) ?? null;
  }

  const syndicId = acp?.syndic_id_ref ?? client.syndic_id_ref ?? null;
  let organisation: Organisation | null = null;
  if (syndicId) {
    const { data, error } = await admin.from('organisations').select('*').eq('id', syndicId).maybeSingle();
    if (error) console.warn('[rdv-initial] organisation:', error.message);
    organisation = (data as Organisation | null) ?? null;
  }

  return {
    demandeurType: 'syndic',
    acp,
    organisation,
    adresse: {
      rue: acp?.adresse ?? client.adresse ?? '',
      cp: acp?.code_postal ?? client.code_postal ?? '',
      ville: acp?.ville ?? client.ville ?? '',
    },
    occupants: slotOccupants,
  };
}
