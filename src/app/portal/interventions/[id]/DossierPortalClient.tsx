'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeft, Zap, MapPin, FileText, Receipt, Landmark, RotateCcw } from 'lucide-react';
import { StatutBadge } from '@/components/StatutBadge';
import { DownloadButton } from '@/components/DownloadButton';
import { relTime, TZ_BRUSSELS } from '@/lib/format';
import { usePortalContext, useVocab, useOrgType, useT, useLang } from '../../PortalContext';
import { localeFor, type PortalStringKey } from '@/lib/portal/i18n';
import { updateReferenceExterne, relanceOccupant } from '../../actions';
import { MessagesPanel } from '@/components/MessagesPanel';
import type { Occupant } from '@/lib/types/database';
import type { DossierData } from './page';

// Couleurs de l'etat de confirmation occupant — libelles via t() (multilingue).
const CONF_STYLE: Record<NonNullable<Occupant['conf']>, { fg: string; bg: string }> = {
  confirme:   { fg: '#1F6B45', bg: '#D4EDE2' },
  en_attente: { fg: '#B8830A', bg: '#FBF3E0' },
  decline:    { fg: '#C4622D', bg: '#F7EDE5' },
};
const CONF_KEY: Record<NonNullable<Occupant['conf']>, PortalStringKey> = {
  confirme: 'occConfirmed',
  en_attente: 'occPending',
  decline: 'occDeclined',
};

