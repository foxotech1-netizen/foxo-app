'use client';

import Link from 'next/link';
import { StatutBadge } from '@/components/StatutBadge';
import { DownloadButton } from '@/components/DownloadButton';
import { fmtDate, fmtDateTime, relTime } from '@/lib/format';
import { usePortalContext, useVocab } from '../../PortalContext';
import { MessagesPanel } from '@/components/MessagesPanel';
import type { Occupant } from '@/lib/types/database';
import type { DossierData } from './page';

const CONF_INFO: Record<NonNullable<Occupant['conf']>, { label: string; fg: string; bg: string }> = {
  confirme:   { label: 'Confirmé',   fg: '#1F6B45', bg: '#D4EDE2' },
  en_attente: { label: 'En attente', fg: '#B8830A', bg: '#FBF3E0' },
  decline:    { label: 'Décliné',    fg: '#C4622D', bg: '#F7EDE5' },
};

export function DossierPortalClient({ data }: { data: DossierData }) {
  const v = useVocab();
  const { orgEmail } = usePortalContext();
  const { intervention: iv, acp, occupants, technicien: tech, isCourtier, hasReport } = data;

  const adresseFull = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ');
  const techNom = tech ? [tech.prenom, tech.nom].filter(Boolean).join(' ').trim() : null;
  const confirmedCount = occupants.filter((o) => o.conf === 'confirme').length;
  const appartements = iv.appartements_concernes ?? [];
  const showCourtierBlock = isCourtier && (
    iv.assureur?.nom
    || iv.assureur?.reference_sinistre
    || iv.assureur?.reference_police
    || iv.action_requise
  );
  const showFacturationBlock = !!(
    iv.nom_facturation || iv.email_facturation || iv.bce_facturation || iv.ref_bon_commande
  );

  return (
    <div className="space-y-5">
      {/* Navigation retour */}
      <Link
        href="/portal/interventions"
        className="inline-flex items-center gap-1 text-xs text-navy hover:underline"
      >
        ← {v.interventionsCap}
      </Link>

      {/* En-tête : référence + statut + ACP + métadonnées */}
      <header className="bg-cream border border-sand-border rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-mono text-xs text-ink-muted">{iv.ref ?? '—'}</span>
          {iv.priorite === 'urgente' && (
            <span className="text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-2 py-0.5">
              ⚡ URGENT
            </span>
          )}
          <StatutBadge statut={iv.statut} big />
        </div>
        <h1 className="text-xl font-extrabold text-ink">{acp?.nom ?? '—'}</h1>
        {adresseFull && (
          <div className="text-[13px] text-ink-mid mt-1">📍 {adresseFull}</div>
        )}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12px]">
          <Meta label="Créé le" value={fmtDate(iv.created_at)} />
          <Meta
            label="Intervention prévue"
            value={iv.creneau_debut ? fmtDateTime(iv.creneau_debut, true) : 'Non confirmé'}
            highlight={!iv.creneau_debut ? 'text-terra' : undefined}
          />
          <Meta
            label="Technicien"
            value={techNom ?? 'Non encore assigné'}
            highlight={!techNom ? 'text-ink-muted italic' : undefined}
          />
        </div>
        <div className="text-[10px] text-ink-muted mt-3 font-mono">
          Mise à jour {relTime(iv.updated_at)}
        </div>
      </header>

      {/* Bandeau motif suspension */}
      {iv.statut === 'en_suspens' && iv.suspens_motif && (
        <div className="bg-terra-light border border-terra-mid rounded-2xl p-4">
          <div className="text-[10px] font-bold text-terra uppercase tracking-wider mb-2">
            Motif de suspension
          </div>
          <p className="text-[13px] text-terra">{iv.suspens_motif}</p>
        </div>
      )}

      {/* Bloc description : type + description + appartements concernés */}
      <Block title="Description">
        <div className="space-y-3">
          {iv.type && (
            <div>
              <Label>Type d&apos;intervention</Label>
              <div className="font-semibold text-[13px] mt-0.5">{iv.type}</div>
            </div>
          )}
          {iv.description && (
            <div>
              <Label>Description initiale</Label>
              <p className="text-[13px] text-ink-mid mt-0.5 whitespace-pre-wrap leading-relaxed">
                {iv.description}
              </p>
            </div>
          )}
          {appartements.length > 0 && (
            <div>
              <Label>Appartement(s) concerné(s)</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {appartements.map((a) => (
                  <span
                    key={a}
                    className="inline-block text-[11px] font-mono font-semibold bg-navy-pale text-navy border border-navy-light rounded px-2 py-0.5"
                  >
                    Apt. {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {iv.adresse && iv.adresse !== adresseFull && (
            <div>
              <Label>Adresse précise</Label>
              <div className="text-[13px] text-ink-mid mt-0.5">{iv.adresse}</div>
            </div>
          )}
        </div>
      </Block>

      {/* Bloc rapport */}
      <Block title="Rapport">
        {hasReport ? (
          <div className="space-y-2">
            <p className="text-[13px] text-ink-mid">
              Le rapport d&apos;intervention est disponible.
            </p>
            <DownloadButton
              href={`/api/rapport/${iv.id}`}
              filename={`rapport-${iv.ref ?? iv.id}.pdf`}
              label="📄 Télécharger le rapport"
            />
            {iv.statut === 'cloturee' && (
              <DownloadButton
                href={`/api/facture/${iv.id}`}
                filename={`facture-${iv.ref ?? iv.id}.pdf`}
                label="🧾 Télécharger la facture"
              />
            )}
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted italic">
            Rapport en cours de préparation. Vous serez notifié dès qu&apos;il sera disponible.
          </p>
        )}
      </Block>

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
          <h2 className="text-sm font-bold mb-3" style={{ color: '#1D6FA4' }}>
            🏛️ Informations assurance
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[13px]">
            {iv.assureur?.nom && (
              <CourtierField label="Compagnie d'assurance" value={iv.assureur.nom} />
            )}
            {iv.assureur?.reference_sinistre && (
              <CourtierField label="Référence sinistre" value={iv.assureur.reference_sinistre} mono />
            )}
            {iv.assureur?.reference_police && (
              <CourtierField label="Référence police" value={iv.assureur.reference_police} mono />
            )}
            {iv.assureur?.email && (
              <CourtierField label="Contact assureur" value={iv.assureur.email} mono small />
            )}
            {iv.action_requise && (
              <div className="sm:col-span-2 pt-1 border-t" style={{ borderColor: '#A8C8E0' }}>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1D6FA4' }}>
                  Action requise
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
          <h2 className="text-sm font-bold text-ink mb-3">
            Occupants — {confirmedCount}/{occupants.length} confirmé(s)
          </h2>
          <div className="bg-cream rounded-xl border border-sand-border divide-y divide-sand-mid">
            {occupants.map((o) => {
              const ci = o.conf ? CONF_INFO[o.conf] : CONF_INFO.en_attente;
              return (
                <div key={o.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{o.nom ?? '—'}</div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      Apt. {o.appartement ?? '—'}
                      {o.email ? <> · <span className="font-mono">{o.email}</span></> : null}
                      {o.telephone ? <> · {o.telephone}</> : null}
                    </div>
                  </div>
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
                    style={{ color: ci.fg, background: ci.bg }}
                  >
                    {ci.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Bloc facturation (récap, si renseigné) */}
      {showFacturationBlock && (
        <section>
          <h2 className="text-sm font-bold text-ink mb-3">Facturation</h2>
          <div className="bg-cream border border-sand-border rounded-xl p-4 text-[13px] grid grid-cols-1 sm:grid-cols-2 gap-3">
            {iv.nom_facturation && (
              <div>
                <Label>Destinataire</Label>
                <div className="mt-0.5">{iv.nom_facturation}</div>
              </div>
            )}
            {iv.email_facturation && (
              <div>
                <Label>Email</Label>
                <div className="mt-0.5 font-mono text-xs">{iv.email_facturation}</div>
              </div>
            )}
            {iv.bce_facturation && (
              <div>
                <Label>BCE</Label>
                <div className="mt-0.5 font-mono text-xs">{iv.bce_facturation}</div>
              </div>
            )}
            {iv.ref_bon_commande && (
              <div>
                <Label>Bon de commande</Label>
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
      <h2 className="text-sm font-bold text-ink mb-3">{title}</h2>
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
