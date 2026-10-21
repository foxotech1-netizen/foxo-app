// Reconstruction des dossiers FoxO depuis le miroir Odoo — phase 1.
//
// Règle métier (Foxo, 22/10/2026) : une facture de vente = un dossier,
// numéroté par la facture (FV2026-152 → 2026-152), daté de la facture,
// client = tiers facturé. Cette phase CRÉE les dossiers manquants, après une
// vérification à blanc obligatoire, et SIGNALE seulement les écarts sur les
// dossiers existants : aucun dossier existant n'est modifié, aucune ACP ni
// organisation n'est créée, rien n'est écrit dans Odoo.
//
// Deux fonctions :
//   planifierReconstruction : lecture seule, un verdict par numéro de dossier ;
//   executerReconstruction  : crée les dossiers « a_creer » demandés (20 au
//                             plus par appel) via createInterventionCold —
//                             même chemin que l'import Excel : silencieux
//                             (ni mail, ni agenda, ni Drive).
// Le client est résolu dans les référentiels existants (BCE, puis nom
// nettoyé) ; faute d'ACP et sans BCE, le dossier reçoit un demandeur
// particulier minimal, comme l'import.

import { createAdminClient } from '@/lib/supabase/admin';
import { createInterventionCold, type CreateInterventionColdInput } from '@/app/admin/interventions/actions';
import type { CreateFromSlotParticulier, CreateFromSlotSyndic } from '@/app/admin/planning/actions';
import { safeTypeIntervention } from '@/lib/mails/intervention-types';
import { TZ_BRUSSELS } from '@/lib/format';
import { FOXO_DEFAULT_SLOT_START } from '@/lib/foxo-slots';
import { creneauDebutIso, mapStatutFichier, normalise, normaliseNomAcp } from '@/lib/import/encodage-froid';
import {
  demandeurParticulierMinimal,
  extraireCpVille,
  type AcpRow,
  type SyndicRow,
} from '@/lib/import/resolution';
import type { OdooLigneFacture } from './odoo-sync';

// ─── Types publics ──────────────────────────────────────────────────────────

export type StatutVerdict = 'a_creer' | 'existant_ok' | 'existant_ecarts' | 'a_qualifier' | 'sans_facture';

export const STATUTS_VERDICT: readonly StatutVerdict[] = [
  'a_creer', 'existant_ok', 'existant_ecarts', 'a_qualifier', 'sans_facture',
];

export interface Verdict {
  ref: string;
  statut: StatutVerdict;
  /** Numéros des factures de vente de ce dossier (plus récente d'abord). */
  numeros: string[];
  date_facture: string | null;
  tiers_nom: string | null;
  /** Adresse retenue pour le dossier (référence Odoo, sinon fiche client). */
  adresse: string | null;
  /** Client résolu : « ACP … · syndic … » ou « Particulier : … », sinon null. */
  client: string | null;
  details: string[];
}

export interface PlanReconstruction {
  verdicts: Verdict[];
  resume: Record<StatutVerdict, number>;
}

export interface LigneJournal {
  ref: string;
  resultat: 'cree' | 'ignore' | 'rejet';
  message: string;
  intervention_id?: string;
}

export const MAX_REFS_PAR_APPEL = 20;

// ─── Lecture ────────────────────────────────────────────────────────────────

type Admin = ReturnType<typeof createAdminClient>;

interface FactureMiroir {
  odoo_id: number;
  numero: string | null;
  reference: string | null;
  dossier_ref: string;
  intervention_id: string | null;
  date_facture: string | null;
  montant_ttc: number | null;
  lignes: OdooLigneFacture[] | null;
  tiers_nom: string | null;
  tiers_bce: string | null;
  tiers_email: string | null;
  tiers_telephone: string | null;
  tiers_adresse: string | null;
}

