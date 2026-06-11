'use client';

// Documents du dossier Drive (Mails V2 P2 U4) — lecture seule.
// Liste via GET /api/tech/interventions/{id}/documents ; chaque fichier
// s'ouvre via la route proxy (aperçu inline ou téléchargement décidé
// côté serveur). Même langage visuel que PhotosPanel : carte cream +
// shadow-card, accent --accent-tech, cibles tactiles ≥ 44px.

import { useCallback, useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, File, FolderOpen, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

interface DocFile {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-BE', {
    day: '2-digit', month: 'short', timeZone: 'Europe/Brussels',
  });
}

function FileIcon({ mime }: { mime: string }) {
  if (mime.startsWith('image/')) return <ImageIcon size={16} aria-hidden />;
  if (mime === 'application/pdf') return <FileText size={16} aria-hidden />;
  return <File size={16} aria-hidden />;
}

export function DocumentsPanel({ interventionId }: { interventionId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folderMissing, setFolderMissing] = useState(false);
  const [files, setFiles] = useState<DocFile[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/tech/interventions/${interventionId}/documents`, { cache: 'no-store' });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Chargement des documents impossible.');
        return;
      }
      setFolderMissing(Boolean(data.folderMissing));
      setFiles((data.files ?? []) as DocFile[]);
    } catch {
      setError('Chargement des documents impossible.');
    } finally {
      setLoading(false);
    }
  }, [interventionId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section
      className="bg-[var(--color-cream)] rounded-xl p-4"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
          <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">
            Documents du dossier
          </div>
        </div>
        {!loading && !error && files.length > 0 && (
          <span className="font-sora text-[11px] font-semibold text-[var(--accent-tech)] bg-[var(--color-ok-light)] px-2.5 py-0.5 rounded-full tabular-nums">
            {files.length}
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-2.5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
      )}

      {!loading && error && (
        <div className="text-[12px] bg-[var(--color-terra-light)] text-[var(--color-terra)] border border-[var(--color-terra-mid)] rounded-md px-3 py-2 font-semibold flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-[44px] px-2 inline-flex items-center gap-1.5 text-[12px] font-bold underline"
          >
            <RefreshCw size={13} aria-hidden />
            Réessayer
          </button>
        </div>
      )}

      {!loading && !error && folderMissing && (
        <div className="text-[12px] text-[var(--color-ink-mid)] italic inline-flex items-center gap-1.5">
          <FolderOpen size={14} aria-hidden />
          Aucun dossier Drive pour cette intervention.
        </div>
      )}

      {!loading && !error && !folderMissing && files.length === 0 && (
        <div className="text-[12px] text-[var(--color-ink-mid)] italic">
          Aucun document.
        </div>
      )}

      {!loading && !error && files.length > 0 && (
        <ul className="divide-y divide-[var(--color-sand-mid)]">
          {files.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => window.open(`/api/tech/interventions/${interventionId}/documents/${encodeURIComponent(f.id)}`, '_blank')}
                className="w-full min-h-[44px] py-2 flex items-center gap-2.5 text-left active:opacity-80"
              >
                <span className="text-[var(--color-ink-mid)] flex-shrink-0">
                  <FileIcon mime={f.mimeType} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--color-ink)] truncate">
                    {f.name}
                  </span>
                  <span className="block text-[11px] text-[var(--color-ink-muted)] tabular-nums">
                    {[fmtSize(f.size), fmtDate(f.modifiedTime)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
