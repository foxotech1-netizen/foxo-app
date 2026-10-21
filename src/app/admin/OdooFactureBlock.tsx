'use client';

// Bloc « Facture Odoo » d'un dossier : la ou les pièces Odoo reliées à ce
// dossier (miroir odoo_factures, lien posé par la synchronisation), plus les
// brouillons créés depuis FoxO (odoo_brouillons). Les pièces validées sont en
// LECTURE SEULE : pour corriger une pièce, on l'ouvre dans Odoo. La seule
// action est « Créer un brouillon dans Odoo » (formulaire BrouillonOdooForm),
// proposée quand le dossier n'a ni facture validée ni brouillon en attente.
// Même habillage que les blocs du dossier (cf. Block dans InterventionsClient).

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Plus, QrCode } from 'lucide-react';
import { CLASSES_TON, etatFacture, type TonEtat } from '@/lib/facturation/odoo-libelles';
import { TZ_BRUSSELS } from '@/lib/format';
import { facturesOdooDuDossier, type FactureOdooDossier, type FacturesOdooDossier } from './facturation/odoo/actions';
import { brouillonsDuDossier, qrPaiementAction, type BrouillonDossier, type BrouillonsDossier } from './facturation/odoo/brouillon-actions';
import type { PaiementBrouillon } from '@/lib/facturation/odoo-brouillon';
import { BrouillonOdooForm } from './BrouillonOdooForm';
import { QrPaiement } from './QrPaiement';

// Date calendaire AAAA-MM-JJ → JJ/MM/AAAA, sans passer par un fuseau.
function fmtJour(d: string | null): string {
  return d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
}

function fmtMontant(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtMoment(iso: string | null): string {
  if (!iso) return 'jamais';
  return new Date(iso).toLocaleString('fr-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: TZ_BRUSSELS,
  });
}

// « Émise le 12/01/2026 · payée le 03/02/2026 » / « … · échéance 11/02/2026 · reste 120,00 € »
function detailDe(f: FactureOdooDossier): string {
  const info = etatFacture(f.etat_paiement, 'vente');
  const morceaux = [`Émise le ${fmtJour(f.date_facture)}`];
  if (f.date_dernier_reglement) {
    morceaux.push(`${info.groupe === 'payee' ? 'payée' : 'dernier paiement'} le ${fmtJour(f.date_dernier_reglement)}`);
  }
  if (info.groupe === 'a_regler' || info.groupe === 'partielle') {
    if (f.date_echeance) morceaux.push(`échéance ${fmtJour(f.date_echeance)}`);
    if (info.groupe === 'partielle' && typeof f.montant_restant === 'number') {
      morceaux.push(`reste ${fmtMontant(f.montant_restant)}`);
    }
  }
  return morceaux.join(' · ');
}

function Pastille({ ton, children }: { ton: TonEtat; children: React.ReactNode }) {
  return (
    <span className={'fx-badge inline-block px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ' + CLASSES_TON[ton]}>
      {children}
    </span>
  );
}