export function DossierPortalClient({ data }: { data: DossierData }) {
  const v = useVocab();
  const orgType = useOrgType();
  const t = useT();
  const lang = useLang();
  const locale = localeFor(lang);
  const { orgEmail } = usePortalContext();
  const { intervention: iv, acp, occupants, technicien: tech, isSinistre, hasReport, reportTransmittedAt } = data;

  const adresseFull = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ');
  const techNom = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ').trim() : null;
  const confirmedCount = occupants.filter((o) => o.conf === 'confirme').length;
  const appartements = iv.appartements_concernes ?? [];
  const showCourtierBlock = isSinistre && (
    iv.assureur?.assure
    || iv.assureur?.nom
    || iv.assureur?.reference_sinistre
    || iv.assureur?.reference_police
    || iv.action_requise
  );
  const showFacturationBlock = !!(
    iv.nom_facturation || iv.email_facturation || iv.bce_facturation || iv.ref_bon_commande
  );

  // Demande de suite / révision — visible une fois l'intervention aboutie
  // (hasReport = statut 'rapport' ou 'cloturee'). Réutilise la messagerie :
  // poste un message pré-formaté via /api/messages, l'auteur_type est dérivé
  // de la session côté serveur (syndic / courtier / expert).
  const [followUpState, setFollowUpState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  // Référence interne du syndic (interventions.reference_externe). Éditable
  // uniquement côté syndic. Vide autorisé → l'action stocke null (efface).
  const [refValue, setRefValue] = useState(iv.reference_externe ?? '');
  const [refSaved, setRefSaved] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [isSavingRef, startSaveRef] = useTransition();
  const refUnchanged = refValue === (iv.reference_externe ?? '');

  // Relance occupant (syndic) : état par occupant pour le bouton de la liste.
  const [relanceState, setRelanceState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});
  async function handleRelance(occId: string) {
    if (relanceState[occId] === 'sending') return;
    setRelanceState((s) => ({ ...s, [occId]: 'sending' }));
    const res = await relanceOccupant(iv.id, occId);
    setRelanceState((s) => ({ ...s, [occId]: res.ok ? 'sent' : 'error' }));
  }

  function saveReference() {
    setRefError(null);
    setRefSaved(false);
    startSaveRef(async () => {
      const res = await updateReferenceExterne(iv.id, refValue);
      if (!res.ok) {
        setRefError(res.error);
        return;
      }
      setRefSaved(true);
    });
  }

  async function requestFollowUp() {
    if (followUpState === 'sending') return;
    setFollowUpState('sending');
    setFollowUpError(null);
    try {
      const r = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intervention_id: iv.id,
          // Corps du message volontairement conservé en FR : il est lu par
          // l'équipe FoxO (francophone) dans la messagerie admin — ce n'est pas
          // du texte d'interface du portail.
          contenu:
            'Demande de suite / révision sur ce dossier. Merci de me recontacter à ce sujet.',
        }),
      });
      const d = await r.json();
      if (!d.ok) {
        setFollowUpError(d.error ?? t('followUpSendError'));
        setFollowUpState('idle');
        return;
      }
      setFollowUpState('sent');
    } catch (e) {
      setFollowUpError(e instanceof Error ? e.message : t('networkError'));
      setFollowUpState('idle');
    }
  }

  return (
    <div className="space-y-5">
      {/* Navigation retour */}
      <Link
        href="/portal/interventions"
        className="inline-flex items-center gap-1 text-xs text-navy hover:underline"
      >
        <ArrowLeft size={14} /> {v.interventionsCap}
      </Link>

      {/* En-tête : référence + statut + ACP + métadonnées */}
      <header className="fxs-card p-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-mono text-xs text-[var(--color-ink-muted)]">{iv.ref ?? '—'}</span>
          {iv.priorite === 'urgente' && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra)]/30 rounded-full px-2 py-0.5">
              <Zap size={12} /> {t('urgent')}
            </span>
          )}
          <StatutBadge statut={iv.statut} big lang={lang} />
        </div>
        <h1 className="fxs-page-title">{acp?.nom ?? '—'}</h1>
        {adresseFull && (
          <div className="inline-flex items-center gap-1.5 text-[13px] text-ink-mid mt-1"><MapPin size={14} /> {adresseFull}</div>
        )}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
          <Meta label={t('thCreated')} value={new Date(iv.created_at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long', timeZone: TZ_BRUSSELS })} />
          <Meta
            label={t('plannedIntervention')}
            value={iv.creneau_debut ? new Date(iv.creneau_debut).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS }) : t('notConfirmed')}
            highlight={!iv.creneau_debut ? 'text-terra' : undefined}
          />
          <Meta
            label={t('thTechnician')}
            value={techNom ?? t('notYetAssigned')}
            highlight={!techNom ? 'text-ink-muted italic' : undefined}
          />
        </div>
        <div className="text-[10px] text-ink-muted mt-3 font-mono">
          {t('lastUpdate')} {relTime(iv.updated_at)}
        </div>
      </header>

      {/* Chronologie du sinistre (courtier/expert uniquement) — frise dérivée des
          jalons datés existants : déclaration, intervention, rapport. Pas de table
          d'historique de statuts -> les étapes non atteintes sont « à planifier /
          en attente », sans date inventée. */}
      {isSinistre && (
        <Block title={t('chronologyTitle')}>
          <ol className="ml-1 space-y-4 border-l-2 border-sand-mid pl-5">
            <TimelineItem
              done
              label={t('evtDeclared')}
              value={fmtDay(iv.date_demande ?? iv.created_at, locale)}
            />
            <TimelineItem
              done={iv.statut === 'realisee' || iv.statut === 'rapport' || iv.statut === 'cloturee'}
              pending={!iv.creneau_debut}
              label={iv.statut === 'realisee' || iv.statut === 'rapport' || iv.statut === 'cloturee' ? t('evtCompleted') : t('plannedIntervention')}
              value={iv.creneau_debut ? fmtDay(iv.creneau_debut, locale) : t('toBeScheduled')}
            />
            <TimelineItem
              done={!!reportTransmittedAt}
              pending={!reportTransmittedAt}
              label={t('evtReportTransmitted')}
              value={reportTransmittedAt ? fmtDay(reportTransmittedAt, locale) : t('chipPending')}
            />
          </ol>
        </Block>
      )}

      {/* Ma référence — éditable côté syndic uniquement (reference_externe) */}
      {orgType === 'syndic' && (
        <Block title={v.referenceLabel}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <input
              type="text"
              value={refValue}
              onChange={(e) => { setRefValue(e.target.value); setRefSaved(false); }}
              placeholder={t('yourInternalRef')}
              className="flex-1 px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
            />
            <button
              type="button"
              onClick={saveReference}
              disabled={isSavingRef || refUnchanged}
              className="inline-flex items-center justify-center gap-1.5 bg-navy text-white px-4 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
            >
              {isSavingRef ? t('saving') : t('save')}
            </button>
          </div>
          {refError && (
            <div className="mt-2 px-3 py-1.5 bg-terra-light border border-terra-mid text-terra rounded-md text-[11px] font-semibold">
              {refError}
            </div>
          )}
          {refSaved && !refError && (
            <p className="mt-2 text-[11px] text-ink-muted">{t('refSavedMsg')}</p>
          )}
        </Block>
      )}

      {/* Bandeau motif suspension */}
      {iv.statut === 'en_suspens' && iv.suspens_motif && (
        <div className="bg-terra-light border border-terra-mid rounded-2xl p-4">
          <div className="text-[10px] font-bold text-terra uppercase tracking-wider mb-2">
            {t('suspensionReason')}
          </div>
          <p className="text-[13px] text-terra">{iv.suspens_motif}</p>
        </div>
      )}

      {/* Bloc description : type + description + appartements concernés */}
      <Block title={t('descriptionTitle')}>
        <div className="space-y-3">
          {iv.type && (
            <div>
              <Label>{t('interventionType')}</Label>
              <div className="font-semibold text-[13px] mt-0.5">{iv.type}</div>
            </div>
          )}
          {iv.description && (
            <div>
              <Label>{t('initialDescription')}</Label>
              <p className="text-[13px] text-ink-mid mt-0.5 whitespace-pre-wrap leading-relaxed">
                {iv.description}
              </p>
            </div>
          )}
          {appartements.length > 0 && (
            <div>
              <Label>{t('apartmentsConcerned')}</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {appartements.map((a) => (
                  <span
                    key={a}
                    className="inline-block text-[11px] font-mono font-semibold bg-navy-pale text-navy border border-navy-light rounded px-2 py-0.5"
                  >
                    {t('aptShort')} {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {iv.adresse && iv.adresse !== adresseFull && (
            <div>
              <Label>{t('preciseAddress')}</Label>
              <div className="text-[13px] text-ink-mid mt-0.5">{iv.adresse}</div>
            </div>
          )}
        </div>
      </Block>

      {/* Bloc rapport */}
      <Block title={t('reportBadge')}>
        {hasReport ? (
          <div className="space-y-2">
            <p className="text-[13px] text-ink-mid">
              {t('reportIsAvailable')}
            </p>
            <DownloadButton
              href={`/api/rapport/${iv.id}`}
              filename={`rapport-${iv.ref ?? iv.id}.pdf`}
              label={t('downloadReport')}
              icon={FileText}
            />
            {iv.statut === 'cloturee' && (
              <DownloadButton
                href={`/api/facture/${iv.id}`}
                filename={`facture-${iv.ref ?? iv.id}.pdf`}
                label={t('downloadInvoice')}
                icon={Receipt}
              />
            )}
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted italic">
            {t('reportInPreparation')}
          </p>
        )}
      </Block>

      {/* Demande de suite / révision — uniquement quand l'intervention a
          abouti (rapport disponible ou dossier clôturé). Poste un message
          pré-formaté dans le fil ci-dessous via /api/messages. */}
      {hasReport && (
        <Block title={t('requestFollowUpTitle')}>
          {followUpState === 'sent' ? (
            <p className="text-[13px] text-ink-mid">
              {t('followUpSentMsg')}
            </p>
          ) : (
            <>
              <p className="text-[13px] text-ink-mid mb-3">
                {t('followUpIntro')}
              </p>
              {followUpError && (
                <div className="mb-2 px-3 py-1.5 bg-terra-light border border-terra-mid text-terra rounded-md text-[11px] font-semibold">
                  {followUpError}
                </div>
              )}
              <button
                type="button"
                onClick={requestFollowUp}
                disabled={followUpState === 'sending'}
                className="inline-flex items-center gap-1.5 bg-navy text-white px-4 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
              >
                <RotateCcw size={14} />
                {followUpState === 'sending' ? t('sending') : t('requestFollowUpButton')}
              </button>
            </>
          )}
        </Block>
      )}

      {/* Messagerie syndic ↔ admin (panel partagé, polling 30s) */}
      <MessagesPanel
        interventionId={iv.id}
        currentUserEmail={orgEmail}
        isAdmin={false}
      />

      {/* Bloc assurance (mode courtier uniquement) */}
      {showCourtierBlock && (
        <section
          className="rounded-2xl p-4"
          style={{ background: '#EAF2F8', border: '1px solid #A8C8E0' }}
        >
          <h2 className="inline-flex items-center gap-1.5 fxs-block-title mb-3" style={{ color: '#1D6FA4' }}>
            <Landmark size={14} /> {t('insuranceInfo')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
            {iv.assureur?.assure && (
              <CourtierField label={v.acpLabel} value={iv.assureur.assure} />
            )}
            {iv.assureur?.nom && (
              <CourtierField label={t('insuranceCompany')} value={iv.assureur.nom} />
            )}
            {iv.assureur?.reference_sinistre && (
              <CourtierField label={t('claimReference')} value={iv.assureur.reference_sinistre} mono />
            )}
            {iv.assureur?.reference_police && (
              <CourtierField label={t('policyReference')} value={iv.assureur.reference_police} mono />
            )}
            {iv.assureur?.email && (
              <CourtierField label={t('insurerContact')} value={iv.assureur.email} mono small />
            )}
            {iv.action_requise && (
              <div className="sm:col-span-2 pt-1 border-t" style={{ borderColor: '#A8C8E0' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1D6FA4' }}>
                  {t('actionRequired')}
                </div>
                <p className="text-ink whitespace-pre-wrap">{iv.action_requise}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Occupants */}
      {occupants.length > 0 && (
        <section>
          <h2 className="fxs-block-title text-ink mb-3">
            {t('occupantsTitle')} — {confirmedCount}/{occupants.length} {t('confirmedSuffix')}
          </h2>
          <div className="bg-cream rounded-xl border border-sand-border divide-y divide-sand-mid">
            {occupants.map((o) => {
              const conf = o.conf ?? 'en_attente';
              const cs = CONF_STYLE[conf];
              return (
                <div key={o.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{o.nom ?? '—'}</div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      {t('aptShort')} {o.appartement ?? '—'}
                      {o.email ? <> · <span className="font-mono">{o.email}</span></> : null}
                      {o.telephone ? <> · {o.telephone}</> : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
                      style={{ color: cs.fg, background: cs.bg }}
                    >
                      {t(CONF_KEY[conf])}
                    </span>
                    {orgType === 'syndic' && conf === 'en_attente' && iv.creneau_debut && (
                      relanceState[o.id] === 'sent' ? (
                        <span className="text-[10px] font-semibold text-ok">{t('relanceSent')}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRelance(o.id)}
                          disabled={relanceState[o.id] === 'sending'}
                          className="text-[10px] font-semibold text-navy underline hover:no-underline disabled:opacity-50"
                        >
                          {relanceState[o.id] === 'sending' ? t('sending') : relanceState[o.id] === 'error' ? t('relanceError') : t('relanceBtn')}
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Bloc facturation (récap, si renseigné) */}
      {showFacturationBlock && (
        <section>
          <h2 className="fxs-block-title text-ink mb-3">{t('billingTitle')}</h2>
          <div className="bg-cream border border-sand-border rounded-xl p-4 text-[13px] grid grid-cols-1 sm:grid-cols-2 gap-3">
            {iv.nom_facturation && (
              <div>
                <Label>{t('recipient')}</Label>
                <div className="mt-0.5">{iv.nom_facturation}</div>
              </div>
            )}
            {iv.email_facturation && (
              <div>
                <Label>{t('emailLabel')}</Label>
                <div className="mt-0.5 font-mono text-xs">{iv.email_facturation}</div>
              </div>
            )}
            {iv.bce_facturation && (
              <div>
                <Label>{t('bceLabel')}</Label>
                <div className="mt-0.5 font-mono text-xs">{iv.bce_facturation}</div>
              </div>
            )}
            {iv.ref_bon_commande && (
              <div>
                <Label>{t('purchaseOrder')}</Label>
                <div className="mt-0.5 font-mono text-xs">{iv.ref_bon_commande}</div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Helpers d'affichage ────────────────────────────────────────────────

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-cream rounded-2xl p-5 border border-sand-border">
      <h2 className="fxs-block-title text-ink mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
      {children}
    </span>
  );
}

function Meta({
  label, value, highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className={'mt-0.5 font-semibold ' + (highlight ?? 'text-ink')}>{value}</div>
    </div>
  );
}

function CourtierField({
  label, value, mono, small,
}: {
  label: string; value: string; mono?: boolean; small?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1D6FA4' }}>
        {label}
      </div>
      <div className={
        (small ? 'text-xs ' : '') +
        (mono ? 'font-mono ' : '') +
        'font-semibold'
      }>
        {value}
      </div>
    </div>
  );
}

// Date courte localisée (jour mois année) — pour la frise Chronologie.
function fmtDay(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_BRUSSELS });
}

function TimelineItem({
  label, value, done, pending,
}: {
  label: string; value: string; done?: boolean; pending?: boolean;
}) {
  return (
    <li className="relative">
      <span className={'absolute -left-[22px] top-1.5 w-2.5 h-2.5 rounded-full ' + (done ? 'bg-navy' : 'bg-sand-mid')} />
      <div className="text-[12px] font-semibold text-ink">{label}</div>
      <div className={'text-[12px] ' + (pending ? 'text-ink-muted italic' : 'text-ink-mid')}>{value}</div>
    </li>
  );
}
