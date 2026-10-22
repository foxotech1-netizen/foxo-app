'use client';

// Écran « Odoo » de la comptabilité : miroir en LECTURE SEULE des factures et
// des mouvements bancaires d'Odoo (tables odoo_factures et
// odoo_mouvements_bancaires). Rien n'est modifiable ici : les seules actions
// sont le lancement d'une synchronisation et le réglage du passage nocturne.

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, FolderPlus, Info, Lock, RefreshCw } from 'lucide-react';
import { CLASSES_TON, etatFacture, type GroupeEtat, type TonEtat } from '@/lib/facturation/odoo-libelles';
import { TZ_BRUSSELS } from '@/lib/format';
import { lancerSynchronisationOdoo, reglerPassageNocturne } from './actions';
import { ReconstructionPanel } from './ReconstructionPanel';

export interface ReglementOdoo {
  date: string | null;
  montant: number | null;
  journal: string | null;
  odoo_move_id: number | null;
}

export interface FactureOdoo {
  id: string;
  odoo_id: number;
  sens: 'vente' | 'achat';
  est_note_credit: boolean;
  numero: string | null;
  reference: string | null;
  tiers_nom: string | null;
  date_facture: string | null;
  date_echeance: string | null;
  montant_ttc: number | null;
  etat_paiement: string;
  reglements: ReglementOdoo[] | null;
  date_dernier_reglement: string | null;
  dossier_ref: string | null;
  intervention_id: string | null;
}

export interface MouvementOdoo {
  id: string;
  odoo_id: number;
  odoo_move_id: number | null;
  date_mouvement: string;
  montant: number;
  tiers_nom: string | null;
  communication: string | null;
  rapproche: boolean | null;
}

export interface PassageOdoo {
  demarree_le: string;
  terminee_le: string | null;
  statut: 'en_cours' | 'ok' | 'erreur';
  erreur: string | null;
}

type Vue = 'ventes' | 'achats' | 'recus' | 'envoyes';
type Filtre = 'tous' | GroupeEtat | 'rapproche' | 'non_rapproche';
/** Colonnes triables des listes de factures. */
type CleTri = 'numero' | 'dossier' | 'tiers' | 'date';
type Tri = { cle: CleTri; sens: 'asc' | 'desc' };

const ORDRE_GROUPES: GroupeEtat[] = ['payee', 'a_regler', 'partielle', 'autre'];
// Espace insécable, sans séquence d'échappement dans le source (certains outils
// d'écriture la convertissent en caractère brut).
const INSECABLE = String.fromCharCode(160);

// ─── Mise en forme ──────────────────────────────────────────────────────────

// Date calendaire AAAA-MM-JJ → JJ/MM/AAAA, sans passer par un fuseau.
function fmtJour(d: string | null): string {
  return d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
}

function fmtMontant(n: number | null): string {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtMontantSigne(n: number): string {
  return (n < 0 ? '− ' : '+ ') + fmtMontant(Math.abs(n));
}

function fmtMoment(iso: string | null): string {
  if (!iso) return 'jamais';
  return new Date(iso).toLocaleString('fr-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: TZ_BRUSSELS,
  });
}

// La référence Odoo d'une vente commence par le numéro de dossier : on ne
// répète pas ce numéro, déjà affiché en lien.
function adresseDe(f: FactureOdoo): string | null {
  const reference = (f.reference ?? '').trim();
  if (!reference) return null;
  if (f.dossier_ref && reference.startsWith(f.dossier_ref)) {
    return reference.slice(f.dossier_ref.length).trim() || null;
  }
  return reference;
}

