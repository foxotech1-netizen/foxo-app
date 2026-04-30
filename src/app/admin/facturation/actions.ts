'use server';

import { revalidatePath } from 'next/cache';
import { Resend } from 'resend';
import { createClient } from '@/lib/supabase/server';
import { roleForEmail } from '@/lib/auth/roles';
import { renderToBuffer } from '@react-pdf/renderer';
import path from 'node:path';
import { generateBBA } from '@/lib/facturation/bba';
import { computeFactureTotals, FactureFoxoPdf } from '@/lib/facturation/FactureFoxoPdf';
import { generateEpcQrDataUrl } from '@/lib/facturation/epc-qr';
import { uploadFacture } from '@/lib/google-drive';
import { VENDOR } from '@/lib/constants/vendor';
import type {
  Article,
  Client,
  Facture,
  FactureLigne,
  FactureDetailsIntervention,
  StatutFacture,
  TypeClient,
} from '@/lib/types/database';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || roleForEmail(user.email) !== 'admin') {
    return { ok: false, error: 'Accès refusé.' };
  }
  return { ok: true };
}

// ─── Helpers numéro / dates ──────────────────────────────────────────────

const NUMERO_PREFIX = 'FV';

function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return fmtIsoDate(dt);
}

// Calcule le prochain numéro FV{YYYY}-{NNN} (3 chiffres min) basé sur le max
// existant pour l'année en cours. Permet la modification manuelle ensuite.
export async function generateNextNumero(): Promise<ActionResult<{ numero: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const year = new Date().getFullYear();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('factures')
    .select('numero')
    .like('numero', `${NUMERO_PREFIX}${year}-%`)
    .order('numero', { ascending: false })
    .limit(1);
  if (error) return { ok: false, error: error.message };

  let next = 100;
  if (data && data.length > 0) {
    const m = data[0].numero.match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return { ok: true, data: { numero: `${NUMERO_PREFIX}${year}-${String(next).padStart(3, '0')}` } };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────

export interface FactureInput {
  id?: string;
  numero: string;
  intervention_id: string | null;
  organisation_id: string | null;
  client_id: string | null;
  client_nom: string | null;
  client_email: string | null;
  client_adresse: string | null;
  client_bce: string | null;
  client_syndic: string | null;
  lignes: FactureLigne[];
  details_intervention: FactureDetailsIntervention;
  remise_pct: number;
  tva_pct: number;
  notes: string | null;
  remarques: string | null;
  conditions_paiement: string;
  reference: string | null;
  date_emission: string;       // YYYY-MM-DD
  date_echeance: string;       // YYYY-MM-DD
  statut?: StatutFacture;
}

export async function saveFacture(input: FactureInput): Promise<ActionResult<{ id: string; numero: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  if (!input.numero?.trim()) return { ok: false, error: 'Numéro de facture requis.' };
  if (!Array.isArray(input.lignes) || input.lignes.length === 0) {
    return { ok: false, error: 'Ajoute au moins une ligne de prestation.' };
  }
  for (const l of input.lignes) {
    if (!l.description?.trim()) return { ok: false, error: 'Chaque ligne doit avoir une description.' };
    if (!Number.isFinite(l.quantite) || l.quantite <= 0) return { ok: false, error: 'Quantité invalide.' };
    if (!Number.isFinite(l.prix_unitaire) || l.prix_unitaire < 0) return { ok: false, error: 'Prix invalide.' };
  }

  const totals = computeFactureTotals(input.lignes, input.tva_pct, input.remise_pct);
  const referenceStructuree = generateBBA(input.numero);

  const payload = {
    numero: input.numero.trim(),
    intervention_id: input.intervention_id,
    organisation_id: input.organisation_id,
    client_id: input.client_id,
    client_nom: input.client_nom,
    client_email: input.client_email,
    client_adresse: input.client_adresse,
    client_bce: input.client_bce,
    client_syndic: input.client_syndic,
    lignes: input.lignes,
    details_intervention: input.details_intervention ?? {},
    remise_pct: input.remise_pct,
    tva_pct: input.tva_pct,
    montant_ht: totals.ht,
    montant_tva: totals.tva,
    montant_ttc: totals.ttc,
    notes: input.notes,
    remarques: input.remarques,
    conditions_paiement: input.conditions_paiement,
    reference: input.reference,
    reference_structuree: referenceStructuree,
    statut: input.statut ?? 'brouillon',
    date_emission: input.date_emission,
    date_echeance: input.date_echeance,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from('factures')
      .update(payload)
      .eq('id', input.id)
      .select('id, numero')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Facture introuvable.' };
    revalidatePath('/admin/facturation');
    return { ok: true, data: { id: data.id, numero: data.numero } };
  } else {
    const { data, error } = await supabase
      .from('factures')
      .insert(payload)
      .select('id, numero')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'Ce numéro de facture existe déjà.' };
      return { ok: false, error: error.message };
    }
    if (!data) return { ok: false, error: 'Erreur création.' };
    revalidatePath('/admin/facturation');
    return { ok: true, data: { id: data.id, numero: data.numero } };
  }
}

