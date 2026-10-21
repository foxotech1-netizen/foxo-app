'use client';

// Panneau « Reconstruire les dossiers depuis Odoo » (tuile Ventes de l'onglet
// Odoo). Deux actions seulement : vérifier à blanc, puis créer les dossiers
// manquants — par paquets de 20, le journal s'affichant au fil de l'eau, la
// vérification étant relancée automatiquement à la fin. Les dossiers existants
// ne sont jamais modifiés : leurs écarts sont seulement signalés.

import { useMemo, useState } from 'react';
import { Check, Copy, FolderPlus, RefreshCw, X } from 'lucide-react';
import type {
  LigneJournal,
  PlanReconstruction,
  StatutVerdict,
  Verdict,
} from '@/lib/facturation/odoo-reconstruction';

const ROUTE = '/api/admin/facturation/odoo/reconstruction';
// Même plafond que la route (MAX_REFS_PAR_APPEL) : envoi par paquets.
const PAQUET = 20;

const VERDICTS: Record<StatutVerdict, { label: string; classes: string; aide: string }> = {
  a_creer: {
    label: 'À créer',
    classes: 'bg-navy-pale text-navy border-navy-light',
    aide: 'Aucun dossier FoxO à ce numéro : il sera créé.',
  },
  existant_ecarts: {
    label: 'Existant · écarts',
    classes: 'bg-amber-light text-[var(--color-amber-deep)] border-[var(--color-amber-foxo)]/30',
    aide: 'Dossier présent mais différent de la facture : signalé, jamais modifié.',
  },
  a_qualifier: {
    label: 'À qualifier',
    classes: 'bg-terra-light text-terra border-terra-mid',
    aide: 'Client introuvable dans le référentiel : à compléter avant création.',
  },
  existant_ok: {
    label: 'Existant · conforme',
    classes: 'bg-ok-light text-ok border-ok-mid',
    aide: 'Dossier présent, date et adresse cohérentes avec la facture.',
  },
  sans_facture: {
    label: 'Sans facture',
    classes: 'bg-sand-mid text-ink-mid border-sand-border',
    aide: 'Dossier FoxO sans facture de vente dans Odoo.',
  },
};
const ORDRE_VERDICTS = Object.keys(VERDICTS) as StatutVerdict[];

type Filtre = 'tous' | StatutVerdict;

