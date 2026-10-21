'use client';

// Formulaire « nouveau brouillon dans Odoo » d'un dossier (bloc « Facture
// Odoo »). Pré-rempli par preparerBrouillonAction (client retrouvé dans
// Odoo, catalogue, référence, note), tout reste modifiable. Le seul envoi
// vers Odoo est le bouton « Créer le brouillon dans Odoo » ; le brouillon
// n'est jamais validé par FoxO — Foxo le vérifie, le valide et l'envoie
// depuis Odoo. Habillage : tokens du thème admin, aucune couleur en dur.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { SkeletonText } from '@/components/ui/Skeleton';
import type {
  ClientOdoo,
  LigneBrouillon,
  NouveauClient,
  PreparationBrouillon,
  ProduitOdoo,
} from '@/lib/facturation/odoo-brouillon';
import {
  chercherClientsAction,
  creerBrouillonAction,
  preparerBrouillonAction,
} from './facturation/odoo/brouillon-actions';

const CHAMP = 'w-full min-h-[40px] px-3 border border-sand-border rounded-lg text-[13px] bg-white text-ink outline-none focus:border-navy-mid disabled:bg-sand disabled:text-ink-mid';
const ETIQUETTE = 'block text-[12px] font-semibold text-ink-mid mb-1';