export async function setFactureStatut(id: string, statut: StatutFacture, datePaiement?: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const patch: Record<string, unknown> = { statut, updated_at: new Date().toISOString() };
  if (statut === 'envoyee') patch.sent_at = new Date().toISOString();
  if (statut === 'payee') patch.date_paiement = datePaiement ?? fmtIsoDate(new Date());
  if (statut !== 'payee') patch.date_paiement = null;

  const supabase = await createClient();
  const { error } = await supabase.from('factures').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };

  // Upload Drive sur émission (best-effort, non bloquant)
  if (statut === 'envoyee') {
    try {
      const { data: f } = await supabase.from('factures').select('*').eq('id', id).maybeSingle();
      if (f) {
        const facture = f as Facture;
        const ttc = facture.montant_ttc ?? 0;
        let qrDataUrl: string | undefined;
        try {
          qrDataUrl = await generateEpcQrDataUrl({
            beneficiaryName: VENDOR.name,
            iban: VENDOR.iban,
            amountEur: ttc > 0 ? ttc : 0.01,
            bba: facture.reference_structuree ?? undefined,
          });
        } catch { /* noop */ }
        const logoSrc = path.join(process.cwd(), 'public', 'foxo-logo-transparent.png');
        const pdf = await renderToBuffer(FactureFoxoPdf({ facture, qrDataUrl, logoSrc }));
        const date = facture.date_emission ? new Date(facture.date_emission) : new Date();
        await uploadFacture({ numero: facture.numero, date, bytes: new Uint8Array(pdf) });
      }
    } catch (e) {
      console.warn('[setFactureStatut] uploadFacture skipped:', e);
    }
  }

  revalidatePath('/admin/facturation');
  return { ok: true };
}

