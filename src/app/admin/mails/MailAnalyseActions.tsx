'use client';

// Composant qui rend, sous le panel détail d'un mail :
//   - Si pas analysé : bouton "Analyser approfondi" (POST analyse-deep)
//   - Si analysé :
//       * 3 actions 1-clic (Brouillon syndic / Confirmer occupant ▼ / Event Calendar)
//       * Modal SMS
//       * Accordion "Détail analyse"
//
// Reçoit `analyse` depuis MailsClient (ou null). À la fin d'une action,
// rafraîchit l'analyse via callback `onAnalyseRefresh(thread_id)` pour
// que MailsClient remette à jour le state local (badges + boutons).

import { useState } from 'react';
import {
  Sparkles, FileEdit, Phone, Mail as MailIcon, Calendar,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import type { MailAnalyse } from './MailAnalyseTypes';
import { SmsModal } from './SmsModal';
import { ConfirmCreateForm } from './ConfirmCreateForm';

interface Props {
  threadId: string;
  analyse: MailAnalyse | null;
  onAnalyseRefresh: (threadId: string) => Promise<void>;
}

type Toast = { kind: 'ok' | 'err'; msg: string; href?: string } | null;

export function MailAnalyseActions({ threadId, analyse, onAnalyseRefresh }: Props) {
  const [analyseLoading, setAnalyseLoading] = useState(false);
  const [draftSyndicLoading, setDraftSyndicLoading] = useState(false);
  const [draftOccupantLoading, setDraftOccupantLoading] = useState(false);
  const [eventLoading, setEventLoading] = useState(false);
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsModal, setSmsModal] = useState<{ phone: string; body: string } | null>(null);
  const [confirmEventOpen, setConfirmEventOpen] = useState(false);
  const [occupantDropdownOpen, setOccupantDropdownOpen] = useState(false);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  function showToast(t: Toast) {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 4500);
  }

  async function runAnalyseDeep() {
    setAnalyseLoading(true);
    setToast(null);
    try {
      const r = await fetch('/api/admin/mails/analyse-deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId }),
      });
      const data = await r.json();
      if (!data.success) {
        showToast({ kind: 'err', msg: data.error ?? 'Échec analyse.' });
        return;
      }
      await onAnalyseRefresh(threadId);
      const errs: string[] = data.analyse?.errors ?? [];
      if (errs.length > 0) {
        showToast({ kind: 'err', msg: `Analyse OK avec ${errs.length} avertissement(s)` });
      } else {
        showToast({ kind: 'ok', msg: 'Analyse approfondie terminée.' });
      }
    } catch (e) {
      showToast({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setAnalyseLoading(false);
    }
  }

  async function draftReply(target: 'syndic' | 'occupant') {
    if (target === 'syndic') setDraftSyndicLoading(true);
    else setDraftOccupantLoading(true);
    setToast(null);
    try {
      const r = await fetch('/api/admin/mails/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId, target }),
      });
      const data = await r.json();
      if (!data.success) {
        showToast({ kind: 'err', msg: data.error ?? 'Échec brouillon.' });
        return;
      }
      await onAnalyseRefresh(threadId);
      showToast({ kind: 'ok', msg: 'Brouillon créé', href: data.gmail_url });
    } catch (e) {
      showToast({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      if (target === 'syndic') setDraftSyndicLoading(false);
      else setDraftOccupantLoading(false);
    }
  }

  async function openSmsModal() {
    setSmsLoading(true);
    setOccupantDropdownOpen(false);
    setToast(null);
    try {
      const r = await fetch('/api/admin/sms/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId }),
      });
      const data = await r.json();
      if (!data.success) {
        showToast({ kind: 'err', msg: data.error ?? 'Échec préparation SMS.' });
        return;
      }
      setSmsModal({ phone: data.phone as string, body: data.body as string });
    } catch (e) {
      showToast({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSmsLoading(false);
    }
  }

  async function createEvent() {
    setConfirmEventOpen(false);
    setEventLoading(true);
    setToast(null);
    try {
      const r = await fetch('/api/admin/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId }),
      });
      const data = await r.json();
      if (!data.success) {
        showToast({ kind: 'err', msg: data.error ?? 'Échec création event.' });
        return;
      }
      await onAnalyseRefresh(threadId);
      showToast({ kind: 'ok', msg: 'Event créé', href: data.event_url ?? undefined });
    } catch (e) {
      showToast({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setEventLoading(false);
    }
  }

  // ── Rendu ─────────────────────────────────────────────────────────
  if (!analyse) {
    return (
      <div className="px-4 py-3 border-t" style={{ borderColor: 'var(--color-sand-mid)' }}>
        <button
          type="button"
          onClick={runAnalyseDeep}
          disabled={analyseLoading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-[12px] font-bold disabled:opacity-50 min-h-[44px]"
          style={{ background: 'var(--color-navy)', color: 'var(--color-cream)' }}
        >
          <Sparkles size={14} aria-hidden />
          {analyseLoading ? 'Analyse en cours (5-15s)…' : 'Analyser approfondi'}
        </button>
        {toast && <ToastInline toast={toast} />}
      </div>
    );
  }

  const hasSyndic = !!analyse.dossier_match_id;
  const hasCreneau = !!analyse.creneau_propose_id;
  const hasOccupantPhone = !!analyse.occupant_telephone;
  const hasOccupantEmail = !!analyse.occupant_email;
  const dateFmt = analyse.creneau ? formatDateFr(analyse.creneau.date) : null;

  // Cas 2 — analyse existe MAIS pas de dossier matché par analyse-deep.
  // L'admin doit valider/corriger les infos avant la création (analyse-deep
  // est devenu lecture seule depuis le commit 1 du sprint validation).
  // Une fois confirmé via le formulaire, dossier_match_id est set et l'UI
  // bascule sur le cas 1 (3 boutons d'action) au refresh de l'analyse.
  if (analyse.type === 'demande_intervention' && !hasSyndic) {
    return (
      <div className="px-4 py-3 border-t space-y-3" style={{ borderColor: 'var(--color-sand-mid)' }}>
        <ConfirmCreateForm
          threadId={threadId}
          analyse={analyse}
          onConfirmed={onAnalyseRefresh}
        />
        {toast && <ToastInline toast={toast} />}
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t space-y-3" style={{ borderColor: 'var(--color-sand-mid)' }}>
      {/* Boutons d'action */}
      <div className="flex flex-wrap items-center gap-2">
        {hasSyndic && (
          <button
            type="button"
            onClick={() => draftReply('syndic')}
            disabled={draftSyndicLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-bold disabled:opacity-50 min-h-[44px]"
            style={{ background: 'var(--color-cream)', color: 'var(--color-navy)', border: '1px solid var(--color-navy)' }}
          >
            <FileEdit size={14} aria-hidden />
            {draftSyndicLoading ? 'Brouillon…' : 'Brouillon syndic'}
          </button>
        )}

        {hasCreneau && (hasOccupantEmail || hasOccupantPhone) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOccupantDropdownOpen((v) => !v)}
              disabled={draftOccupantLoading || smsLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-bold disabled:opacity-50 min-h-[44px]"
              style={{ background: 'var(--color-cream)', color: 'var(--color-navy)', border: '1px solid var(--color-navy)' }}
              aria-expanded={occupantDropdownOpen}
            >
              <Phone size={14} aria-hidden />
              Confirmer occupant
              <ChevronDown size={12} aria-hidden />
            </button>
            {occupantDropdownOpen && (
              <div
                className="absolute top-full left-0 mt-1 z-20 min-w-[180px] rounded-md overflow-hidden"
                style={{
                  background: 'var(--color-cream)',
                  border: '1px solid var(--color-sand-border)',
                  boxShadow: '0 4px 12px rgba(15,32,64,0.10)',
                }}
                onMouseLeave={() => setOccupantDropdownOpen(false)}
              >
                {hasOccupantEmail && (
                  <button
                    type="button"
                    onClick={() => { setOccupantDropdownOpen(false); draftReply('occupant'); }}
                    className="w-full text-left px-3 py-2 text-[12px] font-semibold inline-flex items-center gap-2 hover:bg-[var(--color-sand-hover)]"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    <MailIcon size={14} aria-hidden />
                    Par mail (brouillon Gmail)
                  </button>
                )}
                {hasOccupantPhone && (
                  <button
                    type="button"
                    onClick={openSmsModal}
                    className="w-full text-left px-3 py-2 text-[12px] font-semibold inline-flex items-center gap-2 hover:bg-[var(--color-sand-hover)]"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    <Phone size={14} aria-hidden />
                    Par SMS (modal)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {hasCreneau && hasSyndic && (
          <button
            type="button"
            onClick={() => setConfirmEventOpen(true)}
            disabled={eventLoading || !!analyse.event_calendar_id}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-bold disabled:opacity-50 min-h-[44px]"
            style={{
              background: analyse.event_calendar_id ? 'var(--color-ok-light)' : 'var(--color-cream)',
              color: analyse.event_calendar_id ? 'var(--color-ok)' : 'var(--color-navy)',
              border: `1px solid ${analyse.event_calendar_id ? 'var(--color-ok-mid)' : 'var(--color-navy)'}`,
            }}
          >
            <Calendar size={14} aria-hidden />
            {eventLoading
              ? 'Création event…'
              : analyse.event_calendar_id
                ? 'Event créé ✓'
                : 'Event Calendar'}
          </button>
        )}
      </div>

      {toast && <ToastInline toast={toast} />}

      {/* Accordion détail analyse */}
      <div
        className="rounded-md overflow-hidden"
        style={{ background: 'var(--color-cream)', border: '1px solid var(--color-sand-border)' }}
      >
        <button
          type="button"
          onClick={() => setAccordionOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-semibold cursor-pointer"
          style={{ color: 'var(--color-ink)' }}
        >
          <span className="inline-flex items-center gap-2">
            Détail analyse
            {analyse.fenetre_etendue && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                style={{ background: 'var(--color-amber-light)', color: 'var(--color-amber-foxo)' }}
              >
                Fenêtre étendue
              </span>
            )}
            {analyse.errors && analyse.errors.length > 0 && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                style={{ background: 'var(--color-amber-light)', color: 'var(--color-amber-foxo)' }}
              >
                <AlertTriangle size={10} aria-hidden />
                {analyse.errors.length} avertissement(s)
              </span>
            )}
          </span>
          {accordionOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
        {accordionOpen && (
          <div className="px-3 pb-3 pt-1 space-y-2 text-[12px]" style={{ color: 'var(--color-ink)' }}>
            {analyse.adresse_extraite && (
              <DetailRow label="Adresse extraite" value={analyse.adresse_extraite} />
            )}
            {analyse.occupant_telephone && (
              <DetailRow label="Téléphone occupant" value={analyse.occupant_telephone} mono />
            )}
            {analyse.occupant_email && (
              <DetailRow label="Email occupant" value={analyse.occupant_email} mono />
            )}
            {analyse.creneau && dateFmt && (
              <DetailRow
                label="Créneau proposé"
                value={`${dateFmt} ${analyse.creneau.heure_debut} → ${analyse.creneau.heure_fin} — ${analyse.creneau.technicien_nom}`}
              />
            )}
            {analyse.resume && (
              <DetailRow label="Résumé IA" value={analyse.resume} />
            )}
            {analyse.errors && analyse.errors.length > 0 && (
              <div
                className="mt-2 p-2 rounded text-[11px]"
                style={{ background: 'var(--color-amber-light)', color: 'var(--color-amber-foxo)' }}
              >
                <div className="font-bold mb-1">Avertissements :</div>
                <ul className="list-disc pl-4 space-y-0.5 m-0">
                  {analyse.errors.map((err, i) => <li key={i}>{err}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm dialog Event */}
      {confirmEventOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmEventOpen(false); }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 32, 64, 0.45)' }}
        >
          <div
            className="w-full max-w-[420px] rounded-[10px] p-5"
            style={{
              background: 'var(--color-cream)',
              boxShadow: '0 12px 32px rgba(15,32,64,0.18)',
            }}
          >
            <h2 className="fxs-block-title m-0 mb-2" style={{ color: 'var(--color-ink)' }}>
              Créer l&apos;event Calendar ?
            </h2>
            <p className="text-[13px] m-0 mb-3" style={{ color: 'var(--color-ink-mid)' }}>
              {dateFmt && analyse.creneau
                ? <>Le créneau du <strong>{dateFmt}</strong> de <strong>{analyse.creneau.heure_debut}</strong> à <strong>{analyse.creneau.heure_fin}</strong> sera réservé pour <strong>{analyse.creneau.technicien_nom}</strong>. L&apos;intervention passera en statut <strong>confirmée</strong>.</>
                : <>Le créneau proposé sera réservé et l&apos;intervention passera en statut confirmée.</>}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmEventOpen(false)}
                className="px-3.5 py-2 rounded-md text-[12px] font-medium"
                style={{
                  background: 'var(--color-cream)',
                  border: '1px solid var(--color-sand-border)',
                  color: 'var(--color-ink-mid)',
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={createEvent}
                className="px-3.5 py-2 rounded-md text-[12px] font-medium"
                style={{ background: 'var(--color-navy)', color: 'var(--color-cream)' }}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal SMS */}
      {smsModal && (
        <SmsModal
          threadId={threadId}
          initialPhone={smsModal.phone}
          initialBody={smsModal.body}
          onClose={() => setSmsModal(null)}
          onSent={() => {
            setSmsModal(null);
            showToast({ kind: 'ok', msg: 'SMS envoyé' });
          }}
        />
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--color-ink-muted)', minWidth: 110 }}>
        {label}
      </span>
      <span className={mono ? 'font-mono text-[12px]' : 'text-[12px]'}>{value}</span>
    </div>
  );
}

function ToastInline({ toast }: { toast: NonNullable<Toast> }) {
  const isOk = toast.kind === 'ok';
  return (
    <div
      className="px-3 py-2 rounded-md text-[12px] font-medium inline-flex items-center gap-2"
      style={{
        background: isOk ? 'var(--color-ok-light)' : 'var(--color-terra-light)',
        border: `1px solid ${isOk ? 'var(--color-ok-mid)' : 'var(--color-terra-mid)'}`,
        color: isOk ? 'var(--color-ok)' : 'var(--color-terra)',
      }}
    >
      {isOk ? <CheckCircle2 size={14} aria-hidden /> : <AlertTriangle size={14} aria-hidden />}
      {toast.msg}
      {toast.href && (
        <a
          href={toast.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:no-underline"
          style={{ color: 'inherit' }}
        >
          Ouvrir
        </a>
      )}
    </div>
  );
}

function formatDateFr(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
}