// « 196 payées · 28 à encaisser · 1 extournée · 1 note de crédit » — espace
// insécable entre le nombre et son libellé, pour ne pas les séparer à la ligne.
function resumeFactures(liste: FactureOdoo[]): string {
  const parLabel = new Map<string, { n: number; un: string; plusieurs: string; groupe: GroupeEtat }>();
  let notesCredit = 0;
  for (const f of liste) {
    if (f.est_note_credit) { notesCredit += 1; continue; }
    const info = etatFacture(f.etat_paiement, f.sens);
    const ligne = parLabel.get(info.label) ?? { n: 0, un: info.un, plusieurs: info.plusieurs, groupe: info.groupe };
    ligne.n += 1;
    parLabel.set(info.label, ligne);
  }
  const morceaux = [...parLabel.values()]
    .sort((a, b) => ORDRE_GROUPES.indexOf(a.groupe) - ORDRE_GROUPES.indexOf(b.groupe))
    .map((l) => `${l.n}${INSECABLE}${l.n > 1 ? l.plusieurs : l.un}`);
  if (notesCredit > 0) morceaux.push(`${notesCredit}${INSECABLE}note${notesCredit > 1 ? 's' : ''} de crédit`);
  return morceaux.length > 0 ? morceaux.join(' · ') : 'Aucune pièce';
}

function Pastille({ ton, children }: { ton: TonEtat; children: React.ReactNode }) {
  return (
    <span className={'fx-badge inline-block px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ' + CLASSES_TON[ton]}>
      {children}
    </span>
  );
}

// ─── Tri des listes de factures ─────────────────────────────────────────────
// Numéros et dossiers comparés « à la numérique » (FV2026-9 avant FV2026-10),
// accents ignorés ; les valeurs vides vont en fin de liste quel que soit le sens.
const collation = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

function valeurTri(f: FactureOdoo, cle: CleTri): string | null {
  switch (cle) {
    case 'numero': return f.numero;
    case 'dossier': return f.sens === 'vente' ? (f.dossier_ref ?? adresseDe(f)) : f.reference;
    case 'tiers': return f.tiers_nom;
    case 'date': return f.date_facture;
  }
}

function trierFactures(liste: FactureOdoo[], tri: Tri): FactureOdoo[] {
  const signe = tri.sens === 'asc' ? 1 : -1;
  return [...liste].sort((a, b) => {
    const va = valeurTri(a, tri.cle);
    const vb = valeurTri(b, tri.cle);
    if (va === vb) return 0;
    if (!va) return 1;
    if (!vb) return -1;
    return signe * collation.compare(va, vb);
  });
}