export async function deleteFacture(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  // Ne supprime que les brouillons. Sinon, on annule.
  const { data: f } = await supabase.from('factures').select('statut').eq('id', id).maybeSingle();
  if (!f) return { ok: false, error: 'Facture introuvable.' };
  if (f.statut === 'brouillon') {
    const { error } = await supabase.from('factures').delete().eq('id', id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('factures')
      .update({ statut: 'annulee', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/admin/facturation');
  return { ok: true };
}

// ─── Recherche intervention pour pré-remplissage ─────────────────────────

export async function searchInterventionsForFacture(query: string): Promise<ActionResult<Array<{ id: string; ref: string | null; acp_nom: string | null; syndic_nom: string | null; syndic_email: string | null; syndic_bce: string | null; syndic_adresse: string | null }>>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const q = query.trim();
  if (q.length < 2) return { ok: true, data: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('interventions')
    .select(`
      id, ref,
      acp:acps(nom, adresse, code_postal, ville),
      syndic:organisations(nom, email, bce, adresse)
    `)
    .or(`ref.ilike.%${q}%,description.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: error.message };

  type Row = {
    id: string;
    ref: string | null;
    acp: { nom: string | null; adresse: string | null; code_postal: string | null; ville: string | null } | null;
    syndic: { nom: string | null; email: string | null; bce: string | null; adresse: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      acp_nom: r.acp?.nom ?? null,
      syndic_nom: r.syndic?.nom ?? null,
      syndic_email: r.syndic?.email ?? null,
      syndic_bce: r.syndic?.bce ?? null,
      syndic_adresse: r.syndic?.adresse ?? null,
    })),
  };
}

// ─── Import CSV Beobank ──────────────────────────────────────────────────

interface BeobankTx {
  date: string;
  montant: number;
  communication: string;
}

// Beobank exporte en CSV séparé par ";". Colonnes typiques (FR) :
// "Date;Description;Montant;Devise;Communication;Solde;..."
// On cherche les transactions positives (entrées) avec une communication
// structurée matchant une facture.
function parseBeobankCsv(text: string): BeobankTx[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const header = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const idxDate = header.findIndex((h) => h.includes('date'));
  const idxMontant = header.findIndex((h) => h.includes('montant') || h.includes('amount'));
  const idxComm = header.findIndex((h) => h.includes('communication') || h.includes('reference') || h.includes('comm'));
  if (idxDate < 0 || idxMontant < 0 || idxComm < 0) return [];

  const out: BeobankTx[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 3) continue;
    const dateRaw = cells[idxDate];
    const montantRaw = cells[idxMontant].replace(/\./g, '').replace(',', '.');
    const montant = parseFloat(montantRaw);
    if (!Number.isFinite(montant)) continue;
    // Format DD/MM/YYYY ou YYYY-MM-DD
    let dateIso = dateRaw;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)) {
      const [d, m, y] = dateRaw.split('/');
      dateIso = `${y}-${m}-${d}`;
    }
    out.push({ date: dateIso, montant, communication: cells[idxComm] });
  }
  return out;
}

export async function importBeobankCsv(csv: string): Promise<ActionResult<{ matched: number; unmatched: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const txs = parseBeobankCsv(csv);
  if (txs.length === 0) return { ok: false, error: 'Aucune transaction parsable dans le CSV.' };

  const supabase = await createClient();
  let matched = 0;
  let unmatched = 0;

  for (const tx of txs) {
    if (tx.montant <= 0) continue;     // ignore les sorties
    // Extrait les 12 chiffres BBA si présents
    const digits = tx.communication.replace(/\D/g, '');
    if (digits.length !== 12) { unmatched++; continue; }
    const bba = `+++${digits.slice(0, 3)}/${digits.slice(3, 7)}/${digits.slice(7, 12)}+++`;

    const { data: f } = await supabase
      .from('factures')
      .select('id, statut')
      .eq('reference_structuree', bba)
      .maybeSingle();
    if (!f) { unmatched++; continue; }
    if (f.statut === 'payee' || f.statut === 'annulee') { matched++; continue; }
    const { error } = await supabase
      .from('factures')
      .update({ statut: 'payee', date_paiement: tx.date, updated_at: new Date().toISOString() })
      .eq('id', f.id);
    if (!error) matched++;
  }

  revalidatePath('/admin/facturation');
  return { ok: true, data: { matched, unmatched } };
}

// ─── Export comptable CSV + envoi email ──────────────────────────────────

function csvEscape(s: string): string {
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildComptableCsv(rows: Facture[]): string {
  const header = [
    'N° facture', 'Date émission', 'Date échéance', 'Date paiement',
    'Client', 'BCE client', 'Référence',
    'Montant HT', 'Taux TVA', 'Montant TVA', 'Montant TTC',
    'Statut',
  ];
  const lines = [header.join(';')];
  for (const f of rows) {
    lines.push([
      f.numero,
      f.date_emission ?? '',
      f.date_echeance ?? '',
      f.date_paiement ?? '',
      csvEscape(f.client_nom ?? ''),
      f.client_bce ?? '',
      csvEscape(f.reference ?? ''),
      (f.montant_ht ?? 0).toFixed(2).replace('.', ','),
      String(f.tva_pct),
      (f.montant_tva ?? 0).toFixed(2).replace('.', ','),
      (f.montant_ttc ?? 0).toFixed(2).replace('.', ','),
      f.statut,
    ].join(';'));
  }
  return lines.join('\n');
}

export async function buildComptableCsvForRange(from: string, to: string): Promise<ActionResult<{ csv: string; count: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('factures')
    .select('*')
    .gte('date_emission', from)
    .lte('date_emission', to)
    .order('numero', { ascending: true });
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Facture[];
  return { ok: true, data: { csv: buildComptableCsv(rows), count: rows.length } };
}

export async function sendComptableEmail(from: string, to: string): Promise<ActionResult<{ sent: number }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createClient();
  // Récupère email comptable depuis parametres
  const { data: param } = await supabase
    .from('parametres').select('valeur').eq('cle', 'email_comptable').maybeSingle();
  const emailComptable = (param?.valeur ?? '').trim();
  if (!emailComptable) {
    return { ok: false, error: 'Email comptable non configuré (voir /admin/parametres).' };
  }

  const csvRes = await buildComptableCsvForRange(from, to);
  if (!csvRes.ok) return csvRes;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY non configurée.' };

  const resend = new Resend(apiKey);
  try {
    await resend.emails.send({
      from: `${VENDOR.name} <info@foxo.be>`,
      to: [emailComptable],
      subject: `Export facturation ${from} → ${to} (${csvRes.data!.count} factures)`,
      text: `Bonjour,\n\nVous trouverez ci-joint l'export comptable des factures émises entre le ${from} et le ${to}.\n\nNombre de factures : ${csvRes.data!.count}\n\nCordialement,\n${VENDOR.name}`,
      attachments: [
        {
          filename: `factures-${from}-${to}.csv`,
          content: Buffer.from(csvRes.data!.csv, 'utf-8').toString('base64'),
        },
      ],
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Erreur Resend.' };
  }

  return { ok: true, data: { sent: csvRes.data!.count } };
}

// ─── Pré-remplissage depuis intervention ─────────────────────────────────

export async function loadInterventionForFacture(interventionId: string): Promise<ActionResult<{
  ref: string | null;
  client_nom: string | null;
  client_email: string | null;
  client_adresse: string | null;
  client_bce: string | null;
  client_syndic: string | null;
  organisation_id: string | null;
  details: FactureDetailsIntervention;
}>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;

  const supabase = await createClient();
  const { data: iv, error } = await supabase
    .from('interventions')
    .select('id, ref, syndic_id, acp_id, demandeur_type, particulier_contact, adresse, billing_override, syndic:organisations(nom, email, bce, adresse, type), acp:acps(nom, adresse, code_postal, ville, bce)')
    .eq('id', interventionId)
    .maybeSingle();
  if (error || !iv) return { ok: false, error: 'Intervention introuvable.' };

  type IvJoined = {
    id: string; ref: string | null; syndic_id: string | null;
    acp_id: string | null;
    demandeur_type: string | null;
    particulier_contact: {
      prenom: string; nom: string; email: string; telephone: string;
      adresse: { rue: string; code_postal: string; ville: string };
      mandant?: { prenom: string; nom: string; email: string; tel: string;
                  adresse_facturation: { rue: string; code_postal: string; ville: string }; bce?: string };
    } | null;
    adresse: string | null;
    billing_override: { rue: string; cp: string; ville: string; bce?: string } | null;
    syndic: { nom: string | null; email: string | null; bce: string | null; adresse: string | null; type: string | null } | null;
    acp: { nom: string | null; adresse: string | null; code_postal: string | null; ville: string | null; bce: string | null } | null;
  };
  const t = iv as unknown as IvJoined;

  let client_nom: string | null = null;
  let client_email: string | null = null;
  let client_adresse: string | null = null;
  let client_bce: string | null = null;
  let client_syndic: string | null = null;

  if (t.demandeur_type === 'particulier' && t.particulier_contact) {
    const c = t.particulier_contact;
    client_nom = `${c.prenom} ${c.nom}`.trim();
    client_email = c.email;
    // Préférer adresse de facturation du mandant si présente, sinon adresse
    // intervention (rétrocompat).
    if (c.mandant?.adresse_facturation) {
      const a = c.mandant.adresse_facturation;
      client_adresse = `${a.rue}, ${a.code_postal} ${a.ville}`;
      if (c.mandant.bce) client_bce = c.mandant.bce;
    } else {
      client_adresse = `${c.adresse.rue}, ${c.adresse.code_postal} ${c.adresse.ville}`;
    }
  } else if (t.syndic) {
    // Cas standard belge : ACP est le débiteur, syndic est le gestionnaire
    // (c/o). Si l'intervention est rattachée à un ACP → utilise ses
    // infos comme destinataire ; sinon fallback sur syndic = client direct.
    if (t.acp) {
      client_nom = t.acp.nom;
      client_bce = t.acp.bce;
      client_email = t.syndic.email;        // facture envoyée au syndic
      // c/o = nom du syndic (gestionnaire)
      client_syndic = t.syndic.nom ? `c/o ${t.syndic.nom}` : null;
      // Adresse de correspondance = adresse du syndic
      // (override de facturation prioritaire si défini)
      if (t.billing_override) {
        const o = t.billing_override;
        client_adresse = `${o.rue}, ${o.cp} ${o.ville}`;
        if (o.bce) client_bce = o.bce;
      } else {
        client_adresse = t.syndic.adresse;
      }
    } else {
      // Pas d'ACP rattaché → syndic = client direct (legacy / cas hors copro)
      client_nom = t.syndic.nom;
      client_email = t.syndic.email;
      if (t.billing_override) {
        const o = t.billing_override;
        client_adresse = `${o.rue}, ${o.cp} ${o.ville}`;
        if (o.bce) client_bce = o.bce;
        else client_bce = t.syndic.bce;
      } else {
        client_adresse = t.syndic.adresse;
        client_bce = t.syndic.bce;
      }
      client_syndic = t.syndic.type === 'courtier' ? 'Courtier' : 'Syndic';
    }
  }

  const acpAdresse = t.acp
    ? [t.acp.adresse, t.acp.code_postal, t.acp.ville].filter(Boolean).join(', ')
    : t.adresse;

  // Charge la liste des appartements/unités inspectés pour pré-remplir
  // le champ details.appartements ("App 1706 - 1806 - Cave 2").
  const { data: occRows } = await supabase
    .from('occupants')
    .select('appartement')
    .eq('intervention_id', interventionId)
    .order('appartement', { ascending: true });
  const appartements = ((occRows ?? []) as { appartement: string | null }[])
    .map((o) => o.appartement)
    .filter((a): a is string => Boolean(a && a.trim()))
    .join(' - ');

  const details: FactureDetailsIntervention = {
    ref_dossier: t.ref ?? undefined,
    adresse_intervention: acpAdresse ?? undefined,
    appartements: appartements || undefined,
  };

  return {
    ok: true,
    data: {
      ref: t.ref,
      client_nom,
      client_email,
      client_adresse,
      client_bce,
      client_syndic,
      organisation_id: t.syndic_id,
      details,
    },
  };
}

// ─── Paramètres admin (lecture/écriture KV) ──────────────────────────────

export async function setParametre(cle: string, valeur: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { error } = await supabase
    .from('parametres')
    .upsert({ cle, valeur, updated_at: new Date().toISOString() }, { onConflict: 'cle' });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/parametres');
  return { ok: true };
}

// ─── Articles (catalogue) ────────────────────────────────────────────────

function ttcToHtva(ttc: number, tvaPct: number): number {
  if (!Number.isFinite(ttc) || ttc < 0) return 0;
  return Math.round((ttc / (1 + tvaPct / 100)) * 100) / 100;
}

export interface ArticleInput {
  id?: string;
  code: string;
  description: string;
  prix_ttc: number;       // saisie utilisateur
  tva_pct: number;
  actif: boolean;
}

export async function saveArticle(input: ArticleInput): Promise<ActionResult<{ id: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  if (!input.code?.trim()) return { ok: false, error: 'Code requis.' };
  if (!input.description?.trim()) return { ok: false, error: 'Description requise.' };
  if (!Number.isFinite(input.prix_ttc) || input.prix_ttc < 0) return { ok: false, error: 'Prix TTC invalide.' };
  if (!Number.isFinite(input.tva_pct) || input.tva_pct < 0) return { ok: false, error: 'Taux TVA invalide.' };

  const prix_htva = ttcToHtva(input.prix_ttc, input.tva_pct);
  const payload = {
    code: input.code.trim(),
    description: input.description.trim(),
    prix_htva,
    tva_pct: input.tva_pct,
    actif: input.actif,
  };

  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from('articles')
      .update(payload)
      .eq('id', input.id)
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Article introuvable.' };
    revalidatePath('/admin/articles');
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await supabase
    .from('articles')
    .insert(payload)
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Ce code existe déjà.' };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: 'Erreur création.' };
  revalidatePath('/admin/articles');
  return { ok: true, data: { id: data.id } };
}

export async function deleteArticle(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  const { error } = await supabase.from('articles').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/articles');
  return { ok: true };
}

// ─── Clients ─────────────────────────────────────────────────────────────

export interface ClientInput {
  id?: string;
  type: TypeClient;
  nom: string;
  prenom?: string | null;
  email?: string | null;
  telephone?: string | null;
  adresse?: string | null;
  code_postal?: string | null;
  ville?: string | null;
  pays?: string | null;
  bce?: string | null;
  tva?: string | null;
  contact_nom?: string | null;
  contact_email?: string | null;
  contact_telephone?: string | null;
  notes?: string | null;
  actif?: boolean;
}

export async function saveClient(input: ClientInput): Promise<ActionResult<{ id: string }>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  if (!input.nom?.trim()) return { ok: false, error: 'Nom requis.' };
  if (!['acp', 'particulier', 'entreprise'].includes(input.type)) {
    return { ok: false, error: 'Type invalide.' };
  }

  const payload = {
    type: input.type,
    nom: input.nom.trim(),
    prenom: input.prenom?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    telephone: input.telephone?.trim() || null,
    adresse: input.adresse?.trim() || null,
    code_postal: input.code_postal?.trim() || null,
    ville: input.ville?.trim() || null,
    pays: input.pays?.trim() || 'Belgique',
    bce: input.bce?.trim() || null,
    tva: input.tva?.trim() || null,
    contact_nom: input.contact_nom?.trim() || null,
    contact_email: input.contact_email?.trim().toLowerCase() || null,
    contact_telephone: input.contact_telephone?.trim() || null,
    notes: input.notes?.trim() || null,
    actif: input.actif ?? true,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from('clients')
      .update(payload)
      .eq('id', input.id)
      .select('id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Client introuvable.' };
    revalidatePath('/admin/clients');
    return { ok: true, data: { id: data.id } };
  }
  const { data, error } = await supabase
    .from('clients')
    .insert(payload)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Erreur création.' };
  revalidatePath('/admin/clients');
  return { ok: true, data: { id: data.id } };
}

export async function deleteClient(id: string): Promise<ActionResult> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const supabase = await createClient();
  // Soft-delete : marque inactif, ne supprime pas (préserve les liens factures)
  const { error } = await supabase
    .from('clients')
    .update({ actif: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/clients');
  return { ok: true };
}

export async function searchClients(query: string): Promise<ActionResult<Client[]>> {
  const guard = await assertAdmin();
  if (!guard.ok) return guard;
  const q = query.trim();
  if (q.length < 2) return { ok: true, data: [] };
  const safe = q.replace(/[,()]/g, ' ');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('actif', true)
    .or(`nom.ilike.%${safe}%,bce.ilike.%${safe}%,email.ilike.%${safe}%`)
    .order('nom', { ascending: true })
    .limit(12);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Client[] };
}

