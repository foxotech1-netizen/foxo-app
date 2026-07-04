'use client';

// Liste des factures d'achat : filtres statut (chips), badges doublon +
// pastille de confiance IA, modale d'upload (capture) et saisie manuelle.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Eye, Inbox, Plus, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { FactureAchat, StatutFactureAchat } from '@/lib/types/database';
import { createFactureAchatManuelle, deleteFactureAchat, releverBoiteCapture } from './actions';

export type FactureAchatRow = FactureAchat & {
  intervention_ref: string | null;
  fournisseur_fiche_nom: string | null;
};

type StatutChip = 'tous' | StatutFactureAchat;
const CHIPS: { key: StatutChip; label: string }[] = [
  { key: 'tous',      label: 'Toutes'     },
  { key: 'a_valider', label: 'À valider'  },
  { key: 'a_payer',   label: 'À payer'    },
  { key: 'payee',     label: 'Payées'     },
  { key: 'rejetee',   label: 'Rejetées'   },
];

export const STATUT_ACHAT_INFO: Record<StatutFactureAchat, { label: string; cls: string }> = {
  a_valider: { label: 'À valider', cls: 'bg-amber-light text-[#8A5A1A] border-[#E8C896]' },
  a_payer:   { label: 'À payer',   cls: 'bg-navy-pale text-navy border-navy-light dark:text-white' },
  payee:     { label: 'Payée',     cls: 'bg-ok-light text-ok border-ok-mid' },
  rejetee:   { label: 'Rejetée',   cls: 'bg-terra-light text-terra border-terra-mid' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Pastille de confiance IA : vert ≥ 0.8, orange ≥ 0.55, rouge sinon.
export function ConfianceDot({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[10px] text-ink-muted">—</span>;
  const color = value >= 0.8 ? '#3E7C4F' : value >= 0.55 ? '#B8830A' : '#C4622D';
  return (
    <span className="inline-flex items-center gap-1" title={`Confiance IA : ${(value * 100).toFixed(0)} %`}>
      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-mono text-ink-mid">{(value * 100).toFixed(0)}%</span>
    </span>
  );
}

export function DoublonBadge() {
  return (
    <span className="inline-block text-[9px] font-bold uppercase tracking-wider text-[#8A5A1A] bg-amber-light border border-[#E8C896] rounded px-1.5 py-0.5">
      Doublon ?
    </span>
  );
}

export function AchatsListClient({
  initial,
  captureAlias = '',
}: {
  initial: FactureAchatRow[];
  /** Alias email de capture (parametres) — vide = relève désactivée. */
  captureAlias?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chip, setChip] = useState<StatutChip>('tous');
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [releve, setReleve] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [toDelete, setToDelete] = useState<FactureAchatRow | null>(null);
  const [preview, setPreview] = useState<FactureAchatRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fermeture de l'aperçu à Échap.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  function handleDelete() {
    if (!toDelete) return;
    setToast(null);
    startTransition(async () => {
      const res = await deleteFactureAchat(toDelete.id);
      setToDelete(null);
      if (!res.ok) { setToast({ kind: 'err', msg: res.error }); return; }
      setToast({ kind: 'ok', msg: 'Facture d\'achat supprimée (justificatif conservé sur Drive).' });
      router.refresh();
    });
  }

  function handleReleve() {
    setToast(null);
    setReleve(true);
    void (async () => {
      try {
        const res = await releverBoiteCapture();
        if (!res.ok) {
          setToast({ kind: 'err', msg: res.error });
          return;
        }
        const d = res.data!;
        setToast({
          kind: 'ok',
          msg: `Relève terminée : ${d.messages_vus} message(s) vu(s), ${d.pieces_importees} pièce(s) importée(s)`
            + `${d.doublons > 0 ? `, ${d.doublons} doublon(s) suspecté(s)` : ''}`
            + `${d.erreurs > 0 ? `, ${d.erreurs} erreur(s)` : ''}`
            + `${d.limite_atteinte ? ' — plafond atteint, relance pour continuer.' : '.'}`,
        });
        router.refresh();
      } catch (e) {
        setToast({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur relève.' });
      } finally {
        setReleve(false);
      }
    })();
  }

  const filtered = useMemo(
    () => (chip === 'tous' ? initial : initial.filter((f) => f.statut === chip)),
    [initial, chip],
  );

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('fichier', file);
      const res = await fetch('/api/admin/achats/upload', { method: 'POST', body: fd });
      const json = (await res.json()) as {
        ok: boolean; error?: string; facture_achat_id?: string;
      };
      if (!json.ok || !json.facture_achat_id) {
        setUploadError(json.error ?? `Erreur HTTP ${res.status}.`);
        return;
      }
      router.push(`/admin/facturation/achats/${json.facture_achat_id}`);
      router.refresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setUploading(false);
    }
  }

  function handleSaisieManuelle() {
    startTransition(async () => {
      const res = await createFactureAchatManuelle();
      if (!res.ok) {
        setUploadError(res.error);
        return;
      }
      router.push(`/admin/facturation/achats/${res.data!.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              className={
                'px-3 py-1.5 rounded-full text-[11px] font-bold border ' +
                (chip === c.key
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid')
              }
            >
              {c.label}
              <span className="ml-1 font-mono">
                {c.key === 'tous' ? initial.length : initial.filter((f) => f.statut === c.key).length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/facturation/achats/regles"
            className="bg-white text-navy border border-navy-light px-3.5 py-2 rounded-lg text-[12px] font-bold hover:bg-navy-pale inline-flex items-center gap-1.5 min-h-[40px]"
          >
            <SlidersHorizontal size={14} aria-hidden /> Règles de mapping
          </Link>
          <button
            type="button"
            onClick={handleReleve}
            disabled={releve || !captureAlias}
            title={captureAlias
              ? `Recherche les factures transférées à ${captureAlias} (60 derniers jours) et les importe.`
              : 'Alias de capture non configuré — renseigne-le dans Paramètres → Capture de dépenses.'}
            className="bg-white text-navy border border-navy-light px-3.5 py-2 rounded-lg text-[12px] font-bold hover:bg-navy-pale inline-flex items-center gap-1.5 min-h-[40px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Inbox size={14} aria-hidden className={releve ? 'animate-pulse' : undefined} />
            {releve ? 'Relève en cours…' : 'Relever la boîte de capture'}
          </button>
          <button
            type="button"
            onClick={() => { setShowUpload(true); setUploadError(null); }}
            className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center gap-1.5 min-h-[40px]"
          >
            <Plus size={14} aria-hidden /> Ajouter une facture
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={
            'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (toast.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra')
          }
        >
          {toast.msg}
        </div>
      )}

      {uploadError && !showUpload && (
        <div className="text-[12px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 font-semibold">
          {uploadError}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-14 text-ink-muted text-[13px] bg-cream rounded-xl border border-sand-border">
          Aucune facture d&apos;achat {chip !== 'tous' ? 'pour ce filtre' : 'pour l’instant'}.
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="text-navy font-bold underline hover:no-underline text-[12px]"
            >
              Capturer une première facture
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-cream rounded-xl border border-sand-border overflow-x-auto">
          <table className="w-full text-left min-w-[860px]">
            <thead>
              <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted">
                <th className="px-3.5 py-2.5 font-bold">Fournisseur</th>
                <th className="px-3.5 py-2.5 font-bold">N° pièce</th>
                <th className="px-3.5 py-2.5 font-bold">Date</th>
                <th className="px-3.5 py-2.5 font-bold">Échéance</th>
                <th className="px-3.5 py-2.5 font-bold text-right">TTC</th>
                <th className="px-3.5 py-2.5 font-bold">Dossier</th>
                <th className="px-3.5 py-2.5 font-bold">Statut</th>
                <th className="px-3.5 py-2.5 font-bold">Confiance</th>
                <th className="px-3.5 py-2.5 font-bold text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => {
                const info = STATUT_ACHAT_INFO[f.statut];
                return (
                  <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover">
                    <td className="px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => setPreview(f)}
                        title="Aperçu rapide"
                        className="text-ink-muted hover:text-navy p-1 mr-1 align-middle"
                      >
                        <Eye size={14} aria-hidden />
                      </button>
                      <Link href={`/admin/facturation/achats/${f.id}`} className="text-xs font-bold text-navy hover:underline">
                        {f.fournisseur_fiche_nom ?? f.fournisseur_nom ?? <span className="italic text-ink-muted">Sans fournisseur</span>}
                      </Link>
                      {f.doublon_de_id && (
                        <span className="ml-1.5"><DoublonBadge /></span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid">{f.numero_piece ?? '—'}</td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid whitespace-nowrap">{fmtDate(f.date_facture)}</td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid whitespace-nowrap">{fmtDate(f.date_echeance)}</td>
                    <td className="px-3.5 py-2.5 text-[12px] font-mono font-bold text-right whitespace-nowrap dark:text-white">{fmtMoney(f.montant_ttc)}</td>
                    <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid">{f.intervention_ref ?? '—'}</td>
                    <td className="px-3.5 py-2.5">
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ${info.cls}`}>
                        {info.label}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5"><ConfianceDot value={f.ia_confiance_min} /></td>
                    <td className="px-3.5 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => setToDelete(f)}
                        disabled={pending}
                        title="Supprimer cette facture d'achat (le justificatif reste sur Drive)."
                        className="text-ink-muted hover:text-terra p-1 disabled:opacity-50"
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Aperçu rapide d'un achat : champs clés + justificatif Drive */}
      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Aperçu facture d'achat"
        >
          <div
            className="bg-cream rounded-2xl border border-sand-border w-full max-w-[860px] h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-sand-border flex-shrink-0">
              <div className="text-[13px] font-bold text-ink truncate">
                Achat — {preview.fournisseur_fiche_nom ?? preview.fournisseur_nom ?? 'Sans fournisseur'}
                {preview.numero_piece ? ` · ${preview.numero_piece}` : ''}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/facturation/achats/${preview.id}`}
                  className="bg-navy text-white px-3 py-1.5 rounded-lg text-[11px] font-bold hover:opacity-90 inline-flex items-center gap-1"
                >
                  <ExternalLink size={12} aria-hidden /> Ouvrir la fiche
                </Link>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="text-ink-muted hover:text-ink p-1"
                  aria-label="Fermer"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-md border ${STATUT_ACHAT_INFO[preview.statut].cls}`}>
                  {STATUT_ACHAT_INFO[preview.statut].label}
                </span>
                {preview.doublon_de_id && <DoublonBadge />}
                <ConfianceDot value={preview.ia_confiance_min} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                <div><span className="text-[10px] font-bold text-ink-muted uppercase block">Date</span><span className="font-mono">{fmtDate(preview.date_facture)}</span></div>
                <div><span className="text-[10px] font-bold text-ink-muted uppercase block">Échéance</span><span className="font-mono">{fmtDate(preview.date_echeance)}</span></div>
                <div><span className="text-[10px] font-bold text-ink-muted uppercase block">HT</span><span className="font-mono">{fmtMoney(preview.montant_ht)}</span></div>
                <div><span className="text-[10px] font-bold text-ink-muted uppercase block">TTC</span><span className="font-mono font-bold">{fmtMoney(preview.montant_ttc)}</span></div>
              </div>
              {preview.lignes.length > 0 && (
                <div className="bg-white border border-sand-border rounded-lg p-2.5">
                  <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-1">Lignes</div>
                  <ul className="text-[11px] text-ink-mid space-y-0.5">
                    {preview.lignes.map((l, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">{l.description}</span>
                        <span className="font-mono whitespace-nowrap">{l.montant != null ? fmtMoney(l.montant) : '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.justificatif_drive_id ? (
                <div className="space-y-1.5">
                  {/* Embed Drive best-effort — si l'iframe ne charge pas
                      (droits, réseau), le lien direct reste juste dessous. */}
                  <iframe
                    src={`https://drive.google.com/file/d/${preview.justificatif_drive_id}/preview`}
                    title="Justificatif Drive"
                    className="w-full h-[45vh] bg-white border border-sand-border rounded-lg"
                    allow="autoplay"
                  />
                  {preview.justificatif_url && (
                    <a
                      href={preview.justificatif_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-navy font-semibold underline hover:no-underline inline-flex items-center gap-1"
                    >
                      <ExternalLink size={12} aria-hidden /> Ouvrir le justificatif dans Drive
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-ink-muted italic">Aucun justificatif (saisie manuelle).</p>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title={`Supprimer la facture d'achat ${toDelete?.fournisseur_nom ?? toDelete?.numero_piece ?? ''} ?`}
        message={
          'Le justificatif reste archivé sur Drive.'
          + (toDelete?.statut === 'payee'
            ? ' ⚠️ Cette facture est marquée PAYÉE — sa suppression la retire des coûts et du tableau de bord.'
            : '')
        }
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />

      {/* Modale d'upload */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-cream rounded-2xl border border-sand-border p-5 w-full max-w-[440px] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-ink">Capturer une facture d&apos;achat</h2>
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                disabled={uploading}
                className="text-ink-muted hover:text-ink disabled:opacity-40"
                aria-label="Fermer"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <p className="text-[12px] text-ink-mid">
              PDF ou photo (jpg, png, webp). Le justificatif part sur Drive, puis
              l&apos;IA pré-remplit la facture — tu vérifies et valides ensuite.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
              className="w-full text-[12px] file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-navy file:text-white file:text-[12px] file:font-bold file:cursor-pointer"
            />
            {uploading && (
              <div className="flex items-center gap-2 text-[12px] text-ink-mid font-semibold">
                <Upload size={14} className="animate-pulse" aria-hidden />
                Upload + extraction en cours… (jusqu&apos;à ~1 min)
              </div>
            )}
            {uploadError && (
              <div className="text-[12px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 font-semibold">
                {uploadError}
              </div>
            )}
            <div className="border-t border-sand-border pt-3 text-[12px]">
              <button
                type="button"
                onClick={handleSaisieManuelle}
                disabled={uploading || pending}
                className="text-navy underline hover:no-underline font-semibold disabled:opacity-50"
              >
                {pending ? 'Création…' : 'Ou saisie manuelle (sans document)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
