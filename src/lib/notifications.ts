// Résolution du destinataire email pour un document FoxO.
//
// Priorité (en cascade — premier non-null gagne) :
//
//   facture :
//     1. acp.email_factures
//     2. organisation(syndic).email_factures
//     3. acp.email_facturation                  (legacy)
//     4. organisation(syndic).email             (general fallback)
//     5. particulier_contact.email              (cas non syndic)
//
//   rapport :
//     1. acp.email_rapports
//     2. organisation(syndic).email_rapports
//     3. acp.email_rapport                      (legacy)
//     4. organisation(syndic).email             (general fallback)
//     5. particulier_contact.email
//
//   communication :
//     1. acp.email_communications
//     2. organisation(syndic).email_communications
//     3. organisation(syndic).email             (general fallback)
//     4. particulier_contact.email

import type { Acp, Organisation } from '@/lib/types/database';

export type DocType = 'facture' | 'rapport' | 'communication';

export interface EmailResolutionInput {
  acp?: Pick<Acp, 'email_factures' | 'email_rapports' | 'email_communications' | 'email_facturation' | 'email_rapport'> | null;
  syndic?: Pick<Organisation, 'email_factures' | 'email_rapports' | 'email_communications' | 'email'> | null;
  // particulier_contact peut venir de la DB où email est nullable, ou du type
  // strict ParticulierContact où email est string. On accepte les deux.
  particulier_contact?: { email?: string | null } | null;
}

export interface EmailResolution {
  email: string | null;
  source: 'acp' | 'syndic' | 'acp_legacy' | 'syndic_general' | 'particulier' | null;
}

function clean(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  const v = s.trim();
  return v ? v : null;
}

export function getEmailForDoc(
  input: EmailResolutionInput,
  docType: DocType,
): EmailResolution {
  const { acp, syndic, particulier_contact: pc } = input;

  if (docType === 'facture') {
    const acpEmail = clean(acp?.email_factures);
    if (acpEmail) return { email: acpEmail, source: 'acp' };
    const sEmail = clean(syndic?.email_factures);
    if (sEmail) return { email: sEmail, source: 'syndic' };
    const legacy = clean(acp?.email_facturation);
    if (legacy) return { email: legacy, source: 'acp_legacy' };
  }

  if (docType === 'rapport') {
    const acpEmail = clean(acp?.email_rapports);
    if (acpEmail) return { email: acpEmail, source: 'acp' };
    const sEmail = clean(syndic?.email_rapports);
    if (sEmail) return { email: sEmail, source: 'syndic' };
    const legacy = clean(acp?.email_rapport);
    if (legacy) return { email: legacy, source: 'acp_legacy' };
  }

  if (docType === 'communication') {
    const acpEmail = clean(acp?.email_communications);
    if (acpEmail) return { email: acpEmail, source: 'acp' };
    const sEmail = clean(syndic?.email_communications);
    if (sEmail) return { email: sEmail, source: 'syndic' };
  }

  // Fallback général : email principal du syndic
  const sGen = clean(syndic?.email);
  if (sGen) return { email: sGen, source: 'syndic_general' };

  // Sinon particulier
  const pcEmail = clean(pc?.email);
  if (pcEmail) return { email: pcEmail, source: 'particulier' };

  return { email: null, source: null };
}