function fmtJour(d: string | null): string {
  return d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function appeler<T>(body: unknown): Promise<T> {
  const res = await fetch(ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as ({ ok: true } & T) | { ok: false; error: string } | null;
  if (!json) throw new Error(`Réponse illisible (HTTP ${res.status}).`);
  if (!json.ok) throw new Error(json.error);
  return json;
}

function Pastille({ statut }: { statut: StatutVerdict }) {
  const v = VERDICTS[statut];
  return (
    <span className={'fx-badge inline-block px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ' + v.classes} title={v.aide}>
      {v.label}
    </span>
  );
}

export function ReconstructionPanel({ onFerme, onTermine }: { onFerme: () => void; onTermine: () => void }) {
  const [plan, setPlan] = useState<PlanReconstruction | null>(null);
  const [verification, setVerification] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<Filtre>('tous');
  // Premier clic : on arme ; second clic : on crée. Pas de dialogue natif.
  const [arme, setArme] = useState(false);
  const [creation, setCreation] = useState<{ total: number; envoyes: number } | null>(null);
  const [journal, setJournal] = useState<LigneJournal[]>([]);
  // Retour visuel du bouton « Copier le tableau » (2 s).
  const [copie, setCopie] = useState(false);

  const occupe = verification || creation !== null;
  const aCreer = useMemo(
    () => (plan?.verdicts ?? []).filter((v) => v.statut === 'a_creer').map((v) => v.ref),
    [plan],
  );
  const affiches: Verdict[] = useMemo(
    () => (plan?.verdicts ?? []).filter((v) => filtre === 'tous' || v.statut === filtre),
    [plan, filtre],
  );

  async function verifier(): Promise<void> {
    setVerification(true);
    setErreur(null);
    setArme(false);
    try {
      const p = await appeler<PlanReconstruction>({ mode: 'verifier' });
      setPlan({ verdicts: p.verdicts, resume: p.resume });
    } catch (e) {
      setErreur(`Vérification impossible : ${message(e)}`);
    } finally {
      setVerification(false);
    }
  }

  async function creer(): Promise<void> {
    if (!plan || aCreer.length === 0) return;
    setArme(false);
    setErreur(null);
    setJournal([]);
    setCreation({ total: aCreer.length, envoyes: 0 });
    try {
      for (let i = 0; i < aCreer.length; i += PAQUET) {
        const paquet = aCreer.slice(i, i + PAQUET);
        const res = await appeler<{ journal: LigneJournal[] }>({ mode: 'executer', refs: paquet });
        setJournal((j) => [...j, ...res.journal]);
        setCreation({ total: aCreer.length, envoyes: Math.min(i + PAQUET, aCreer.length) });
      }
    } catch (e) {
      setErreur(`Création interrompue : ${message(e)} — les dossiers restants apparaîtront encore « À créer ».`);
    } finally {
      setCreation(null);
      await verifier();
      onTermine();
    }
  }

  // Texte brut : résumé, puis une ligne par verdict du filtre courant.
  async function copierTableau(): Promise<void> {
    if (!plan) return;
    const resume = ORDRE_VERDICTS.map((s) => `${s}: ${plan.resume[s]}`).join(' · ');
    const lignes = affiches.map((v) =>
      [v.ref, v.statut, v.date_facture ?? '', v.tiers_nom ?? '', v.adresse ?? '', v.client ?? '', v.details.join(' ; ')].join(' | '),
    );
    try {
      await navigator.clipboard.writeText([resume, ...lignes].join('\n'));
      setCopie(true);
      setTimeout(() => setCopie(false), 2_000);
    } catch (e) {
      setErreur(`Copie impossible : ${message(e)}`);
    }
  }

  const nbCrees = journal.filter((l) => l.resultat === 'cree').length;
  const nbRejets = journal.filter((l) => l.resultat === 'rejet').length;

  return (
    <section
      className="bg-cream border border-sand-border rounded-modal p-4 space-y-3"
      aria-label="Reconstruire les dossiers depuis Odoo"
      data-testid="odoo-reconstruction-panneau"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="fxs-block-title text-ink">Reconstruire les dossiers depuis Odoo</h3>
          <p className="fx-meta text-ink-mid max-w-[720px]">
            Une facture de vente = un dossier, numéroté et daté par la facture, client = tiers facturé.
            La vérification n&apos;écrit rien. La création ne concerne que les numéros sans dossier ;
            les dossiers existants ne sont jamais modifiés, leurs écarts sont seulement signalés.
          </p>
        </div>
        <button
          type="button"
          onClick={onFerme}
          disabled={occupe}
          aria-label="Fermer le panneau"
          className="min-h-[36px] w-9 inline-flex items-center justify-center rounded-lg text-ink-mid hover:bg-sand-hover disabled:opacity-50"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={verifier}
          disabled={occupe}
          className="fx-body bg-cream border-2 border-navy text-navy px-4 rounded-lg font-semibold hover:bg-navy-pale disabled:opacity-50 min-h-[44px] inline-flex items-center gap-2"
          data-testid="odoo-reconstruction-verifier"
        >
          <RefreshCw size={15} aria-hidden className={verification ? 'animate-spin' : undefined} />
          {verification ? 'Vérification…' : plan ? 'Vérifier à nouveau (à blanc)' : 'Vérifier (à blanc)'}
        </button>

        {plan && (
          <button
            type="button"
            onClick={copierTableau}
            disabled={occupe}
            className="fx-body min-h-[44px] px-3 rounded-lg border border-sand-border bg-cream font-semibold text-navy hover:bg-sand-hover disabled:opacity-50 inline-flex items-center gap-1.5"
            data-testid="odoo-reconstruction-copier"
          >
            {copie ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {copie ? 'Copié' : 'Copier le tableau'}
          </button>
        )}

        {!arme ? (
          <button
            type="button"
            onClick={() => setArme(true)}
            disabled={occupe || !plan || aCreer.length === 0}
            className="fx-body bg-navy text-cream px-4 rounded-lg font-semibold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-2"
            data-testid="odoo-reconstruction-creer"
          >
            <FolderPlus size={15} aria-hidden />
            {creation
              ? `Création en cours… ${creation.envoyes}/${creation.total}`
              : `Créer les ${aCreer.length} dossier${aCreer.length > 1 ? 's' : ''} manquant${aCreer.length > 1 ? 's' : ''}`}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={creer}
              className="fx-body bg-navy text-cream px-4 rounded-lg font-semibold hover:opacity-90 min-h-[44px] inline-flex items-center gap-2"
              data-testid="odoo-reconstruction-confirmer"
            >
              <FolderPlus size={15} aria-hidden /> Confirmer la création de {aCreer.length} dossier{aCreer.length > 1 ? 's' : ''}
            </button>
            <button
              type="button"
              onClick={() => setArme(false)}
              className="fx-body min-h-[44px] px-3 rounded-lg border border-sand-border font-semibold text-navy hover:bg-sand-hover"
            >
              Annuler
            </button>
          </>
        )}

        {!plan && !verification && (
          <span className="fx-meta text-ink-mid">Commencez par une vérification : rien n&apos;est écrit.</span>
        )}
        {plan && !occupe && aCreer.length === 0 && (
          <span className="fx-meta text-ink-mid">Aucun dossier manquant.</span>
        )}
      </div>

      {erreur && (
        <div role="alert" className="fx-label text-terra bg-terra-light border border-terra-mid rounded-lg px-3 py-2 font-semibold">
          {erreur}
        </div>
      )}

      {/* Journal de création */}
      {(journal.length > 0 || creation) && (
        <div className="space-y-1.5" aria-live="polite">
          <div className="fx-label font-semibold text-ink">
            Journal : {nbCrees} créé{nbCrees > 1 ? 's' : ''}{nbRejets > 0 ? ` · ${nbRejets} rejet${nbRejets > 1 ? 's' : ''}` : ''}
            {creation ? ` · ${creation.envoyes}/${creation.total} traités…` : ''}
          </div>
          <div className="border border-sand-border rounded-lg overflow-hidden">
            <div className="max-h-[260px] overflow-y-auto">
              <table className="w-full text-left min-w-[520px]">
                <thead className="sticky top-0">
                  <tr className="fx-eyebrow border-b border-sand-border text-ink-mid bg-sand">
                    <th className="px-2.5 py-1.5 font-semibold">N° dossier</th>
                    <th className="px-2.5 py-1.5 font-semibold">Résultat</th>
                    <th className="px-2.5 py-1.5 font-semibold">Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.map((l) => (
                    <tr key={l.ref} className="border-b border-sand-mid bg-cream">
                      <td className="fx-small px-2.5 py-1.5 fx-ref font-semibold text-navy whitespace-nowrap">{l.ref}</td>
                      <td className="fx-small px-2.5 py-1.5">
                        <span className={'px-2 py-0.5 rounded-lg border font-semibold ' +
                          (l.resultat === 'cree'
                            ? 'bg-ok-light text-ok border-ok-mid'
                            : l.resultat === 'rejet'
                              ? 'bg-terra-light text-terra border-terra-mid'
                              : 'bg-sand-mid text-ink-mid border-sand-border')
                        }>
                          {l.resultat === 'cree' ? 'Créé' : l.resultat === 'rejet' ? 'Rejet' : 'Ignoré'}
                        </span>
                      </td>
                      <td className="fx-small px-2.5 py-1.5 text-ink-mid">{l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Résultat de la vérification */}
      {plan && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {([['tous', 'Tous', plan.verdicts.length] as const, ...ORDRE_VERDICTS.map((s) => [s, VERDICTS[s].label, plan.resume[s]] as const)])
              .map(([cle, label, n]) => (
                <button
                  key={cle}
                  type="button"
                  onClick={() => setFiltre(cle)}
                  aria-pressed={filtre === cle}
                  title={cle === 'tous' ? undefined : VERDICTS[cle].aide}
                  className={'fx-pill min-h-[36px] px-3.5 rounded-full border font-semibold ' +
                    (filtre === cle ? 'bg-navy text-cream border-navy' : 'bg-cream text-ink border-sand-border hover:border-navy-light')
                  }
                >
                  {label} · {n}
                </button>
              ))}
          </div>

          {plan.verdicts.length === 0 ? (
            <div className="fx-body px-4 py-7 border border-sand-border rounded-lg bg-cream text-center text-ink-mid">
              Aucune facture de vente avec numéro de dossier dans le miroir. Lancez d&apos;abord une synchronisation.
            </div>
          ) : (
            <div className="border border-sand-border rounded-lg overflow-hidden">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-left min-w-[1040px]">
                  <thead className="sticky top-0">
                    <tr className="fx-eyebrow border-b border-sand-border text-ink-mid bg-sand">
                      <th className="px-2.5 py-1.5 font-semibold">N° dossier</th>
                      <th className="px-2.5 py-1.5 font-semibold">Date facture</th>
                      <th className="px-2.5 py-1.5 font-semibold">Client Odoo</th>
                      <th className="px-2.5 py-1.5 font-semibold">Adresse</th>
                      <th className="px-2.5 py-1.5 font-semibold">Client résolu</th>
                      <th className="px-2.5 py-1.5 font-semibold">Verdict</th>
                      <th className="px-2.5 py-1.5 font-semibold">Détails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affiches.map((v) => (
                      <tr key={v.ref} className="border-b border-sand-mid bg-cream align-top">
                        <td className="fx-small px-2.5 py-1.5 fx-ref font-semibold text-navy whitespace-nowrap">
                          {v.ref}
                          {v.numeros.length > 0 && (
                            <div className="font-normal text-ink-mid">{v.numeros.join(', ')}</div>
                          )}
                        </td>
                        <td className="fx-small px-2.5 py-1.5 tabular-nums whitespace-nowrap">{fmtJour(v.date_facture)}</td>
                        <td className="fx-small px-2.5 py-1.5">{v.tiers_nom ?? '—'}</td>
                        <td className="fx-small px-2.5 py-1.5">{v.adresse ?? '—'}</td>
                        <td className="fx-small px-2.5 py-1.5">{v.client ?? '—'}</td>
                        <td className="px-2.5 py-1.5"><Pastille statut={v.statut} /></td>
                        <td className="fx-small px-2.5 py-1.5 text-ink-mid">{v.details.join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {affiches.length === 0 && (
                  <div className="fx-body px-4 py-7 border-t border-sand-border text-center text-ink-mid">
                    Aucune ligne pour ce verdict.
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="fx-meta text-ink-mid">
            {affiches.length} ligne{affiches.length > 1 ? 's' : ''} affichée{affiches.length > 1 ? 's' : ''} sur {plan.verdicts.length}.
            Les dossiers créés reçoivent le statut « réalisée », la date de la facture et la prestation facturée en description.
          </div>
        </>
      )}
    </section>
  );
}
