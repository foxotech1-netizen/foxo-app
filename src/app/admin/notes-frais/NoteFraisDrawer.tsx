'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CategorieNoteFrais, NoteFrais, StatutNoteFrais } from '@/lib/types/database';
import { deleteNoteFrais, updateStatutNoteFrais } from './actions';

const CATEGORIE_LABEL: Record<CategorieNoteFrais, string> = {
  carburant:      'Carburant',
  materiel:       'Matériel',
  outillage:      'Outillage',
  transport:      'Transport',
  restauration:   'Restauration',
  fournitures:    'Fournitures',
  sous_traitance: 'Sous-traitance',
  autre:          'Autre',
};

const STATUT_BADGE: Record<StatutNoteFrais, { fg: string; bg: string; label: string }> = {
  brouillon:  { fg: '#6B6558', bg: '#EDEAE3', label: 'Brouillon'  },
  soumise:    { fg: '#1B3A6B', bg: '#D6E4F7', label: 'Soumise'    },
  approuvee:  { fg: '#1F6B45', bg: '#D4EDE2', label: 'Approuvée'  },
  rejetee:    { fg: '#C4622D', bg: '#F7EDE5', label: 'Rejetée'    },
  remboursee: { fg: '#7C3AED', bg: '#F5F3FF', label: 'Remboursée' },
};

type Tab = 'infos' | 'photo' | 'workflow';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Ordre des transitions disponibles selon le statut courant. Une note
// remboursée n'a plus de transition → bouton "fermé" affiché.
function nextTransitions(s: StatutNoteFrais): { to: StatutNoteFrais; label: string; color: string }[] {
  switch (s) {
    case 'brouillon':
      return [{ to: 'soumise', label: '📤 Soumettre', color: 'navy' }];
    case 'soumise':
      return [
        { to: 'approuvee', label: '✅ Approuver', color: 'ok' },
        { to: 'rejetee',   label: '❌ Rejeter',   color: 'terra' },
      ];
    case 'approuvee':
      return [{ to: 'remboursee', label: '💸 Rembourser', color: 'navy' }];
    case 'rejetee':
      return [{ to: 'brouillon', label: '🔄 Remettre en brouillon', color: 'navy' }];
    case 'remboursee':
      return [];
  }
}

