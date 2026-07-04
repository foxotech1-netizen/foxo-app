// Numérotation des documents de facturation (chantier Facturation v2).
//
// Principe légal belge : le numéro DÉFINITIF n'existe qu'à l'ÉMISSION. À la
// création, chaque pièce reçoit un numéro provisoire opaque (BR-xxxxxxxx) ;
// au passage brouillon → envoyée, la base attribue le numéro final via la
// fonction SQL next_numero_facture (atomique, verrou de ligne — cf. migration
// 2026-07-04_facturation_v2_socle.sql). Jamais recalculé en JS, jamais
// éditable ensuite. Module serveur uniquement (service role).

import { randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TypeFacture } from '@/lib/types/database';

// Préfixes par type — mêmes valeurs que l'ancienne numérotation d'actions.ts
// (generateNextNumero) et que le seed de sequences_facturation.
export const PREFIX_BY_TYPE: Record<TypeFacture, string> = {
  facture: 'FV',
  devis:   'DEV',
  avoir:   'NC',
};

/** Numéro provisoire de brouillon : opaque, jamais montré comme numéro légal. */
export function genererNumeroProvisoire(): string {
  return 'BR-' + randomBytes(4).toString('hex');
}

export function estProvisoire(numero: string | null | undefined): boolean {
  return (numero ?? '').startsWith('BR-');
}

/**
 * Réserve le prochain numéro auprès de la base (RPC atomique, service role)
 * et le compose au format <PREFIX><YYYY>-<NNN>. Throw en cas d'échec : un
 * document ne doit JAMAIS être émis sans numéro définitif.
 */
export async function attribuerNumeroDefinitif(type: TypeFacture): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('next_numero_facture', { p_type: type });
  if (error) throw new Error(`Attribution du numéro impossible : ${error.message}`);
  const n = Number(data);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Attribution du numéro : réponse inattendue de la base (${String(data)}).`);
  }
  return `${PREFIX_BY_TYPE[type]}${new Date().getFullYear()}-${String(n).padStart(3, '0')}`;
}
