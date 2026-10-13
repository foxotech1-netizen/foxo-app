'use client';

// Bloc « Facture Odoo » d'un dossier : la ou les pièces Odoo reliées à ce
// dossier (miroir odoo_factures, lien posé par la synchronisation), en
// LECTURE SEULE. Rien n'est modifiable ici : pour corriger une pièce, on
// l'ouvre dans Odoo. Même habillage que les blocs du dossier
// (cf. Block dans InterventionsClient).

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { CLASSES_TON, etatFacture, type TonEtat } from '@/lib/facturation/odoo-libelles';
import { TZ_BRUSSELS } from '@/lib/format';
import { facturesOdooDuDossier, type FactureOdooDossier, type FacturesOdooDossier } from './facturation/odoo/actions';

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
    <span className={'inline-block px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ' + CLASSES_TON[ton]}>
      {children}
    </span>
  );
}

export function OdooFactureBlock({ interventionId }: { interventionId: string }) {
  // Réponse du serveur, étiquetée par le dossier demandé : tant que
  // l'étiquette ne correspond pas, on est en cours de chargement.
  const [reponse, setReponse] = useState<{ pour: string; res: FacturesOdooDossier } | null>(null);

  useEffect(() => {
    let actif = true;
    facturesOdooDuDossier(interventionId)
      .then((res) => { if (actif) setReponse({ pour: interventionId, res }); })
      .catch((e: unknown) => {
        if (actif) setReponse({ pour: interventionId, res: { ok: false, erreur: e instanceof Error ? e.message : 'lecture impossible' } });
      });
    return () => { actif = false; };
  }, [interventionId]);

  const res = reponse?.pour === interventionId ? reponse.res : null;

  return (
    <div
      className="bg-[var(--color-cream)] rounded-card px-3.5 py-3 mb-3"
      style={{ boxShadow: 'var(--shadow-card)' }}
      data-testid="odoo-facture-bloc"
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--color-navy)]"></span>
        <div className="font-sora text-[10px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em] flex-1">
          Facture Odoo
        </div>
      </div>
      <div className="text-[13px] text-[var(--color-ink)] leading-relaxed">
        {!res && <span className="text-ink-mid">Chargement…</span>}

        {res && !res.ok && (
          <span className="text-terra font-semibold">Lecture impossible : {res.erreur}</span>
        )}

        {res && res.ok && res.factures.length === 0 && (
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
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[12px] text-ink-mid">
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

        {res && res.ok && (
          <div className="mt-2 text-[11px] text-ink-mid">
            Dernière synchronisation : {fmtMoment(res.derniereSynchronisation)}
          </div>
        )}
      </div>
    </div>
  );
}
