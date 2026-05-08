import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { roleForEmail } from '@/lib/auth/roles';
import { generateBBA } from '@/lib/facturation/bba';
import type { FactureLigne } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

// POST /api/tech/facture
//
// Body : { intervention_id: string }
//
// Retourne la facture liée à l'intervention, ou la crée en brouillon
// (1 ligne « Détection de fuite » au tarif paramétré, TVA 21 %, statut
// 'brouillon') si aucune n'existe — sert à amorcer un paiement sur
// place côté tech avec un QR EPC. L'admin pourra toujours peaufiner la
// facture (lignes, remises, références) depuis /admin/facturation
// avant l'envoi définitif.
//
// Sécurité : tech connecté + ownership intervention (technicien_id).
// L'insert utilise le client service-role (RLS factures = is_admin).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Autorise les techs whitelist (TECH_EMAILS), les admins, et tout
  // utilisateur dont la row utilisateurs porte role = 'technicien'
  // (techs créés en DB sans être hardcodés dans roles.ts).
  const role = roleForEmail(user?.email);
  const isTech = role === 'tech' || role === 'admin';
  const isTechDB = user
    ? await supabase
        .from('utilisateurs')
        .select('id')
        .eq('email', (user.email ?? '').toLowerCase())
        .eq('role', 'technicien')
        .maybeSingle()
        .then((r) => !!r.data)
    : false;
  if (!user || (!isTech && !isTechDB)) {
    return NextResponse.json({ ok: false, error: 'Accès refusé.' }, { status: 403 });
  }

  let body: { intervention_id?: unknown; articles?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON invalide.' }, { status: 400 });
  }
  const interventionId = typeof body.intervention_id === 'string' ? body.intervention_id : null;
  if (!interventionId) {
    return NextResponse.json({ ok: false, error: 'intervention_id requis.' }, { status: 400 });
  }

  // Articles optionnels : si fournis et non vides, ils remplacent la
  // ligne hardcodée par défaut. Validation type-safe + cap à 50 lignes.
  type ArticleInput = {
    id: string;
    description: string;
    prix_htva: number;
    tva_pct: number;
    quantite: number;
    code: string | null;
  };
  function validateArticles(input: unknown): ArticleInput[] | null {
    if (!Array.isArray(input)) return null;
    if (input.length === 0 || input.length > 50) return null;
    const out: ArticleInput[] = [];
    for (const item of input) {
      if (!item || typeof item !== 'object') return null;
      const a = item as Record<string, unknown>;
      if (typeof a.id !== 'string' || !a.id) return null;
      if (typeof a.description !== 'string' || !a.description) return null;
      if (typeof a.prix_htva !== 'number' || !Number.isFinite(a.prix_htva) || a.prix_htva < 0) return null;
      if (typeof a.tva_pct !== 'number' || !Number.isFinite(a.tva_pct) || a.tva_pct < 0 || a.tva_pct > 100) return null;
      if (typeof a.quantite !== 'number' || !Number.isFinite(a.quantite) || a.quantite < 1) return null;
      out.push({
        id: a.id,
        description: a.description,
        prix_htva: a.prix_htva,
        tva_pct: a.tva_pct,
        quantite: Math.floor(a.quantite),
        code: typeof a.code === 'string' ? a.code : null,
      });
    }
    return out;
  }
  const articlesInput = body.articles !== undefined ? validateArticles(body.articles) : null;

  // Ownership : tech connecté = technicien_id de l'intervention
  const { data: techRow } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!techRow) return NextResponse.json({ ok: false, error: 'Tech inconnu.' }, { status: 403 });

  const { data: iv } = await supabase
    .from('interventions')
    .select('id, technicien_id')
    .eq('id', interventionId)
    .maybeSingle();
  if (!iv || iv.technicien_id !== techRow.id) {
    return NextResponse.json(
      { ok: false, error: 'Intervention non assignée.' },
      { status: 403 },
    );
  }

  // Service-role pour les factures (RLS = is_admin only)
  const admin = createAdminClient();

  // 1. Cherche une facture existante pour cette intervention.
  const { data: existing } = await admin
    .from('factures')
    .select('id, numero, montant_ttc, statut')
    .eq('intervention_id', interventionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      facture: {
        id: existing.id as string,
        numero: existing.numero as string,
        total_ttc: Number(existing.montant_ttc ?? 0),
        statut: existing.statut as string,
      },
    });
  }

  // 2. Pas de facture → on crée un brouillon.
  // 2a. Lignes + totaux : depuis les articles fournis si disponibles,
  //     sinon mode legacy (1 ligne hardcodée au tarif paramètre).
  let lignes: FactureLigne[];
  let tvaPct: number;
  let ht: number;
  let tva: number;
  let ttc: number;

  if (articlesInput) {
    // Mode catalogue : 1 ligne par article, totaux = somme par ligne.
    lignes = articlesInput.map((a) => ({
      description: a.description,
      quantite: a.quantite,
      prix_unitaire: a.prix_htva,
      tva_pct: a.tva_pct,
      ...(a.code ? { article_code: a.code } : {}),
    }));
    const htRaw = lignes.reduce((s, l) => s + l.prix_unitaire * l.quantite, 0);
    const tvaRaw = lignes.reduce((s, l) => s + (l.prix_unitaire * l.quantite * l.tva_pct) / 100, 0);
    ht = Math.round(htRaw * 100) / 100;
    tva = Math.round(tvaRaw * 100) / 100;
    ttc = Math.round((ht + tva) * 100) / 100;
    // tva_pct racine = taux du premier article (purement informatif,
    // chaque ligne porte son propre taux).
    tvaPct = lignes[0].tva_pct;
  } else {
    // Mode legacy : tarif depuis parametres (clé 'tarif_intervention'
    // — string), fallback 150.00 si absent ou non parseable.
    let prixUnitaire = 150;
    const { data: param } = await admin
      .from('parametres')
      .select('valeur')
      .eq('cle', 'tarif_intervention')
      .maybeSingle();
    if (param?.valeur) {
      const v = Number(String(param.valeur).replace(',', '.'));
      if (Number.isFinite(v) && v > 0) prixUnitaire = v;
    }
    tvaPct = 21;
    ht = Math.round(prixUnitaire * 100) / 100;
    tva = Math.round(prixUnitaire * tvaPct) / 100;
    ttc = Math.round((ht + tva) * 100) / 100;
    lignes = [{
      description: 'Détection de fuite — intervention sur site',
      quantite: 1,
      prix_unitaire: prixUnitaire,
      tva_pct: tvaPct,
    }];
  }

  // 2b. Numéro FV{YYYY}-NNN : max existant pour l'année + 1, base 100.
  const year = new Date().getFullYear();
  const prefix = 'FV';
  const { data: lastNum } = await admin
    .from('factures')
    .select('numero')
    .eq('type', 'facture')
    .like('numero', `${prefix}${year}-%`)
    .order('numero', { ascending: false })
    .limit(1);
  let next = 100;
  if (lastNum && lastNum.length > 0) {
    const m = (lastNum[0].numero as string).match(/-(\d+)$/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  const numero = `${prefix}${year}-${String(next).padStart(3, '0')}`;

  // 2c. Dates (émission = aujourd'hui, échéance = +15 jours par défaut)
  const today = new Date();
  const dateEmission = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const ech = new Date(today);
  ech.setDate(ech.getDate() + 15);
  const dateEcheance = `${ech.getFullYear()}-${String(ech.getMonth() + 1).padStart(2, '0')}-${String(ech.getDate()).padStart(2, '0')}`;

  const payload = {
    type: 'facture' as const,
    numero,
    intervention_id: interventionId,
    organisation_id: null,
    client_id: null,
    client_nom: null,
    client_email: null,
    client_adresse: null,
    client_bce: null,
    client_syndic: null,
    lignes,
    details_intervention: {},
    remise_pct: 0,
    remise_globale_valeur: 0,
    remise_globale_type: null,
    remise_globale_description: null,
    tva_pct: tvaPct,
    montant_ht: ht,
    montant_tva: tva,
    montant_ttc: ttc,
    notes: null,
    remarques: null,
    conditions_paiement: '15 jours',
    reference: null,
    reference_structuree: generateBBA(numero),
    statut: 'brouillon' as const,
    date_emission: dateEmission,
    date_echeance: dateEcheance,
    facture_origine_id: null,
    validite_jours: null,
  };

  const { data: created, error } = await admin
    .from('factures')
    .insert(payload)
    .select('id, numero, montant_ttc, statut')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!created) {
    return NextResponse.json({ ok: false, error: 'Échec création facture.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    created: true,
    facture: {
      id: created.id as string,
      numero: created.numero as string,
      total_ttc: Number(created.montant_ttc ?? ttc),
      statut: created.statut as string,
    },
  });
}