export function OdooFactureBlock({ interventionId }: { interventionId: string }) {
  // Réponse du serveur, étiquetée par le dossier demandé : tant que
  // l'étiquette ne correspond pas, on est en cours de chargement.
  const [reponse, setReponse] = useState<{ pour: string; res: FacturesOdooDossier } | null>(null);
  const [brouillons, setBrouillons] = useState<{ pour: string; res: BrouillonsDossier } | null>(null);
  // Dossier pour lequel le formulaire est ouvert : un changement de dossier
  // le referme de lui-même (aucun effet nécessaire).
  const [dossierDuFormulaire, setDossierDuFormulaire] = useState<string | null>(null);
  const formulaireOuvert = dossierDuFormulaire === interventionId;
  // Incrémenté pour relire le bloc (après création d'un brouillon).
  const [version, setVersion] = useState(0);
  // QR de paiement affiché pour un brouillon en attente (par identifiant).
  const [qr, setQr] = useState<{ pour: string; paiement: PaiementBrouillon | null; erreur: string | null } | null>(null);

  const afficherQr = useCallback(async (brouillonId: string) => {
    setQr({ pour: brouillonId, paiement: null, erreur: null });
    const res = await qrPaiementAction(brouillonId);
    setQr(res.ok ? { pour: brouillonId, paiement: res.paiement, erreur: null } : { pour: brouillonId, paiement: null, erreur: res.erreur });
  }, []);

  useEffect(() => {
    let actif = true;
    facturesOdooDuDossier(interventionId)
      .then((res) => { if (actif) setReponse({ pour: interventionId, res }); })
      .catch((e: unknown) => {
        if (actif) setReponse({ pour: interventionId, res: { ok: false, erreur: e instanceof Error ? e.message : 'lecture impossible' } });
      });
    brouillonsDuDossier(interventionId)
      .then((res) => { if (actif) setBrouillons({ pour: interventionId, res }); })
      .catch((e: unknown) => {
        if (actif) setBrouillons({ pour: interventionId, res: { ok: false, erreur: e instanceof Error ? e.message : 'lecture impossible' } });
      });
    return () => { actif = false; };
  }, [interventionId, version]);

  const relire = useCallback(() => setVersion((v) => v + 1), []);

  const res = reponse?.pour === interventionId ? reponse.res : null;
  const resB = brouillons?.pour === interventionId ? brouillons.res : null;
  const enAttente: BrouillonDossier[] = resB && resB.ok ? resB.brouillons.filter((b) => b.etat === 'brouillon') : [];
  // Le bouton n'apparaît que sans facture validée (hors note de crédit) et
  // sans brouillon en attente ; le serveur refait la même vérification.
  const peutCreer = Boolean(
    res && res.ok && resB && resB.ok
    && res.factures.every((f) => f.est_note_credit)
    && enAttente.length === 0,
  );

  return (
    <div
      className="bg-[var(--color-cream)] rounded-card px-3.5 py-3 mb-3"
      style={{ boxShadow: 'var(--shadow-card)' }}
      data-testid="odoo-facture-bloc"
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--color-navy)]"></span>
        <div className="fx-eyebrow font-medium text-ink-mid flex-1">
          Facture Odoo
        </div>
      </div>
      <div className="fx-body text-[var(--color-ink)] leading-relaxed">
        {!res && <span className="text-ink-mid">Chargement…</span>}

        {res && !res.ok && (
          <span className="text-terra-ink font-semibold">Lecture impossible : {res.erreur}</span>
        )}

        {res && res.ok && res.factures.length === 0 && enAttente.length === 0 && (
          <span className="text-ink-mid">Aucune facture pour ce dossier dans Odoo.</span>
        )}

        {res && res.ok && res.factures.map((f, i) => {
          const info = etatFacture(f.etat_paiement, 'vente');
          return (
            <div key={f.id} className={i > 0 ? 'mt-2 pt-2 border-t border-sand-border' : undefined}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-semibold">{f.numero ?? `pièce ${f.odoo_id}`}</span>
                {f.est_note_credit && <Pastille ton="neutre">Note de crédit</Pastille>}
                <Pastille ton={info.ton}>{info.label}</Pastille>
                <span className="ml-auto font-semibold tabular-nums whitespace-nowrap">
                  {typeof f.montant_ttc === 'number' ? `${fmtMontant(f.montant_ttc)} TTC` : '—'}
                </span>
              </div>
              <div className="fx-meta flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-ink-mid">
                <span>{detailDe(f)}</span>
                {res.odooUrl && (
                  <a
                    href={`${res.odooUrl}/web#id=${f.odoo_id}&model=account.move&view_type=form`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-navy font-semibold hover:underline whitespace-nowrap"
                  >
                    Ouvrir dans Odoo <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </div>
            </div>
          );
        })}

        {resB && !resB.ok && (
          <div className="text-terra-ink font-semibold">Brouillons illisibles : {resB.erreur}</div>
        )}

        {enAttente.map((b, i) => (
          <div key={b.id} className={i > 0 || (res && res.ok && res.factures.length > 0) ? 'mt-2 pt-2 border-t border-sand-border' : undefined} data-testid="odoo-brouillon-attente">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Pastille ton="partiel">Brouillon dans Odoo</Pastille>
              <span className="text-ink-mid">sans numéro</span>
              <span className="ml-auto font-semibold tabular-nums whitespace-nowrap">
                {typeof b.montant_ttc === 'number' ? `${fmtMontant(b.montant_ttc)} TTC` : '—'}
              </span>
            </div>
            <div className="fx-meta flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-ink-mid">
              <span>Créé depuis FoxO le {fmtMoment(b.cree_le)} · référence « {b.reference} »</span>
              {b.odoo_url && (
                <a href={b.odoo_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-navy font-semibold hover:underline whitespace-nowrap">
                  Ouvrir dans Odoo <ExternalLink size={12} aria-hidden />
                </a>
              )}
            </div>
            <div className="fx-meta mt-1.5 px-2.5 py-1.5 rounded-lg bg-navy-pale text-ink-mid">
              À faire dans Odoo : vérifier, valider, envoyer. Une fois validée, la facture apparaît ici avec son numéro à la synchronisation suivante.
            </div>
            {b.communication && (
              <div className="mt-1.5">
                {qr?.pour !== b.id ? (
                  <button
                    type="button"
                    onClick={() => afficherQr(b.id)}
                    className="fx-body inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg bg-navy-pale border border-navy-light text-navy font-semibold hover:bg-navy-light"
                  >
                    <QrCode size={15} aria-hidden /> QR de paiement sur place
                  </button>
                ) : qr.erreur ? (
                  <div className="fx-label text-terra-ink font-semibold">{qr.erreur}</div>
                ) : qr.paiement ? (
                  <div>
                    <QrPaiement paiement={qr.paiement} />
                    <button type="button" onClick={() => setQr(null)} className="fx-label mt-1 min-h-[44px] text-navy font-semibold underline">Masquer le QR</button>
                  </div>
                ) : (
                  <div className="fx-meta text-ink-mid">Préparation du QR…</div>
                )}
              </div>
            )}
          </div>
        ))}

        {peutCreer && !formulaireOuvert && (
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setDossierDuFormulaire(interventionId)}
              className="fx-body bg-navy text-cream px-3.5 rounded-lg font-semibold hover:opacity-90 inline-flex items-center gap-2 min-h-[44px]"
              data-testid="odoo-brouillon-ouvrir"
            >
              <Plus size={15} aria-hidden /> Créer un brouillon dans Odoo
            </button>
            <span className="fx-meta text-ink-mid">Pré-rempli depuis ce dossier. Le brouillon reste sans numéro : tu le vérifies, le valides et l&apos;envoies depuis Odoo.</span>
          </div>
        )}

        {formulaireOuvert && (
          <BrouillonOdooForm
            interventionId={interventionId}
            onFerme={() => setDossierDuFormulaire(null)}
            onCree={relire}
          />
        )}

        {res && res.ok && (
          <div className="fx-small mt-2 text-ink-mid">
            Dernière synchronisation : {fmtMoment(res.derniereSynchronisation)}
          </div>
        )}
      </div>
    </div>
  );
}