interface DossierRow {
  id: string;
  ref: string | null;
  adresse: string | null;
  creneau_debut: string | null;
  acp_id: string | null;
  syndic_id: string | null;
  demandeur_type: string | null;
}

interface Contexte {
  factures: FactureMiroir[];
  dossiers: DossierRow[];
  acps: AcpRow[];
  syndics: SyndicRow[];
}

const COLONNES_FACTURE =
  'odoo_id, numero, reference, dossier_ref, intervention_id, date_facture, montant_ttc, lignes, tiers_nom, tiers_bce, tiers_email, tiers_telephone, tiers_adresse';
const COLONNES_DOSSIER = 'id, ref, adresse, creneau_debut, acp_id, syndic_id, demandeur_type';

// Le client Supabase plafonne à 1 000 lignes par lecture : on pagine.
const PAGE = 1_000;
const PAGES_MAX = 20;

async function toutLire<T>(
  quoi: string,
  page: (de: number, a: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const lignes: T[] = [];
  for (let i = 0; i < PAGES_MAX; i += 1) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new Error(`Lecture ${quoi} : ${error.message}`);
    const lot = (data ?? []) as T[];
    lignes.push(...lot);
    if (lot.length < PAGE) break;
  }
  return lignes;
}

// Numéro « fourre-tout » (2026-000) : jamais un dossier à reconstruire.
function estRefSpeciale(ref: string): boolean {
  return /^\d{4}-0+$/.test(ref);
}

async function charger(admin: Admin): Promise<Contexte> {
  const factures = await toutLire<FactureMiroir>('odoo_factures', (de, a) =>
    admin
      .from('odoo_factures')
      .select(COLONNES_FACTURE)
      .eq('sens', 'vente')
      .eq('est_note_credit', false)
      .not('dossier_ref', 'is', null)
      .order('date_facture', { ascending: false, nullsFirst: false })
      .order('odoo_id', { ascending: false })
      .range(de, a),
  );

  // Dossiers FoxO des années présentes dans les factures (« 2026-… »).
  const annees = [...new Set(factures.map((f) => f.dossier_ref.split('-')[0]))].filter((a) => /^\d{4}$/.test(a));
  const dossiers: DossierRow[] = [];
  for (const annee of annees) {
    dossiers.push(...await toutLire<DossierRow>(`interventions ${annee}`, (de, a) =>
      admin
        .from('interventions')
        .select(COLONNES_DOSSIER)
        .like('ref', `${annee}-%`)
        .is('deleted_at', null)
        .order('ref', { ascending: true })
        .range(de, a),
    ));
  }

  const [acpRes, synRes] = await Promise.all([
    admin.from('acps').select('id, nom, adresse, syndic_id_ref, bce'),
    admin.from('organisations').select('id, nom, bce').eq('type', 'syndic'),
  ]);
  if (acpRes.error) throw new Error(`Lecture ACP : ${acpRes.error.message}`);
  if (synRes.error) throw new Error(`Lecture syndics : ${synRes.error.message}`);

  return {
    factures,
    dossiers: dossiers.filter((d) => d.ref && !estRefSpeciale(d.ref)),
    acps: (acpRes.data ?? []) as AcpRow[],
    syndics: (synRes.data ?? []) as SyndicRow[],
  };
}

// ─── Petits utilitaires ─────────────────────────────────────────────────────

function chiffres(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

function fmtJour(d: string | null): string {
  return d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
}

function fmtMontant(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function jourBruxelles(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toLocaleDateString('en-CA', { timeZone: TZ_BRUSSELS });
}

function aujourdhui(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_BRUSSELS });
}

// Tri naturel des numéros de dossier : année puis numéro.
function cleRef(ref: string): [number, number] {
  const [a, n] = ref.split('-');
  return [Number(a) || 0, Number(n) || 0];
}

/**
 * Adresse portée par la référence Odoo, une fois le numéro de dossier retiré
 * (« 2026-238 Rue Willems 14 » → « Rue Willems 14 »). Regex structurelle :
 * même motif que extraireDossierRef (odoo-sync.ts).
 */