function EnTeteTriable({ cle, tri, onTri, children }: {
  cle: CleTri; tri: Tri; onTri: (cle: CleTri) => void; children: React.ReactNode;
}) {
  const actif = tri.cle === cle;
  const Icone = !actif ? ArrowUpDown : tri.sens === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={actif ? (tri.sens === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-1 py-0.5 font-semibold">
      <button
        type="button"
        onClick={() => onTri(cle)}
        className={'inline-flex items-center gap-1 px-2 min-h-[36px] rounded-lg uppercase tracking-wide whitespace-nowrap hover:bg-sand-hover ' + (actif ? 'text-navy' : '')}
      >
        {children}
        <Icone size={13} aria-hidden className={actif ? undefined : 'opacity-50'} />
      </button>
    </th>
  );
}

// ─── Écran ──────────────────────────────────────────────────────────────────

export function OdooClient({
  factures, mouvements, dernierPassage, dernierPassageReussi, nocturneActive, depuis, odooUrl, erreurChargement,
}: {
  factures: FactureOdoo[];
  mouvements: MouvementOdoo[];
  dernierPassage: PassageOdoo | null;
  dernierPassageReussi: PassageOdoo | null;
  nocturneActive: boolean;
  depuis: string | null;
  odooUrl: string | null;
  erreurChargement: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vue, setVue] = useState<Vue>('ventes');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [tri, setTri] = useState<Tri>({ cle: 'date', sens: 'desc' });
  const [recherche, setRecherche] = useState('');
  const [retour, setRetour] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  // Panneau « Reconstruire les dossiers depuis Odoo » (tuile Ventes).
  const [reconstruction, setReconstruction] = useState(false);

  const ventes = useMemo(() => factures.filter((f) => f.sens === 'vente'), [factures]);
  const achats = useMemo(() => factures.filter((f) => f.sens === 'achat'), [factures]);
  const recus = useMemo(() => mouvements.filter((m) => m.montant > 0), [mouvements]);
  const envoyes = useMemo(() => mouvements.filter((m) => m.montant < 0), [mouvements]);
  const nonRapproches = useMemo(() => mouvements.filter((m) => m.rapproche === false).length, [mouvements]);

  // Mouvement bancaire → numéros des factures qu'il règle (lien par l'écriture Odoo).
  const facturesParMouvement = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const f of factures) {
      for (const r of f.reglements ?? []) {
        if (r.odoo_move_id == null) continue;
        const liste = map.get(r.odoo_move_id) ?? [];
        liste.push(f.numero ?? `pièce ${f.odoo_id}`);
        map.set(r.odoo_move_id, liste);
      }
    }
    return map;
  }, [factures]);

  const estFactures = vue === 'ventes' || vue === 'achats';
  const listeFactures = vue === 'ventes' ? ventes : achats;
  const listeMouvements = vue === 'recus' ? recus : envoyes;
  const q = recherche.trim().toLowerCase();

  const facturesAffichees = useMemo(() => {
    if (!estFactures) return [];
    const filtrees = listeFactures.filter((f) => {
      if (filtre !== 'tous' && etatFacture(f.etat_paiement, f.sens).groupe !== filtre) return false;
      if (!q) return true;
      return [f.numero, f.reference, f.tiers_nom, f.dossier_ref, fmtMontant(f.montant_ttc), fmtJour(f.date_facture)]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
    return trierFactures(filtrees, tri);
  }, [estFactures, listeFactures, filtre, q, tri]);

  const mouvementsAffiches = useMemo(() => {
    if (estFactures) return [];
    return listeMouvements.filter((m) => {
      if (filtre === 'rapproche' && m.rapproche !== true) return false;
      if (filtre === 'non_rapproche' && m.rapproche !== false) return false;
      if (!q) return true;
      const liees = m.odoo_move_id != null ? facturesParMouvement.get(m.odoo_move_id) ?? [] : [];
      return [m.tiers_nom, m.communication, fmtMontant(Math.abs(m.montant)), fmtJour(m.date_mouvement), ...liees]
        .some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [estFactures, listeMouvements, filtre, q, facturesParMouvement]);

  const filtres = useMemo((): { cle: Filtre; label: string }[] => {
    if (estFactures) {
      const compte = (groupe: GroupeEtat) =>
        listeFactures.filter((f) => etatFacture(f.etat_paiement, f.sens).groupe === groupe).length;
      const partielles = compte('partielle');
      return [
        { cle: 'tous', label: `Toutes · ${listeFactures.length}` },
        { cle: 'a_regler', label: `${vue === 'ventes' ? 'À encaisser' : 'À payer'} · ${compte('a_regler')}` },
        ...(partielles > 0 ? [{ cle: 'partielle' as Filtre, label: `Partielles · ${partielles}` }] : []),
        { cle: 'payee', label: `Payées · ${compte('payee')}` },
      ];
    }
    return [
      { cle: 'tous', label: `Tous · ${listeMouvements.length}` },
      { cle: 'rapproche', label: `Rapprochés · ${listeMouvements.filter((m) => m.rapproche === true).length}` },
      { cle: 'non_rapproche', label: `Non rapprochés · ${listeMouvements.filter((m) => m.rapproche === false).length}` },
    ];
  }, [estFactures, listeFactures, listeMouvements, vue]);

  const tuiles: { cle: Vue; label: string; nombre: number; detail: string }[] = [
    { cle: 'ventes', label: 'Ventes', nombre: ventes.filter((f) => !f.est_note_credit).length, detail: resumeFactures(ventes) },
    { cle: 'achats', label: 'Achats', nombre: achats.filter((f) => !f.est_note_credit).length, detail: resumeFactures(achats) },
    { cle: 'recus', label: 'Paiements reçus', nombre: recus.length, detail: 'Entrées sur le compte bancaire' },
    { cle: 'envoyes', label: 'Paiements envoyés', nombre: envoyes.length, detail: 'Sorties du compte bancaire' },
  ];

  function choisirVue(v: Vue) {
    setVue(v);
    setFiltre('tous');
  }

  // Même colonne : on inverse le sens. Nouvelle colonne : croissant, sauf la
  // date (plus récentes d'abord).
  function choisirTri(cle: CleTri) {
    setTri((t) => (t.cle === cle
      ? { cle, sens: t.sens === 'asc' ? 'desc' : 'asc' }
      : { cle, sens: cle === 'date' ? 'desc' : 'asc' }));
  }

  function synchroniser() {
    setRetour(null);
    startTransition(async () => {
      const res = await lancerSynchronisationOdoo();
      if (!res.ok) {
        setRetour({ kind: 'err', msg: res.erreur });
      } else {
        const suite = res.avertissements.length > 0 ? ' ' + res.avertissements.join(' ') : '';
        setRetour({
          kind: 'ok',
          msg: `Synchronisation terminée : ${res.factures} factures et ${res.mouvements} mouvements bancaires.${suite}`,
        });
      }
      router.refresh();
    });
  }

  function basculerNocturne() {
    setRetour(null);
    startTransition(async () => {
      const res = await reglerPassageNocturne(!nocturneActive);
      if (!res.ok) setRetour({ kind: 'err', msg: res.erreur });
      router.refresh();
    });
  }

  const vide = factures.length === 0 && mouvements.length === 0;
  const nbAffiches = estFactures ? facturesAffichees.length : mouvementsAffiches.length;
  const nbTotal = estFactures ? listeFactures.length : listeMouvements.length;

  return (
    <div className="space-y-4">
      {/* En-tête : titre, dernière synchronisation, bouton */}
      <div className="flex flex-wrap items-center justify-between gap-3.5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="fxs-title-sm text-ink">Données Odoo</h2>
            <span className="fx-pill inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-navy-pale border border-navy-light text-navy font-semibold">
              <Lock size={12} aria-hidden /> Lecture seule
            </span>
          </div>
          <div className="fx-body text-ink-mid">
            Pièces comptabilisées dans Odoo{depuis ? ` depuis le ${fmtJour(depuis)}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="fx-meta text-ink-mid text-right">
            Dernière synchronisation :{' '}
            <strong className="text-ink font-semibold">
              {fmtMoment(dernierPassageReussi?.terminee_le ?? null)}
            </strong>
            <br />
            Automatique chaque nuit : {nocturneActive ? 'activée' : 'désactivée'}{' '}
            <button
              type="button"
              onClick={basculerNocturne}
              disabled={pending}
              className="text-navy font-semibold underline hover:no-underline disabled:opacity-50"
            >
              {nocturneActive ? 'Désactiver' : 'Activer'}
            </button>
          </div>
          <button
            type="button"
            onClick={synchroniser}
            disabled={pending}
            className="fx-body bg-navy text-cream px-4 rounded-lg font-semibold hover:opacity-90 inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50"
          >
            <RefreshCw size={15} aria-hidden className={pending ? 'animate-spin' : undefined} />
            {pending ? 'Synchronisation en cours…' : 'Synchroniser maintenant'}
          </button>
        </div>
      </div>

      {erreurChargement && (
        <div className="fx-body text-terra-ink bg-terra-light border border-terra-mid rounded-lg px-3 py-2 font-semibold">
          Erreur de chargement : {erreurChargement}
        </div>
      )}
      {retour && (
        <div
          role="status"
          className={'fx-body rounded-lg px-3 py-2 border font-semibold ' +
            (retour.kind === 'ok' ? 'bg-ok-light border-ok-mid text-ok' : 'bg-terra-light border-terra-mid text-terra-ink')
          }
        >
          {retour.msg}
        </div>
      )}
      {!retour && dernierPassage?.statut === 'erreur' && (
        <div className="fx-body text-terra-ink bg-terra-light border border-terra-mid rounded-lg px-3 py-2 font-semibold">
          Le dernier passage ({fmtMoment(dernierPassage.demarree_le)}) a échoué : {dernierPassage.erreur ?? 'erreur inconnue'}.
          Les données affichées sont celles du dernier passage réussi.
        </div>
      )}

      {vide ? (
        <div className="fx-body text-center py-14 text-ink-mid bg-cream rounded-xl border border-sand-border">
          Aucune donnée Odoo pour l&apos;instant. Cliquez sur « Synchroniser maintenant » pour une première recopie.
        </div>
      ) : (
        <>
          {/* Tuiles : une par liste */}
          <div className="flex flex-wrap gap-3">
            {tuiles.map((t) => (
              <div key={t.cle} className="flex-1 basis-[220px] min-w-0 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => choisirVue(t.cle)}
                  aria-pressed={vue === t.cle}
                  className={'w-full flex-1 text-left bg-cream rounded-xl border-2 px-4 py-3.5 shadow-card flex flex-col gap-1.5 ' +
                    (vue === t.cle ? 'border-navy' : 'border-transparent hover:border-navy-light')
                  }
                >
                  <span className="fxs-block-title text-ink">{t.label}</span>
                  <span className="fx-kpi font-semibold leading-none tracking-tight tabular-nums text-ink">
                    {t.nombre}
                  </span>
                  <span className="fx-meta text-ink-mid">{t.detail}</span>
                </button>
                {t.cle === 'ventes' && (
                  <button
                    type="button"
                    onClick={() => setReconstruction((o) => !o)}
                    aria-expanded={reconstruction}
                    className="fx-label self-start inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-sand-border bg-cream text-navy font-semibold hover:border-navy-mid"
                    data-testid="odoo-reconstruction-ouvrir"
                  >
                    <FolderPlus size={14} aria-hidden /> Reconstruire les dossiers depuis Odoo
                  </button>
                )}
              </div>
            ))}
          </div>

          {reconstruction && (
            <ReconstructionPanel onFerme={() => setReconstruction(false)} onTermine={() => router.refresh()} />
          )}

          {nonRapproches > 0 && (
            <div role="note" className="fx-body flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-amber-light border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-deep)]">
              <Info size={17} aria-hidden className="flex-none mt-px" />
              <div>
                <strong className="font-semibold">
                  {nonRapproches} mouvement{nonRapproches > 1 ? 's' : ''} bancaire{nonRapproches > 1 ? 's' : ''} sur {mouvements.length}{' '}
                  {nonRapproches > 1 ? 'ne sont pas encore rapprochés' : "n'est pas encore rapproché"} dans Odoo.
                </strong>{' '}
                Tant qu&apos;ils ne le sont pas, les factures concernées restent « à encaisser » ou « à payer », dans Odoo comme ici.
              </div>
            </div>
          )}

          <div className="bg-cream rounded-xl border border-sand-border p-4 space-y-3">
            {/* Filtres + recherche */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap gap-1.5">
                {filtres.map((f) => (
                  <button
                    key={f.cle}
                    type="button"
                    onClick={() => setFiltre(f.cle)}
                    aria-pressed={filtre === f.cle}
                    className={'fx-pill min-h-[36px] px-3.5 rounded-full border font-semibold ' +
                      (filtre === f.cle
                        ? 'bg-navy text-cream border-navy'
                        : 'bg-cream text-ink border-sand-border hover:border-navy-light')
                    }
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
                <label htmlFor="odoo-recherche" className="fx-label font-semibold text-ink-mid">Rechercher</label>
                <input
                  id="odoo-recherche"
                  type="search"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder="N°, dossier, adresse, montant"
                  className="fx-body w-[250px] max-w-full min-w-0 min-h-[36px] px-3 border border-sand-border rounded-lg bg-cream outline-none focus:border-navy-mid"
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-sand-border rounded-lg">
              {estFactures ? (
                <table className="w-full text-left min-w-[1040px]">
                  <thead>
                    <tr className="fx-th bg-sand-mid text-ink-mid">
                      <EnTeteTriable cle="numero" tri={tri} onTri={choisirTri}>N° Odoo</EnTeteTriable>
                      <EnTeteTriable cle="dossier" tri={tri} onTri={choisirTri}>{vue === 'ventes' ? 'Dossier' : 'Réf. fournisseur'}</EnTeteTriable>
                      <EnTeteTriable cle="tiers" tri={tri} onTri={choisirTri}>{vue === 'ventes' ? 'Client' : 'Fournisseur'}</EnTeteTriable>
                      <EnTeteTriable cle="date" tri={tri} onTri={choisirTri}>Date</EnTeteTriable>
                      <th className="px-3 py-2.5 font-semibold">Échéance</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Montant TTC</th>
                      <th className="px-3 py-2.5 font-semibold">État</th>
                      <th className="px-3 py-2.5 font-semibold">Payée le</th>
                      <th className="px-3 py-2.5 font-semibold">Odoo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturesAffichees.map((f) => {
                      const info = etatFacture(f.etat_paiement, f.sens);
                      const adresse = adresseDe(f);
                      return (
                        <tr key={f.id} className="fx-body border-t border-sand-border hover:bg-sand-hover">
                          <td className="px-3 py-2.5 font-semibold text-ink whitespace-nowrap">
                            {f.numero ?? '—'}
                            {f.est_note_credit && (
                              <span className="ml-1.5 align-middle"><Pastille ton="neutre">Note de crédit</Pastille></span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {vue === 'ventes' ? (
                              <>
                                {f.dossier_ref && f.intervention_id && (
                                  <Link href={`/admin/interventions/${f.intervention_id}`} className="font-semibold text-navy hover:underline">
                                    {f.dossier_ref}
                                  </Link>
                                )}
                                {f.dossier_ref && !f.intervention_id && (
                                  <span className="font-semibold text-ink-mid" title="Ce dossier n'existe pas dans FoxO">{f.dossier_ref}</span>
                                )}
                                {adresse && <span className="text-ink-mid">{f.dossier_ref ? ' ' : ''}{adresse}</span>}
                                {!f.dossier_ref && !adresse && '—'}
                              </>
                            ) : (
                              f.reference ?? '—'
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-ink-mid">{f.tiers_nom ?? '—'}</td>
                          <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{fmtJour(f.date_facture)}</td>
                          <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{fmtJour(f.date_echeance)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">{fmtMontant(f.montant_ttc)}</td>
                          <td className="px-3 py-2.5"><Pastille ton={info.ton}>{info.label}</Pastille></td>
                          <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{fmtJour(f.date_dernier_reglement)}</td>
                          <td className="px-1 py-1">
                            {odooUrl && (
                              <a
                                href={`${odooUrl}/web#id=${f.odoo_id}&model=account.move&view_type=form`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Ouvrir ${f.numero ?? 'la pièce'} dans Odoo`}
                                className="inline-flex items-center justify-center w-11 h-11 text-ink-mid hover:text-navy"
                              >
                                <ExternalLink size={15} aria-hidden />
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-left min-w-[980px]">
                  <thead>
                    <tr className="fx-th bg-sand-mid text-ink-mid">
                      <th className="px-3 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Montant</th>
                      <th className="px-3 py-2.5 font-semibold">{vue === 'recus' ? 'Payeur' : 'Bénéficiaire'}</th>
                      <th className="px-3 py-2.5 font-semibold">Communication</th>
                      <th className="px-3 py-2.5 font-semibold">Facture liée</th>
                      <th className="px-3 py-2.5 font-semibold">État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mouvementsAffiches.map((m) => {
                      const liees = m.odoo_move_id != null ? facturesParMouvement.get(m.odoo_move_id) ?? [] : [];
                      return (
                        <tr key={m.id} className="fx-body border-t border-sand-border hover:bg-sand-hover">
                          <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{fmtJour(m.date_mouvement)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">{fmtMontantSigne(m.montant)}</td>
                          <td className="px-3 py-2.5 text-ink-mid">{m.tiers_nom ?? '—'}</td>
                          <td className="px-3 py-2.5 text-ink-mid">{m.communication ?? '—'}</td>
                          <td className="px-3 py-2.5 font-semibold">{liees.length > 0 ? liees.join(', ') : '—'}</td>
                          <td className="px-3 py-2.5">
                            {m.rapproche === true && <Pastille ton="ok">Rapproché</Pastille>}
                            {m.rapproche === false && <Pastille ton="partiel">Non rapproché</Pastille>}
                            {m.rapproche === null && '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {nbAffiches === 0 && (
                <div className="fx-body px-4 py-7 border-t border-sand-border text-center text-ink-mid">
                  Aucune ligne ne correspond à ce filtre ou à cette recherche.
                </div>
              )}
            </div>

            <div className="fx-meta flex flex-wrap justify-between gap-2 text-ink-mid">
              <div>{nbAffiches} ligne{nbAffiches > 1 ? 's' : ''} affichée{nbAffiches > 1 ? 's' : ''} sur {nbTotal}.</div>
              <div>Pour corriger une pièce, ouvrez-la dans Odoo : rien n&apos;est modifiable ici.</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