export function NoteFraisDrawer({
  note,
  onClose,
  onUpdate,
}: {
  note: NoteFrais;
  onClose: () => void;
  onUpdate?: (patch: Partial<NoteFrais>) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('infos');
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [noteAdmin, setNoteAdmin] = useState(note.note_admin ?? '');

  const badge = STATUT_BADGE[note.statut];

  async function transitionStatut(to: StatutNoteFrais) {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await updateStatutNoteFrais(note.id, to, noteAdmin || undefined);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      const patch: Partial<NoteFrais> = {
        statut: to,
        note_admin: noteAdmin || null,
      };
      if (to === 'approuvee') patch.approved_at = new Date().toISOString();
      onUpdate?.(patch);
      setFeedback({ kind: 'ok', msg: `Statut mis à jour → ${STATUT_BADGE[to].label}.` });
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Supprimer cette note de frais ? (soft-delete réversible)')) return;
    setSaving(true);
    try {
      const res = await deleteNoteFrais(note.id);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur.' });
    } finally {
      setSaving(false);
    }
  }

  async function handleExtract() {
    setExtracting(true);
    setFeedback(null);
    try {
      const r = await fetch('/api/admin/notes-frais/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: note.id }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Erreur extraction.' });
        return;
      }
      const updated = data.data as NoteFrais;
      // Propage uniquement les champs modifiés au parent.
      onUpdate?.({
        ia_raw:        updated.ia_raw,
        ia_confiance:  updated.ia_confiance,
        montant_htva:  updated.montant_htva,
        taux_tva:      updated.taux_tva,
        montant_ttc:   updated.montant_ttc,
        fournisseur:   updated.fournisseur,
        date_depense:  updated.date_depense,
        description:   updated.description,
      });
      setFeedback({ kind: 'ok', msg: `Extraction réussie ✓ (confiance ${Math.round((updated.ia_confiance ?? 0) * 100)}%)` });
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setExtracting(false);
    }
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside className="fixed right-0 top-0 h-full w-full max-w-md bg-cream shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <header className="border-b border-sand-border px-5 py-3 flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">
              Note de frais
            </div>
            <h2 className="text-[14px] font-extrabold text-ink mt-0.5 truncate">
              {note.titre}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink text-[18px] leading-none px-2"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>

        {/* Tabs */}
        <div className="flex border-b border-sand-border">
          {(['infos', 'photo', 'workflow'] as Tab[]).map((t) => {
            const active = tab === t;
            const label = t === 'infos' ? 'Infos' : t === 'photo' ? 'Photo / IA' : 'Workflow';
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  'flex-1 px-3 py-2.5 text-[12px] font-bold border-b-2 transition-colors ' +
                  (active
                    ? 'bg-cream border-navy text-navy'
                    : 'border-transparent text-ink-muted hover:text-ink')
                }
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'infos' && (
            <>
              <div>
                <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1">
                  Catégorie
                </div>
                <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-sand-mid text-ink-mid">
                  {CATEGORIE_LABEL[note.categorie]}
                </span>
              </div>

              {note.fournisseur && (
                <Field label="Fournisseur" value={note.fournisseur} />
              )}

              <Field label="Date de la dépense" value={fmtDate(note.date_depense)} mono />

              <div className="bg-sand rounded-lg p-3 space-y-1">
                <Money label="HTVA" value={note.montant_htva} />
                <Money label={`TVA (${note.taux_tva}%)`} value={note.montant_ttc - note.montant_htva} />
                <div className="border-t border-sand-border pt-1 mt-1">
                  <Money label="TTC" value={note.montant_ttc} bold />
                </div>
              </div>

              {note.intervention_id && (
                <div>
                  <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1">
                    Intervention liée
                  </div>
                  <Link
                    href={`/admin/?intervention=${note.intervention_id}`}
                    className="text-[12px] text-navy hover:underline font-mono"
                  >
                    {note.intervention_id.slice(0, 8)}…
                  </Link>
                </div>
              )}

              {note.description && (
                <Field label="Description" value={note.description} />
              )}

              <div className="text-[10px] text-ink-muted pt-2 border-t border-sand-border">
                Créée par {note.technicien_nom ?? note.technicien_email}
                {' · '}
                <span className="font-mono">{fmtDate(note.created_at)}</span>
              </div>
            </>
          )}

          {tab === 'photo' && (
            <>
              {note.photo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={note.photo_url}
                  alt="ticket"
                  className="max-h-64 rounded-lg border border-sand-border w-full object-contain bg-white"
                />
              ) : (
                <div className="bg-sand rounded-lg p-4 text-[12px] text-ink-muted text-center">
                  Aucune photo — à uploader depuis l&apos;app tech.
                </div>
              )}

              <div>
                <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-2">
                  Extraction IA
                </div>

                {note.ia_raw ? (
                  <div className="bg-sand rounded-lg p-3 space-y-2">
                    <ConfidenceBadge value={note.ia_confiance ?? 0} />
                    <pre className="text-[10px] font-mono whitespace-pre-wrap text-ink-mid overflow-x-auto">
                      {JSON.stringify(note.ia_raw, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-muted italic">
                    Aucune extraction encore lancée.
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={extracting || !note.photo_url}
                  className="w-full mt-3 bg-navy text-white px-3 py-2 rounded-md text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {extracting ? 'Extraction en cours…' : note.ia_raw ? '🔍 Re-extraire' : '🔍 Extraire'}
                </button>
              </div>
            </>
          )}

          {tab === 'workflow' && (
            <>
              <div>
                <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1">
                  Statut actuel
                </div>
                <span
                  className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                  style={{ color: badge.fg, background: badge.bg }}
                >
                  {badge.label}
                </span>
                {note.approved_at && (
                  <div className="text-[10px] text-ink-muted mt-1">
                    Approuvée le {fmtDate(note.approved_at)}
                    {note.approved_by && <> par <span className="font-mono">{note.approved_by}</span></>}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold text-ink-muted uppercase tracking-widest block mb-1">
                  Note admin
                </label>
                <textarea
                  value={noteAdmin}
                  onChange={(e) => setNoteAdmin(e.target.value)}
                  rows={3}
                  placeholder="Optionnel — motif rejet, contexte remboursement…"
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[12px] bg-white outline-none focus:border-navy-mid resize-y"
                />
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">
                  Transitions
                </div>
                {nextTransitions(note.statut).length === 0 ? (
                  <p className="text-[11px] text-ink-muted italic">
                    Aucune transition disponible — note remboursée.
                  </p>
                ) : (
                  nextTransitions(note.statut).map((t) => (
                    <button
                      key={t.to}
                      type="button"
                      onClick={() => transitionStatut(t.to)}
                      disabled={saving}
                      className={
                        'w-full px-3 py-2 rounded-md text-[12px] font-bold text-white hover:opacity-90 disabled:opacity-50 ' +
                        (t.color === 'ok'
                          ? 'bg-ok'
                          : t.color === 'terra'
                            ? 'bg-terra'
                            : 'bg-navy')
                      }
                    >
                      {saving ? '…' : t.label}
                    </button>
                  ))
                )}
              </div>

              <div className="border-t border-sand-border pt-4">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="w-full px-3 py-2 rounded-md text-[12px] font-bold text-terra border border-terra-mid bg-terra-light hover:opacity-80 disabled:opacity-50"
                >
                  🗑 Supprimer (soft-delete)
                </button>
              </div>
            </>
          )}
        </div>

        {/* Feedback toast (footer) */}
        {feedback && (
          <div
            className={
              'border-t px-5 py-3 text-[11px] font-semibold ' +
              (feedback.kind === 'ok'
                ? 'bg-ok-light border-ok-mid text-ok'
                : 'bg-terra-light border-terra-mid text-terra')
            }
          >
            {feedback.msg}
          </div>
        )}
      </aside>
    </>
  );
}

// ─── Sous-composants utilitaires ───────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-0.5">
        {label}
      </div>
      <div className={'text-[12px] text-ink ' + (mono ? 'font-mono' : '')}>
        {value}
      </div>
    </div>
  );
}

function Money({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className={'text-[11px] ' + (bold ? 'font-bold text-ink' : 'text-ink-mid')}>
        {label}
      </span>
      <span className={'font-mono ' + (bold ? 'text-[14px] font-bold text-ink' : 'text-[12px] text-ink-mid')}>
        {value.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
      </span>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value > 0.8 ? 'ok' : value >= 0.5 ? 'amber' : 'terra';
  const cls = color === 'ok'
    ? 'bg-ok-light border-ok-mid text-ok'
    : color === 'amber'
      ? 'bg-amber-light border-[#E8C896] text-[#8A5A1A]'
      : 'bg-terra-light border-terra-mid text-terra';
  return (
    <span className={'inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ' + cls}>
      Confiance {pct}%
    </span>
  );
}
