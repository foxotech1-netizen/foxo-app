// Tableau de bord Facturation — server component, requêtes en parallèle.
// Année civile en cours par défaut (sélecteur simple ?annee=YYYY).
// Recharts absent du projet → cartes + tableaux uniquement (aucune
// dépendance nouvelle).

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Facture, FactureAchat, NoteFrais } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

const MOIS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Statuts « émise ou payée » (en_retard est un statut stocké possible).
const STATUTS_EMIS = new Set(['envoyee', 'en_retard', 'payee']);

export default async function DashboardFacturationPage({
  searchParams,
}: {
  searchParams: Promise<{ annee?: string }>;
}) {
  const { annee: anneeRaw } = await searchParams;
  const currentYear = new Date().getFullYear();
  const annee = /^\d{4}$/.test(anneeRaw ?? '') ? Number(anneeRaw) : currentYear;
  const from = `${annee}-01-01`;
  const to = `${annee}-12-31`;
  const today = new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const [facturesRes, avoirsRes, achatsRes, fraisRes] = await Promise.all([
    // Factures de vente émises dans l'année (tous statuts, filtrés en JS).
    supabase
      .from('factures')
      .select('id, numero, statut, type, montant_ht, montant_ttc, date_emission, date_echeance, date_paiement, intervention_id')
      .eq('type', 'facture')
      .is('deleted_at', null)
      .gte('date_emission', from)
      .lte('date_emission', to),
    // Avoirs émis (rentabilité) — montants stockés en négatif.
    supabase
      .from('factures')
      .select('id, statut, montant_ht, intervention_id')
      .eq('type', 'avoir')
      .is('deleted_at', null)
      .neq('statut', 'annulee')
      .neq('statut', 'brouillon'),
    // Achats (stock « à payer » + coûts liés aux dossiers).
    supabase
      .from('factures_achat')
      .select('id, statut, montant_ht, montant_ttc, intervention_id')
      .is('deleted_at', null),
    // Frais (stock « soumises » + coûts liés aux dossiers).
    supabase
      .from('notes_frais')
      .select('id, statut, montant_htva, montant_ttc, intervention_id')
      .is('deleted_at', null),
  ]);

  const factures = (facturesRes.data ?? []) as Pick<Facture, 'id' | 'numero' | 'statut' | 'type' | 'montant_ht' | 'montant_ttc' | 'date_emission' | 'date_echeance' | 'date_paiement' | 'intervention_id'>[];
  const avoirs = (avoirsRes.data ?? []) as Pick<Facture, 'id' | 'statut' | 'montant_ht' | 'intervention_id'>[];
  const achats = (achatsRes.data ?? []) as Pick<FactureAchat, 'id' | 'statut' | 'montant_ht' | 'montant_ttc' | 'intervention_id'>[];
  const frais = (fraisRes.data ?? []) as Pick<NoteFrais, 'id' | 'statut' | 'montant_htva' | 'montant_ttc' | 'intervention_id'>[];

  // ── Cartes ────────────────────────────────────────────────────────────
  const emises = factures.filter((f) => STATUTS_EMIS.has(f.statut));
  const factureTtc = emises.reduce((s, f) => s + num(f.montant_ttc), 0);

  const payees = emises.filter((f) => f.statut === 'payee');
  const encaisse = payees.reduce((s, f) => s + num(f.montant_ttc), 0);

  const enRetard = emises.filter(
    (f) => f.statut !== 'payee' && f.date_echeance != null && f.date_echeance < today,
  );
  const enRetardMontant = enRetard.reduce((s, f) => s + num(f.montant_ttc), 0);

  // DSO : moyenne des délais émission → paiement, pondérée par le TTC.
  let dso: number | null = null;
  {
    let sommeJoursXTtc = 0;
    let sommeTtc = 0;
    for (const f of payees) {
      if (!f.date_emission || !f.date_paiement) continue;
      const jours = Math.max(0, Math.round(
        (new Date(f.date_paiement).getTime() - new Date(f.date_emission).getTime()) / 86_400_000,
      ));
      const ttc = Math.abs(num(f.montant_ttc));
      sommeJoursXTtc += jours * ttc;
      sommeTtc += ttc;
    }
    if (sommeTtc > 0) dso = Math.round(sommeJoursXTtc / sommeTtc);
  }

  const achatsAPayer = achats.filter((a) => a.statut === 'a_payer');
  const achatsAPayerTtc = achatsAPayer.reduce((s, a) => s + num(a.montant_ttc), 0);

  const fraisEnAttente = frais.filter((n) => n.statut === 'soumise');
  const fraisEnAttenteTtc = fraisEnAttente.reduce((s, n) => s + num(n.montant_ttc), 0);

  // ── Facturé / encaissé par mois (tableau — pas de Recharts) ──────────
  const parMois = Array.from({ length: 12 }, (_, i) => ({ mois: MOIS_FR[i], facture: 0, encaisse: 0 }));
  for (const f of emises) {
    if (f.date_emission?.startsWith(String(annee))) {
      const m = Number(f.date_emission.slice(5, 7)) - 1;
      if (m >= 0 && m < 12) parMois[m].facture += num(f.montant_ttc);
    }
  }
  for (const f of payees) {
    if (f.date_paiement?.startsWith(String(annee))) {
      const m = Number(f.date_paiement.slice(5, 7)) - 1;
      if (m >= 0 && m < 12) parMois[m].encaisse += num(f.montant_ttc);
    }
  }
  const maxMois = Math.max(1, ...parMois.map((m) => Math.max(m.facture, m.encaisse)));

  // ── Rentabilité par dossier (hors coût main-d'œuvre) ─────────────────
  // Dossiers ayant ≥1 facture émise/payée cette année ; CA et coûts calculés
  // sur l'ENSEMBLE des pièces liées au dossier (vision dossier complet).
  const dossierIds = [...new Set(emises.map((f) => f.intervention_id).filter((x): x is string => Boolean(x)))];
  type LigneRenta = { interventionId: string; ref: string; ca: number; couts: number; marge: number; margePct: number | null };
  let renta: LigneRenta[] = [];
  if (dossierIds.length > 0) {
    const { data: ivRows } = await supabase
      .from('interventions')
      .select('id, ref')
      .in('id', dossierIds);
    const refById = new Map(((ivRows ?? []) as { id: string; ref: string | null }[]).map((r) => [r.id, r.ref ?? r.id.slice(0, 8)]));

    // CA HTVA du dossier : toutes les factures émises/payées liées (l'année
    // sélectionne le dossier, pas ses pièces) + avoirs (négatifs en base).
    const { data: allFacturesDossiers } = await supabase
      .from('factures')
      .select('intervention_id, type, statut, montant_ht')
      .eq('type', 'facture')
      .is('deleted_at', null)
      .in('intervention_id', dossierIds);
    const caById = new Map<string, number>();
    for (const f of ((allFacturesDossiers ?? []) as Pick<Facture, 'intervention_id' | 'statut' | 'montant_ht'>[])) {
      if (!f.intervention_id || !STATUTS_EMIS.has(f.statut)) continue;
      caById.set(f.intervention_id, (caById.get(f.intervention_id) ?? 0) + num(f.montant_ht));
    }
    for (const a of avoirs) {
      if (!a.intervention_id || !caById.has(a.intervention_id)) continue;
      // montant_ht d'un avoir est négatif → s'ajoute en déduction.
      caById.set(a.intervention_id, (caById.get(a.intervention_id) ?? 0) + num(a.montant_ht));
    }

    const coutsById = new Map<string, number>();
    for (const a of achats) {
      if (!a.intervention_id || !dossierIds.includes(a.intervention_id)) continue;
      if (a.statut !== 'a_payer' && a.statut !== 'payee') continue;
      coutsById.set(a.intervention_id, (coutsById.get(a.intervention_id) ?? 0) + num(a.montant_ht ?? a.montant_ttc));
    }
    for (const n of frais) {
      if (!n.intervention_id || !dossierIds.includes(n.intervention_id)) continue;
      if (n.statut !== 'approuvee' && n.statut !== 'remboursee') continue;
      coutsById.set(n.intervention_id, (coutsById.get(n.intervention_id) ?? 0) + num(n.montant_htva));
    }

    renta = dossierIds.map((id) => {
      const ca = caById.get(id) ?? 0;
      const couts = coutsById.get(id) ?? 0;
      const marge = ca - couts;
      return {
        interventionId: id,
        ref: refById.get(id) ?? id.slice(0, 8),
        ca,
        couts,
        marge,
        margePct: ca > 0 ? Math.round((marge / ca) * 100) : null,
      };
    }).sort((a, b) => b.marge - a.marge);
  }
  const top = renta.slice(0, 15);
  const flop = renta.length > 15 ? renta.slice(-5) : [];

  const years = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">Tableau de bord</h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            Année {annee} — indicateurs financiers du module facturation
          </div>
        </div>
        <div className="flex gap-1.5">
          {years.map((y) => (
            <Link
              key={y}
              href={`/admin/facturation/dashboard?annee=${y}`}
              className={
                'px-3 py-1.5 rounded-full text-[11px] font-bold border ' +
                (y === annee
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid')
              }
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      {/* Cartes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatCard label={`Facturé TTC ${annee}`} value={fmtMoney(factureTtc)} sub={`${emises.length} facture(s) émise(s)`} />
        <StatCard label="Encaissé" value={fmtMoney(encaisse)} sub={`${payees.length} payée(s)`} tone="ok" />
        <StatCard label="En retard" value={fmtMoney(enRetardMontant)} sub={`${enRetard.length} facture(s)`} tone={enRetard.length > 0 ? 'warn' : undefined} />
        <StatCard label="DSO (pondéré TTC)" value={dso != null ? `${dso} j` : '—'} sub="émission → paiement" />
        <StatCard label="Achats à payer" value={fmtMoney(achatsAPayerTtc)} sub={`${achatsAPayer.length} facture(s)`} />
        <StatCard label="Frais en attente" value={fmtMoney(fraisEnAttenteTtc)} sub={`${fraisEnAttente.length} soumise(s)`} />
      </div>

      {/* Facturé / encaissé par mois */}
      <section className="bg-cream rounded-xl border border-sand-border p-4 mb-6">
        <h2 className="text-[13px] font-bold text-ink mb-3">Facturé / encaissé par mois ({annee})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[720px]">
            <thead>
              <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="px-2.5 py-2 font-bold">Mois</th>
                <th className="px-2.5 py-2 font-bold text-right">Facturé TTC</th>
                <th className="px-2.5 py-2 font-bold text-right">Encaissé</th>
                <th className="px-2.5 py-2 font-bold w-[40%]">Répartition</th>
              </tr>
            </thead>
            <tbody>
              {parMois.map((m) => (
                <tr key={m.mois} className="border-b border-sand-mid">
                  <td className="px-2.5 py-1.5 text-[12px] font-semibold">{m.mois}</td>
                  <td className="px-2.5 py-1.5 text-[12px] font-mono text-right whitespace-nowrap">{m.facture > 0 ? fmtMoney(m.facture) : '—'}</td>
                  <td className="px-2.5 py-1.5 text-[12px] font-mono text-right whitespace-nowrap text-ok">{m.encaisse > 0 ? fmtMoney(m.encaisse) : '—'}</td>
                  <td className="px-2.5 py-1.5">
                    <div className="space-y-0.5">
                      <div className="h-1.5 rounded bg-navy" style={{ width: `${Math.round((m.facture / maxMois) * 100)}%`, minWidth: m.facture > 0 ? 2 : 0 }} />
                      <div className="h-1.5 rounded bg-[var(--color-ok)]" style={{ width: `${Math.round((m.encaisse / maxMois) * 100)}%`, minWidth: m.encaisse > 0 ? 2 : 0 }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-ink-muted mt-2">Barre marine = facturé (date d&apos;émission) · barre verte = encaissé (date de paiement).</p>
      </section>

      {/* Rentabilité par dossier */}
      <section className="bg-cream rounded-xl border border-sand-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-[13px] font-bold text-ink">Rentabilité par dossier</h2>
          <span className="text-[10px] text-ink-muted font-semibold uppercase tracking-wider">
            Hors coût main-d&apos;œuvre
          </span>
        </div>
        <p className="text-[11px] text-ink-mid mb-3">
          Dossiers avec ≥ 1 facture émise/payée en {annee}. CA HTVA (factures − avoirs)
          − achats HT liés − frais HTVA approuvées/remboursées liées = marge (vision dossier complet).
        </p>
        {renta.length === 0 ? (
          <p className="text-[12px] text-ink-muted italic py-4 text-center">
            Aucun dossier facturé en {annee}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <RentaTable lignes={top} titre={`Top ${top.length}`} />
            {flop.length > 0 && (
              <div className="mt-4">
                <RentaTable lignes={flop} titre="Flop 5 (marges les plus faibles)" />
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function StatCard({
  label, value, sub, tone,
}: {
  label: string; value: string; sub: string; tone?: 'ok' | 'warn';
}) {
  return (
    <div className="bg-cream rounded-xl border border-sand-border p-3.5">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1">{label}</div>
      <div className={
        'font-mono text-[18px] font-extrabold tracking-tight ' +
        (tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-terra' : 'text-navy dark:text-white')
      }>
        {value}
      </div>
      <div className="text-[10px] text-ink-mid mt-0.5">{sub}</div>
    </div>
  );
}

function RentaTable({
  lignes, titre,
}: {
  lignes: { interventionId: string; ref: string; ca: number; couts: number; marge: number; margePct: number | null }[];
  titre: string;
}) {
  return (
    <>
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1.5">{titre}</div>
      <table className="w-full text-left min-w-[680px]">
        <thead>
          <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted">
            <th className="px-2.5 py-2 font-bold">Dossier</th>
            <th className="px-2.5 py-2 font-bold text-right">CA HTVA</th>
            <th className="px-2.5 py-2 font-bold text-right">Coûts</th>
            <th className="px-2.5 py-2 font-bold text-right">Marge</th>
            <th className="px-2.5 py-2 font-bold text-right">Marge %</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.interventionId} className="border-b border-sand-mid hover:bg-sand-hover">
              <td className="px-2.5 py-1.5">
                <Link href={`/admin/interventions/${l.interventionId}`} className="font-mono text-xs font-bold text-navy hover:underline">
                  {l.ref}
                </Link>
              </td>
              <td className="px-2.5 py-1.5 text-[12px] font-mono text-right whitespace-nowrap">{fmtMoney(l.ca)}</td>
              <td className="px-2.5 py-1.5 text-[12px] font-mono text-right whitespace-nowrap text-ink-mid">{fmtMoney(l.couts)}</td>
              <td className={
                'px-2.5 py-1.5 text-[12px] font-mono font-bold text-right whitespace-nowrap ' +
                (l.marge < 0 ? 'text-terra' : 'text-ok')
              }>
                {fmtMoney(l.marge)}
              </td>
              <td className="px-2.5 py-1.5 text-[12px] font-mono text-right">{l.margePct != null ? `${l.margePct} %` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
