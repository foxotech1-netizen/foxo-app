'use client';

import { useEffect, useState } from 'react';
import {
  ExternalLink,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react';

// Panneau « Documents du dossier » (Mails V2 P2 — U4). Contrairement à
// PhotosPanel (données passées par le server component), la liste est
// chargée APRÈS le rendu de la page : la latence Drive ne doit pas
// ralentir l'ouverture de la fiche.

type DocFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; folderId: string | null; files: DocFile[] };

// Aligné sur la borne de la route proxy : au-delà, l'aperçu renverrait un
// 413 — on envoie directement vers Drive.
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

function fileIcon(mime: string): LucideIcon {
  if (mime.startsWith('image/')) return FileImage;
  if (mime === 'application/pdf' || mime.startsWith('text/plain')) return FileText;
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return FileText;
  if (mime.includes('spreadsheetml') || mime.includes('ms-excel') || mime === 'text/csv') return FileSpreadsheet;
  if (mime === 'application/zip') return FileArchive;
  return File;
}

function fmtSize(n: number | null): string | null {
  if (n == null) return null;
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function DocumentsPanel({ interventionId }: { interventionId: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  // Incrémenté par « Réessayer » pour relancer l'effet de chargement.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/tech/interventions/${interventionId}/documents`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setState({ kind: 'error', message: data.error ?? 'Impossible de charger les documents.' });
          return;
        }
        setState({ kind: 'ready', folderId: data.folderId ?? null, files: (data.files as DocFile[]) ?? [] });
      } catch {
        if (cancelled) return;
        setState({ kind: 'error', message: 'Réseau indisponible — impossible de charger les documents.' });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [interventionId, reloadKey]);

  // ─── Chargement (skeleton) ───────────────────────────────────────────
  if (state.kind === 'loading') {
    return (
      <div className="space-y-2 animate-pulse" aria-label="Chargement des documents">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 min-h-[48px] px-1">
            <div className="w-8 h-8 rounded-md bg-[var(--color-sand-mid)] shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 rounded bg-[var(--color-sand-mid)] w-3/4" />
              <div className="h-2.5 rounded bg-[var(--color-sand-mid)] w-2/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── Erreur ──────────────────────────────────────────────────────────
  if (state.kind === 'error') {
    return (
      <div className="text-[12px] text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-md px-3 py-2 flex items-center justify-between gap-3">
        <span className="font-semibold">{state.message}</span>
        <button
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            setReloadKey((k) => k + 1);
          }}
          className="shrink-0 text-[12px] font-semibold underline hover:no-underline min-h-[44px] px-1"
        >
          Réessayer
        </button>
      </div>
    );
  }

  // ─── Vide ────────────────────────────────────────────────────────────
  if (state.folderId === null) {
    return (
      <p className="text-[13px] text-[var(--color-ink-mid)] leading-relaxed">
        Dossier Drive non encore créé — les documents apparaîtront ici dès que
        le dossier de l&apos;intervention existera.
      </p>
    );
  }
  if (state.files.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-ink-mid)] leading-relaxed">
        Aucun document dans le dossier pour le moment.
      </p>
    );
  }

  // ─── Liste ───────────────────────────────────────────────────────────
  return (
    <div className="divide-y divide-[var(--color-sand-mid)]">
      {state.files.map((f) => {
        const Icon = fileIcon(f.mimeType);
        const size = fmtSize(f.size);
        const date = fmtDate(f.modifiedTime);
        // Aperçu via la route proxy : images (hors SVG) et PDF, sous la
        // borne de taille. Sinon : Drive si lien dispo, sinon la même
        // route proxy (qui servira le fichier en téléchargement).
        const previewable =
          ((f.mimeType.startsWith('image/') && f.mimeType !== 'image/svg+xml') || f.mimeType === 'application/pdf')
          && (f.size == null || f.size <= MAX_PREVIEW_BYTES);
        const proxyHref = `/api/tech/interventions/${interventionId}/documents/${f.id}`;
        const useDrive = !previewable && f.webViewLink != null;
        const href = previewable ? proxyHref : (f.webViewLink ?? proxyHref);

        return (
          <a
            key={f.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 py-2.5 min-h-[48px] first:pt-0 last:pb-0 active:opacity-70 transition-opacity"
          >
            <span className="w-8 h-8 rounded-md bg-[var(--color-sand-mid)] text-[var(--accent-tech)] inline-flex items-center justify-center shrink-0">
              <Icon size={16} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold text-[var(--color-ink)] truncate">{f.name}</span>
              <span className="block text-[12px] text-[var(--color-ink-mid)] mt-0.5">
                {[size, date].filter(Boolean).join(' · ') || '—'}
              </span>
            </span>
            {useDrive && (
              <span className="shrink-0 text-[12px] font-semibold text-[var(--accent-tech)] inline-flex items-center gap-1">
                <ExternalLink size={13} />
                Drive
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