function adresseDepuisReference(reference: string | null): string | null {
  const a = (reference ?? '').replace(/^\s*\d{4}-\d+\s*/, '').replace(/^[\s\-–—:,;]+/, '').trim();
  return a || null;
}

/**
 * Nom du tiers débarrassé de ce qui n'est pas le nom : tout ce qui suit un
 * identifiant (« BCE 0850.924.580 », « BE 0850 597 948 »), les parenthèses et
 * leur contenu, la ponctuation de fin.
 */
export function nomNettoye(tiersNom: string): string {
  return tiersNom
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:BCE|BE)[\s:.\-–—]*\d[\d .]*.*$/i, ' ')
    .replace(/[\s\-–—:,;.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** « Rue X 12, 1000 Bruxelles » → rue sans sa localité + cp + ville. */
function decouperAdresse(adresse: string): { rue: string; cp: string; ville: string } {
  const { cp, ville } = extraireCpVille(adresse);
  const rue = cp === '0000'
    ? adresse.trim()
    : adresse.replace(/[,;]?\s*\d{4}\s+[^,;]+?\s*$/, '').trim() || adresse.trim();
  return { rue, cp, ville };
}

// Même adresse ? Égalité normalisée, ou l'adresse FoxO commence par l'adresse
// Odoo suivie de sa localité (« Rue X 14 » ↔ « Rue X 14, 1210 Saint-Josse »).
function memeAdresse(foxo: string | null, odoo: string): boolean {
  const a = normalise(foxo ?? '');
  const b = normalise(odoo);
  return a === b || a.startsWith(`${b},`);
}

// Statut d'un dossier reconstruit : celui que l'import donne à « Réalisée ».
function statutRealisee() {
  const r = mapStatutFichier('Réalisée');
  if (!r.ok) throw new Error(`Statut « Réalisée » inconnu de l'import : ${r.raison}`);
  return r.statut;
}

// ─── Résolution du client ───────────────────────────────────────────────────

type ClientResolu =
  | { kind: 'acp'; acp: AcpRow; syndic: SyndicRow; via: 'BCE' | 'nom' }
  | { kind: 'particulier'; nom: string | null }
  | { kind: 'inconnu'; raison: string };

function resoudreClient(f: FactureMiroir, acps: AcpRow[], syndics: SyndicRow[]): ClientResolu {
  const bce = chiffres(f.tiers_bce);
  let acp: AcpRow | null = null;
  let via: 'BCE' | 'nom' = 'BCE';

  // 1. BCE de la facture = BCE d'une ACP.
  if (bce.length === 10) {
    const parBce = acps.filter((a) => chiffres(a.bce) === bce);
    if (parBce.length > 1) {
      return { kind: 'inconnu', raison: `BCE ${f.tiers_bce} porté par plusieurs ACP (${parBce.map((a) => a.nom).join(', ')})` };
    }
    acp = parBce[0] ?? null;
  }
  // 2. Sinon nom nettoyé, égalité stricte après normalisation.
  if (!acp) {
    const nom = nomNettoye(f.tiers_nom ?? '');
    const cible = nom ? normaliseNomAcp(nom) : '';
    if (cible) {
      const parNom = acps.filter((a) => normaliseNomAcp(a.nom) === cible);
      if (parNom.length > 1) {
        return { kind: 'inconnu', raison: `nom « ${nom} » porté par plusieurs ACP (${parNom.map((a) => a.nom).join(', ')})` };
      }
      acp = parNom[0] ?? null;
      via = 'nom';
    }
  }
  // 3. ACP trouvée → son syndic.
  if (acp) {
    const syndic = acp.syndic_id_ref ? syndics.find((s) => s.id === acp.syndic_id_ref) ?? null : null;
    if (!syndic) return { kind: 'inconnu', raison: `ACP « ${acp.nom} » sans syndic` };
    return { kind: 'acp', acp, syndic, via };
  }
  // 4. Un BCE mais aucune ACP : le référentiel doit être complété d'abord.
  if (bce.length > 0) {
    return { kind: 'inconnu', raison: `client avec BCE ${f.tiers_bce} inconnu du référentiel : créer l'ACP d'abord` };
  }
  // 5. Ni ACP ni BCE : particulier minimal.
  return { kind: 'particulier', nom: f.tiers_nom?.trim() || null };
}

function libelleClient(c: ClientResolu): string | null {
  if (c.kind === 'acp') return `ACP ${c.acp.nom} · syndic ${c.syndic.nom}`;
  if (c.kind === 'particulier') return `Particulier : ${c.nom ?? '—'}`;
  return null;
}

// ─── Plan ───────────────────────────────────────────────────────────────────

interface Groupe {
  ref: string;
  factures: FactureMiroir[];
  /** Fiche de référence : la facture la plus récente. */
  fiche: FactureMiroir;
}

function grouper(factures: FactureMiroir[]): Groupe[] {
  const parRef = new Map<string, FactureMiroir[]>();
  for (const f of factures) {
    const liste = parRef.get(f.dossier_ref) ?? [];
    liste.push(f);
    parRef.set(f.dossier_ref, liste);
  }
  const groupes: Groupe[] = [];
  for (const [ref, liste] of parRef) {
    if (estRefSpeciale(ref)) continue;
    liste.sort((x, y) => (y.date_facture ?? '').localeCompare(x.date_facture ?? '') || y.odoo_id - x.odoo_id);
    groupes.push({ ref, factures: liste, fiche: liste[0] });
  }
  return groupes;
}

function description(groupe: Groupe): string {
  const creeLe = fmtJour(aujourdhui());
  return groupe.factures
    .map((f) => {
      const libelles = (f.lignes ?? [])
        .map((l) => (l.libelle ?? l.produit ?? '').trim())
        .filter(Boolean)
        .join(' ; ');
      return [
        `Créé depuis Odoo le ${creeLe}`,
        `Facture ${f.numero ?? `pièce ${f.odoo_id}`} du ${fmtJour(f.date_facture)}`,
        `Prestation facturée : ${libelles || '—'}`,
        `${fmtMontant(f.montant_ttc)} € TTC`,
      ].join(' · ');
    })
    .join('\n');
}

interface Prepare {
  verdict: Verdict;
  input: CreateInterventionColdInput | null;
}

function preparer(groupe: Groupe, ctx: Contexte, parRefDossier: Map<string, DossierRow>): Prepare {
  const { ref, fiche } = groupe;
  const details: string[] = [];
  const numeros = groupe.factures.map((f) => f.numero ?? `pièce ${f.odoo_id}`);
  if (groupe.factures.length > 1) details.push(`${groupe.factures.length} factures de vente pour ce dossier`);

  // Adresse : référence Odoo, sinon fiche client, sinon inconnue.
  let adresse = adresseDepuisReference(fiche.reference);
  if (adresse) details.push('adresse lue dans la référence Odoo');
  else if (fiche.tiers_adresse?.trim()) {
    adresse = fiche.tiers_adresse.trim();
    details.push('adresse reprise de la fiche client (référence Odoo sans adresse)');
  } else {
    details.push('adresse inconnue (ni référence, ni fiche client)');
  }

  const client = resoudreClient(fiche, ctx.acps, ctx.syndics);
  if (client.kind === 'acp') details.push(`client reconnu par ${client.via}`);
  if (client.kind === 'inconnu') details.push(client.raison);

  const base: Omit<Verdict, 'statut'> = {
    ref,
    numeros,
    date_facture: fiche.date_facture,
    tiers_nom: fiche.tiers_nom,
    adresse,
    client: libelleClient(client),
    details,
  };

  // Dossier déjà présent : on compare, on ne touche à rien.
  const dossier = parRefDossier.get(ref);
  if (dossier) {
    const ecarts: string[] = [];
    const jourDossier = jourBruxelles(dossier.creneau_debut);
    if (fiche.date_facture && jourDossier !== fiche.date_facture) {
      ecarts.push(`date : dossier ${jourDossier ? fmtJour(jourDossier) : 'sans créneau'} ≠ facture ${fmtJour(fiche.date_facture)}`);
    }
    if (adresse && !memeAdresse(dossier.adresse, adresse)) {
      ecarts.push(`adresse : dossier « ${dossier.adresse ?? '—'} » ≠ Odoo « ${adresse} »`);
    }
    if (dossier.acp_id && client.kind === 'acp' && dossier.acp_id !== client.acp.id) {
      const acpDossier = ctx.acps.find((a) => a.id === dossier.acp_id);
      ecarts.push(`ACP : dossier « ${acpDossier?.nom ?? dossier.acp_id} » ≠ Odoo « ${client.acp.nom} »`);
    }
    return {
      verdict: { ...base, statut: ecarts.length > 0 ? 'existant_ecarts' : 'existant_ok', details: [...ecarts, ...details] },
      input: null,
    };
  }

  if (client.kind === 'inconnu') return { verdict: { ...base, statut: 'a_qualifier' }, input: null };
  if (!fiche.date_facture) {
    return { verdict: { ...base, statut: 'a_qualifier', details: ['facture sans date', ...details] }, input: null };
  }

  // Dossier à créer : même forme d'entrée que l'import Excel.
  let demandeur: CreateFromSlotSyndic | CreateFromSlotParticulier;
  if (client.kind === 'acp') {
    demandeur = { demandeur_type: 'syndic', acp_id: client.acp.id, syndic_id: client.syndic.id, occupants: [] };
  } else {
    // Facturation = fiche client ; lieu = adresse du dossier.
    const particulier = demandeurParticulierMinimal(
      { nom: fiche.tiers_nom ?? '', email: fiche.tiers_email ?? '', tel: fiche.tiers_telephone ?? '', adresse: fiche.tiers_adresse ?? '' },
      null,
    );
    if (fiche.tiers_adresse?.trim()) {
      const fact = decouperAdresse(fiche.tiers_adresse);
      particulier.mandant.adresse_facturation = { rue: fact.rue, code_postal: fact.cp, ville: fact.ville };
    }
    const lieu = decouperAdresse(adresse ?? '—');
    if (lieu.cp === '0000' && fiche.tiers_adresse?.trim()) {
      const secours = extraireCpVille(fiche.tiers_adresse);
      lieu.cp = secours.cp;
      lieu.ville = secours.ville;
    }
    if (lieu.cp === '0000') details.push('code postal et ville inconnus');
    particulier.lieu = { meme_que_mandant: false, rue: lieu.rue, cp: lieu.cp, ville: lieu.ville };
    demandeur = particulier;
    details.push('demandeur particulier minimal (aucune ACP reconnue, pas de BCE)');
  }

  const input: CreateInterventionColdInput = {
    ref,
    statut: statutRealisee(),
    type: safeTypeIntervention(null),
    priorite: 'normale',
    adresse: adresse ?? '—',
    creneau_debut: creneauDebutIso(fiche.date_facture, FOXO_DEFAULT_SLOT_START),
    technicien_id: null,
    demandeur,
    occupants: [],
    description: description(groupe),
  };
  return { verdict: { ...base, statut: 'a_creer' }, input };
}

function calculer(ctx: Contexte): { verdicts: Verdict[]; prepares: Map<string, CreateInterventionColdInput> } {
  const parRefDossier = new Map<string, DossierRow>();
  for (const d of ctx.dossiers) if (d.ref && !parRefDossier.has(d.ref)) parRefDossier.set(d.ref, d);

  const verdicts: Verdict[] = [];
  const prepares = new Map<string, CreateInterventionColdInput>();
  const refsFacturees = new Set<string>();
  for (const groupe of grouper(ctx.factures)) {
    refsFacturees.add(groupe.ref);
    const { verdict, input } = preparer(groupe, ctx, parRefDossier);
    verdicts.push(verdict);
    if (input) prepares.set(groupe.ref, input);
  }
  // Dossiers FoxO de la période sans aucune facture de vente : signalés.
  for (const d of ctx.dossiers) {
    if (!d.ref || refsFacturees.has(d.ref)) continue;
    verdicts.push({
      ref: d.ref,
      statut: 'sans_facture',
      numeros: [],
      date_facture: jourBruxelles(d.creneau_debut),
      tiers_nom: null,
      adresse: d.adresse,
      client: null,
      details: ['dossier FoxO sans facture de vente dans Odoo'],
    });
  }
  verdicts.sort((x, y) => {
    const [ax, nx] = cleRef(x.ref);
    const [ay, ny] = cleRef(y.ref);
    return ax - ay || nx - ny;
  });
  return { verdicts, prepares };
}

function resumer(verdicts: Verdict[]): Record<StatutVerdict, number> {
  const resume = Object.fromEntries(STATUTS_VERDICT.map((s) => [s, 0])) as Record<StatutVerdict, number>;
  for (const v of verdicts) resume[v.statut] += 1;
  return resume;
}

// ─── API ────────────────────────────────────────────────────────────────────

/** Vérification à blanc : un verdict par numéro de dossier. AUCUNE écriture. */
export async function planifierReconstruction(): Promise<PlanReconstruction> {
  const ctx = await charger(createAdminClient());
  const { verdicts } = calculer(ctx);
  return { verdicts, resume: resumer(verdicts) };
}

/**
 * Crée les dossiers « a_creer » parmi `refs` (20 au plus). Le verdict est
 * recalculé juste avant : tout ce qui n'est plus « a_creer » est ignoré.
 * Après création, les factures du miroir sont reliées au nouveau dossier.
 */
export async function executerReconstruction(refs: string[]): Promise<LigneJournal[]> {
  const demandees = [...new Set(refs.map((r) => r.trim()).filter(Boolean))];
  if (demandees.length === 0) throw new Error('Aucun numéro de dossier.');
  if (demandees.length > MAX_REFS_PAR_APPEL) {
    throw new Error(`${MAX_REFS_PAR_APPEL} dossiers au plus par appel (${demandees.length} demandés).`);
  }
  const admin = createAdminClient();
  const { verdicts, prepares } = calculer(await charger(admin));
  const parRef = new Map(verdicts.map((v) => [v.ref, v]));

  const journal: LigneJournal[] = [];
  for (const ref of demandees) {
    const verdict = parRef.get(ref);
    const input = prepares.get(ref);
    if (!verdict || verdict.statut !== 'a_creer' || !input) {
      journal.push({ ref, resultat: 'ignore', message: `ignoré : ${verdict?.statut ?? 'inconnu du miroir'}` });
      continue;
    }
    const res = await createInterventionCold(input);
    if (!res.ok || !res.data) {
      journal.push({ ref, resultat: 'rejet', message: `rejet : ${res.ok ? 'création sans identifiant' : res.error}` });
      continue;
    }
    const { intervention_id } = res.data;
    const { error } = await admin
      .from('odoo_factures')
      .update({ intervention_id })
      .eq('dossier_ref', ref)
      .eq('sens', 'vente');
    journal.push({
      ref,
      resultat: 'cree',
      intervention_id,
      message: error
        ? `dossier créé (${verdict.client ?? 'client inconnu'}) ; factures non reliées : ${error.message}`
        : `dossier créé (${verdict.client ?? 'client inconnu'}) ; ${verdict.numeros.length} facture(s) reliée(s)`,
    });
  }
  return journal;
}