function fmtMontant(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function arrondi(n: number): number {
  return Math.round(n * 100) / 100;
}

function nombre(v: string | number): number {
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const SOURCE_LABEL: Record<NonNullable<PreparationBrouillon['client']['source']>, string> = {
  miroir: 'Retrouvé : cet immeuble a déjà été facturé dans Odoo',
  bce: 'Retrouvé par numéro BCE',
  email: 'Retrouvé par adresse e-mail',
};

type ModeClient = 'existant' | 'nouveau';

interface Props {
  interventionId: string;
  onFerme: () => void;
  /** Appelé après création réussie, avec l'identifiant Odoo du brouillon. */
  onCree: (odooMoveId: number) => void;
}

export function BrouillonOdooForm({ interventionId, onFerme, onCree }: Props) {
  const [prep, setPrep] = useState<PreparationBrouillon | null>(null);
  const [erreurPrep, setErreurPrep] = useState<string | null>(null);

  // Saisie
  const [modeClient, setModeClient] = useState<ModeClient>('existant');
  const [client, setClient] = useState<ClientOdoo | null>(null);
  const [nouveau, setNouveau] = useState<NouveauClient | null>(null);
  const [reference, setReference] = useState('');
  const [dateFacture, setDateFacture] = useState('');
  const [lignes, setLignes] = useState<LigneBrouillon[]>([]);
  const [note, setNote] = useState('');

  // Recherche de client
  const [rechercheOuverte, setRechercheOuverte] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<ClientOdoo[]>([]);
  const [chercheEnCours, setChercheEnCours] = useState(false);
  const rechercheRef = useRef(0);

  // Envoi
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<{ odoo_move_id: number; odoo_url: string | null; partner_cree: boolean } | null>(null);

  // ── Préparation (lecture d'Odoo) ── Le composant est monté pour UN dossier
  // (le bloc parent le referme quand le dossier change) : l'état initial
  // suffit, rien à remettre à zéro ici.
  useEffect(() => {
    let actif = true;
    preparerBrouillonAction(interventionId).then((res) => {
      if (!actif) return;
      if (!res.ok) { setErreurPrep(res.erreur); return; }
      const p = res.preparation;
      setPrep(p);
      setClient(p.client.propose);
      setNouveau(p.client.nouveau);
      setModeClient(p.client.propose ? 'existant' : 'nouveau');
      setReference(p.saisie.reference);
      setDateFacture(p.saisie.date_facture);
      setLignes(p.saisie.lignes);
      setNote(p.saisie.note ?? '');
    }).catch((e: unknown) => {
      if (actif) setErreurPrep(e instanceof Error ? e.message : 'Lecture d\'Odoo impossible.');
    });
    return () => { actif = false; };
  }, [interventionId]);

  // ── Recherche de client (300 ms après la frappe) ──
  useEffect(() => {
    if (!rechercheOuverte) return;
    const t = recherche.trim();
    if (t.length < 2) return;
    const num = ++rechercheRef.current;
    const timer = setTimeout(async () => {
      setChercheEnCours(true);
      const r = await chercherClientsAction(t);
      if (rechercheRef.current === num) { setResultats(r); setChercheEnCours(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [recherche, rechercheOuverte]);
  // En dessous de deux caractères, rien n'est proposé (résultats précédents masqués).
  const resultatsAffiches = recherche.trim().length >= 2 ? resultats : [];

  const produitsTries = useMemo(() => {
    if (!prep) return { frequents: [] as ProduitOdoo[], autres: [] as ProduitOdoo[] };
    const parId = new Map(prep.catalogue.produits.map((p) => [p.id, p]));
    const frequents = prep.catalogue.frequents.map((id) => parId.get(id)).filter((p): p is ProduitOdoo => Boolean(p));
    const dejaVus = new Set(frequents.map((p) => p.id));
    const autres = prep.catalogue.produits.filter((p) => !dejaVus.has(p.id));
    return { frequents, autres };
  }, [prep]);

  const totaux = useMemo(() => {
    let ht = 0;
    let tva = 0;
    for (const l of lignes) {
      const base = arrondi(nombre(l.quantite) * nombre(l.prix_unitaire));
      ht += base;
      tva += arrondi(base * nombre(l.taux_tva) / 100);
    }
    ht = arrondi(ht);
    tva = arrondi(tva);
    return { ht, tva, ttc: arrondi(ht + tva) };
  }, [lignes]);

  function majLigne(i: number, patch: Partial<LigneBrouillon>) {
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function choisirProduit(i: number, idTexte: string) {
    const id = Number(idTexte);
    const p = prep?.catalogue.produits.find((x) => x.id === id) ?? null;
    if (!p) { majLigne(i, { produit_id: null }); return; }
    majLigne(i, { produit_id: p.id, libelle: p.nom, prix_unitaire: p.prix, taux_tva: p.taux_tva });
  }

  function ajouterLigne() {
    const p = produitsTries.frequents[0] ?? produitsTries.autres[0] ?? null;
    setLignes((ls) => [
      ...ls,
      p
        ? { produit_id: p.id, libelle: p.nom, quantite: 1, prix_unitaire: p.prix, taux_tva: p.taux_tva }
        : { produit_id: null, libelle: '', quantite: 1, prix_unitaire: 0, taux_tva: prep?.catalogue.taux[0] ?? 21 },
    ]);
  }

  function retirerLigne(i: number) {
    setLignes((ls) => ls.filter((_, j) => j !== i));
  }

  function creer() {
    if (!prep) return;
    setErreur(null);
    startTransition(async () => {
      const res = await creerBrouillonAction(interventionId, {
        partner_id: modeClient === 'existant' ? client?.id ?? null : null,
        nouveau_client: modeClient === 'nouveau' ? nouveau : null,
        reference: reference.trim(),
        date_facture: dateFacture,
        lignes: lignes.map((l) => ({
          produit_id: l.produit_id,
          libelle: l.libelle.trim(),
          quantite: nombre(l.quantite),
          prix_unitaire: nombre(l.prix_unitaire),
          taux_tva: nombre(l.taux_tva),
        })),
        note: note.trim() || null,
      });
      if (!res.ok) { setErreur(res.erreur); return; }
      setSucces({ odoo_move_id: res.odoo_move_id, odoo_url: res.odoo_url, partner_cree: res.partner_cree });
      onCree(res.odoo_move_id);
    });
  }

  const peutEnvoyer = Boolean(prep && !prep.blocage && prep.ecriture_active && !pending && !succes);

  // ── Rendu ──
  return (
    <div
      className="mt-3 p-3.5 rounded-card border border-navy-light bg-cream"
      style={{ boxShadow: 'var(--shadow-raised)' }}
      data-testid="odoo-brouillon-form"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="font-sora text-[10px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em]">
          Facture Odoo · nouveau brouillon
        </div>
        {!succes && (
          <span className="inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold bg-amber-light text-[var(--color-amber-deep)] border-[var(--color-amber-foxo)]/30">
            Rien n&apos;est encore envoyé
          </span>
        )}
      </div>

      {!prep && !erreurPrep && (
        <div className="space-y-2">
          <div className="text-[12px] text-ink-mid">Lecture d&apos;Odoo (client, catalogue)… quelques secondes.</div>
          <SkeletonText lines={4} />
        </div>
      )}

      {erreurPrep && (
        <div className="text-[13px]">
          <div className="text-terra font-semibold">Lecture d&apos;Odoo impossible : {erreurPrep}</div>
          <button type="button" onClick={onFerme} className="mt-2 min-h-[44px] px-3 rounded-lg border border-sand-border text-[13px] font-semibold text-navy hover:bg-sand-hover">
            Fermer
          </button>
        </div>
      )}

      {prep && succes && (
        <div className="text-[13px] space-y-2">
          <div className="font-semibold text-ok">
            Brouillon créé dans Odoo{succes.partner_cree ? ' (nouvelle fiche client créée)' : ''}.
          </div>
          <div className="text-ink-mid">
            Il est sans numéro : vérifie-le, valide-le et envoie-le depuis Odoo. Il apparaîtra ici avec son numéro à la synchronisation suivante.
          </div>
          <div className="flex flex-wrap gap-2">
            {succes.odoo_url && (
              <a href={succes.odoo_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-navy text-white text-[13px] font-bold hover:opacity-90">
                Ouvrir dans Odoo <ExternalLink size={13} aria-hidden />
              </a>
            )}
            <button type="button" onClick={onFerme} className="min-h-[44px] px-3 rounded-lg border border-sand-border text-[13px] font-semibold text-navy hover:bg-sand-hover">
              Fermer
            </button>
          </div>
        </div>
      )}

      {prep && !succes && (
        <div className="space-y-4 text-[13px]">
          {prep.blocage && (
            <div className="px-3 py-2 rounded-lg bg-amber-light text-[var(--color-amber-deep)] font-semibold">{prep.blocage}</div>
          )}
          {!prep.ecriture_active && !prep.blocage && (
            <div className="px-3 py-2 rounded-lg bg-sand-mid text-ink-mid">
              Écriture vers Odoo désactivée (réglage <span className="font-mono">odoo_ecriture_active</span>) : le formulaire est consultable, mais rien ne peut partir.
            </div>
          )}

          {/* Client */}
          <div>
            <span className={ETIQUETTE}>Client Odoo</span>
            {modeClient === 'existant' && client && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border border-sand-border rounded-lg bg-white">
                <div>
                  <div className="font-semibold">{client.nom}</div>
                  {prep.client.source && client.id === prep.client.propose?.id && (
                    <div className="text-[12px] text-ok">{SOURCE_LABEL[prep.client.source]}</div>
                  )}
                  {client.email && <div className="text-[12px] text-ink-mid">{client.email}</div>}
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setRechercheOuverte((o) => !o); setRecherche(''); }} className="min-h-[44px] text-navy font-semibold underline">
                    {rechercheOuverte ? 'Fermer la recherche' : 'Changer'}
                  </button>
                  <button type="button" onClick={() => setModeClient('nouveau')} className="min-h-[44px] text-navy font-semibold underline">
                    Nouvelle fiche
                  </button>
                </div>
              </div>
            )}
            {modeClient === 'existant' && !client && (
              <div className="px-3 py-2 border border-sand-border rounded-lg bg-white text-ink-mid">
                Aucun client Odoo retrouvé pour ce dossier.
                <button type="button" onClick={() => setRechercheOuverte(true)} className="ml-2 min-h-[44px] text-navy font-semibold underline">Chercher</button>
                <button type="button" onClick={() => setModeClient('nouveau')} className="ml-3 min-h-[44px] text-navy font-semibold underline">Nouvelle fiche</button>
              </div>
            )}

            {modeClient === 'existant' && rechercheOuverte && (
              <div className="mt-2">
                <label htmlFor="odoo-client-recherche" className="sr-only">Rechercher un client Odoo</label>
                <input
                  id="odoo-client-recherche"
                  type="search"
                  value={recherche}
                  onChange={(e) => setRecherche(e.target.value)}
                  placeholder="Nom ou e-mail du client dans Odoo"
                  className={CHAMP}
                  autoFocus
                />
                {chercheEnCours && <div className="mt-1 text-[12px] text-ink-mid">Recherche…</div>}
                {!chercheEnCours && recherche.trim().length >= 2 && resultatsAffiches.length === 0 && (
                  <div className="mt-1 text-[12px] text-ink-mid">Aucun client Odoo ne correspond.</div>
                )}
                {resultatsAffiches.length > 0 && (
                  <ul className="mt-1 border border-sand-border rounded-lg bg-white divide-y divide-sand-border max-h-56 overflow-y-auto">
                    {resultatsAffiches.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => { setClient(r); setRechercheOuverte(false); setRecherche(''); }}
                          className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-sand-hover"
                        >
                          <span className="font-semibold">{r.nom}</span>
                          {r.email && <span className="ml-2 text-[12px] text-ink-mid">{r.email}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {modeClient === 'nouveau' && nouveau && (
              <div className="px-3 py-3 border border-sand-border rounded-lg bg-white space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0">
                  <div className="font-semibold">Nouvelle fiche client dans Odoo</div>
                  {(prep.client.propose || client) && (
                    <button type="button" onClick={() => setModeClient('existant')} className="min-h-[44px] text-navy font-semibold underline">
                      Utiliser un client existant
                    </button>
                  )}
                  {!prep.client.propose && !client && (
                    <button type="button" onClick={() => { setModeClient('existant'); setRechercheOuverte(true); }} className="min-h-[44px] text-navy font-semibold underline">
                      Chercher un client existant
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="nc-nom" className={ETIQUETTE}>Nom (tel qu&apos;il apparaîtra dans Odoo)</label>
                    <input id="nc-nom" className={CHAMP} value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="nc-email" className={ETIQUETTE}>E-mail de facturation</label>
                    <input id="nc-email" type="email" className={CHAMP} value={nouveau.email ?? ''} onChange={(e) => setNouveau({ ...nouveau, email: e.target.value || null })} />
                  </div>
                  <div>
                    <label htmlFor="nc-bce" className={ETIQUETTE}>BCE (10 chiffres)</label>
                    <input id="nc-bce" className={CHAMP} value={nouveau.bce ?? ''} onChange={(e) => setNouveau({ ...nouveau, bce: e.target.value || null })} />
                  </div>
                  <div>
                    <label htmlFor="nc-a1" className={ETIQUETTE}>Adresse, ligne 1 (c/o syndic)</label>
                    <input id="nc-a1" className={CHAMP} value={nouveau.adresse_ligne1 ?? ''} onChange={(e) => setNouveau({ ...nouveau, adresse_ligne1: e.target.value || null })} />
                  </div>
                  <div>
                    <label htmlFor="nc-a2" className={ETIQUETTE}>Adresse, ligne 2 (rue et numéro)</label>
                    <input id="nc-a2" className={CHAMP} value={nouveau.adresse_ligne2 ?? ''} onChange={(e) => setNouveau({ ...nouveau, adresse_ligne2: e.target.value || null })} />
                  </div>
                  <div>
                    <label htmlFor="nc-cp" className={ETIQUETTE}>Code postal</label>
                    <input id="nc-cp" className={CHAMP} value={nouveau.code_postal ?? ''} onChange={(e) => setNouveau({ ...nouveau, code_postal: e.target.value || null })} />
                  </div>
                  <div>
                    <label htmlFor="nc-ville" className={ETIQUETTE}>Ville</label>
                    <input id="nc-ville" className={CHAMP} value={nouveau.ville ?? ''} onChange={(e) => setNouveau({ ...nouveau, ville: e.target.value || null })} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Référence et date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="bo-ref" className={ETIQUETTE}>Référence (lien avec le dossier)</label>
              <input id="bo-ref" className={CHAMP} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div>
              <label htmlFor="bo-date" className={ETIQUETTE}>Date de facture</label>
              <input id="bo-date" type="date" className={CHAMP} value={dateFacture} onChange={(e) => setDateFacture(e.target.value)} />
              <div className="mt-1 text-[11px] text-ink-mid">Échéance et numéro : attribués par Odoo.</div>
            </div>
          </div>

          {/* Lignes */}
          <div>
            <span className={ETIQUETTE}>Lignes</span>
            <div className="space-y-2">
              {lignes.map((l, i) => {
                const total = arrondi(nombre(l.quantite) * nombre(l.prix_unitaire));
                return (
                  // Deux rangées par ligne : le volet du dossier est étroit, le
                  // produit prend toute la largeur, les chiffres passent dessous.
                  <div key={i} className="rounded-lg border border-sand-border bg-white/60 p-2 space-y-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 min-w-0">
                        <label htmlFor={`bo-prod-${i}`} className={ETIQUETTE}>Produit Odoo{lignes.length > 1 ? ` — ligne ${i + 1}` : ''}</label>
                        <select id={`bo-prod-${i}`} className={CHAMP} value={l.produit_id ?? ''} onChange={(e) => choisirProduit(i, e.target.value)}>
                          <option value="">— Libellé libre —</option>
                          {produitsTries.frequents.length > 0 && (
                            <optgroup label="Fréquents">
                              {produitsTries.frequents.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                            </optgroup>
                          )}
                          <optgroup label="Tout le catalogue">
                            {produitsTries.autres.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                          </optgroup>
                        </select>
                        {l.produit_id === null && (
                          <input aria-label={`Libellé ligne ${i + 1}`} className={`${CHAMP} mt-1`} value={l.libelle} placeholder="Libellé de la ligne" onChange={(e) => majLigne(i, { libelle: e.target.value })} />
                        )}
                      </div>
                      <button type="button" onClick={() => retirerLigne(i)} aria-label={`Retirer la ligne ${i + 1}`} disabled={lignes.length <= 1} className="min-h-[40px] w-10 shrink-0 inline-flex items-center justify-center rounded-lg text-ink-mid hover:text-terra hover:bg-sand-hover disabled:opacity-30">
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </div>
                    <div className="grid grid-cols-[64px_minmax(0,1fr)_84px_minmax(0,1fr)] gap-2 items-end">
                      <div>
                        <label htmlFor={`bo-q-${i}`} className={ETIQUETTE}>Qté</label>
                        <input id={`bo-q-${i}`} type="number" min={0} step={1} className={`${CHAMP} text-right tabular-nums`} value={l.quantite} onChange={(e) => majLigne(i, { quantite: nombre(e.target.value) })} />
                      </div>
                      <div>
                        <label htmlFor={`bo-pu-${i}`} className={ETIQUETTE}>P.U. HT</label>
                        <input id={`bo-pu-${i}`} type="number" min={0} step={0.01} className={`${CHAMP} text-right tabular-nums`} value={l.prix_unitaire} onChange={(e) => majLigne(i, { prix_unitaire: nombre(e.target.value) })} />
                      </div>
                      <div>
                        <label htmlFor={`bo-tva-${i}`} className={ETIQUETTE}>TVA</label>
                        <select id={`bo-tva-${i}`} className={CHAMP} value={l.taux_tva} onChange={(e) => majLigne(i, { taux_tva: nombre(e.target.value) })}>
                          {prep.catalogue.taux.map((t) => <option key={t} value={t}>{t} %</option>)}
                        </select>
                      </div>
                      <div className="text-right">
                        <span className={ETIQUETTE}>Total HT</span>
                        <div className="min-h-[40px] flex items-center justify-end tabular-nums font-semibold">{fmtMontant(total)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button type="button" onClick={ajouterLigne} className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-navy-pale border border-navy-light text-navy text-[13px] font-semibold hover:bg-navy-light">
                <Plus size={14} aria-hidden /> Ajouter une ligne
              </button>
              <span className="text-[11px] text-ink-mid">Produits, prix et TVA viennent d&apos;Odoo ; tout reste modifiable ici puis dans Odoo.</span>
            </div>
          </div>

          {/* Note */}
          <div>
            <label htmlFor="bo-note" className={ETIQUETTE}>Note sous les lignes (comme dans Odoo)</label>
            <textarea id="bo-note" rows={6} className={`${CHAMP} py-2 leading-relaxed`} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="mt-1 text-[11px] text-ink-mid">Pré-remplie avec la référence courtier/syndic, l&apos;adresse et les occupants du dossier.</div>
          </div>

          {/* Totaux */}
          <div className="flex justify-end">
            <div className="grid grid-cols-[auto_120px] gap-x-4 gap-y-1 text-right tabular-nums">
              <span className="text-ink-mid">Total HT</span><span>{fmtMontant(totaux.ht)}</span>
              <span className="text-ink-mid">TVA</span><span>{fmtMontant(totaux.tva)}</span>
              <span className="font-bold">Total TTC</span><span className="font-bold text-[15px]">{fmtMontant(totaux.ttc)}</span>
            </div>
          </div>

          {erreur && <div className="text-terra font-semibold">{erreur}</div>}

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-sand-border">
            <button
              type="button"
              onClick={creer}
              disabled={!peutEnvoyer}
              className="bg-navy text-white px-4 rounded-lg text-[13px] font-bold hover:opacity-90 min-h-[44px] disabled:opacity-50"
            >
              {pending ? 'Création dans Odoo…' : 'Créer le brouillon dans Odoo'}
            </button>
            <button type="button" onClick={onFerme} disabled={pending} className="min-h-[44px] px-3 rounded-lg border border-sand-border text-[13px] font-semibold text-navy hover:bg-sand-hover disabled:opacity-50">
              Annuler
            </button>
            <span className="text-[12px] text-ink-mid">Sans numéro : Odoo l&apos;attribue à la validation.</span>
          </div>
        </div>
      )}
    </div>
  );
}
