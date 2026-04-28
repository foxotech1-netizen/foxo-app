'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadInterventionDocument,
  deleteInterventionDocument,
  getInterventionDocuments,
  type DocumentKind,
  type UploadedDocument,
} from './actions';

const MAX_PDF_MB = 10;

export function DocumentsBlock({ interventionId }: { interventionId: string }) {
  const router = useRouter();
  const [docs, setDocs] = useState<UploadedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    setLoading(true);
    getInterventionDocuments(interventionId).then((d) => {
      if (live) {
        setDocs(d);
        setLoading(false);
      }
    });
    return () => { live = false; };
  }, [interventionId]);

  function findDoc(kind: DocumentKind) {
    return docs.find((d) => d.kind === kind) ?? null;
  }

  async function handleUpload(kind: DocumentKind, file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append('interventionId', interventionId);
    fd.append('kind', kind);
    fd.append('file', file);

    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await uploadInterventionDocument(fd);
        if (res.error) {
          resolve(res.error);
        } else {
          // Recharge la liste
          const fresh = await getInterventionDocuments(interventionId);
          setDocs(fresh);
          router.refresh();
          resolve(null);
        }
      });
    });
  }

  async function handleDelete(kind: DocumentKind) {
    if (!confirm(`Supprimer le ${kind} ?`)) return;
    startTransition(async () => {
      const res = await deleteInterventionDocument(interventionId, kind);
      if (!res.error) {
        const fresh = await getInterventionDocuments(interventionId);
        setDocs(fresh);
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <UploadCard
        title="Rapport d'intervention"
        kind="rapport"
        existing={findDoc('rapport')}
        downloadHref={`/api/rapport/${interventionId}`}
        downloadName={`rapport-${interventionId}.pdf`}
        onUpload={handleUpload}
        onDelete={() => handleDelete('rapport')}
        busy={pending || loading}
        helpText="Uploader un PDF remplace le rapport généré automatiquement. Statut → 'rapport'."
      />
      <UploadCard
        title="Facture"
        kind="facture"
        existing={findDoc('facture')}
        downloadHref={`/api/facture/${interventionId}`}
        downloadName={`facture-${interventionId}.pdf`}
        onUpload={handleUpload}
        onDelete={() => handleDelete('facture')}
        busy={pending || loading}
        helpText="Uploader un PDF remplace la facture émise depuis le drawer Suivi. Statut → 'cloturee'."
      />
    </div>
  );
}

function UploadCard({
  title,
  kind,
  existing,
  downloadHref,
  downloadName,
  onUpload,
  onDelete,
  busy,
  helpText,
}: {
  title: string;
  kind: DocumentKind;
  existing: UploadedDocument | null;
  downloadHref: string;
  downloadName: string;
  onUpload: (kind: DocumentKind, file: File) => Promise<string | null>;
  onDelete: () => void;
  busy: boolean;
  helpText: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  async function startUpload(file: File) {
    setError(null);
    if (file.type && file.type !== 'application/pdf') {
      setError('Seul le format PDF est accepté.');
      return;
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setError(`Trop lourd (max ${MAX_PDF_MB} MB).`);
      return;
    }
    // Indicateur visuel — pas un vrai progress (FormData est uploadé en bloc
    // via Server Action, le progrès n'est pas observable nativement).
    setProgress(0);
    const t = setInterval(() => {
      setProgress((p) => (p === null ? null : Math.min(95, p + 8)));
    }, 80);
    const err = await onUpload(kind, file);
    clearInterval(t);
    setProgress(null);
    if (err) setError(err);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void startUpload(file);
  }

  return (
    <div className="bg-cream rounded-xl px-3.5 py-3 border border-sand-border">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-2">
        {title}
      </div>

      {existing ? (
        <div className="bg-ok-light border border-ok-mid rounded-lg p-2.5 flex items-center gap-2">
          <div className="text-xl">📄</div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-ok truncate">{existing.name}</div>
            <div className="text-[10px] text-ink-muted">
              {(existing.size / 1024).toFixed(0)} KB
              {existing.createdAt
                ? ' · uploadé le ' + new Date(existing.createdAt).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })
                : ''}
            </div>
          </div>
          <a
            href={downloadHref}
            download={downloadName}
            className="text-[11px] text-navy underline-offset-2 hover:underline px-2"
          >Télécharger</a>
          <button
            onClick={onDelete}
            disabled={busy}
            className="text-[11px] text-terra hover:underline disabled:opacity-50"
          >Supprimer</button>
        </div>
      ) : (
        <label
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={
            'block border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ' +
            (dragActive
              ? 'border-navy bg-navy-pale'
              : 'border-sand-border bg-sand hover:bg-sand-hover hover:border-navy-mid')
          }
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void startUpload(f);
            }}
          />
          <div className="text-2xl mb-1">📤</div>
          <div className="text-[12px] font-semibold text-ink mb-0.5">
            {kind === 'rapport' ? 'Uploader un rapport PDF' : 'Uploader une facture PDF'}
          </div>
          <div className="text-[10px] text-ink-muted">
            Glisser-déposer ou cliquer · PDF · max {MAX_PDF_MB} MB
          </div>
        </label>
      )}

      {progress !== null && (
        <div className="mt-2">
          <div className="h-1.5 bg-sand-mid rounded-full overflow-hidden">
            <div
              className="h-full bg-navy transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-ink-muted mt-1">Upload en cours…</p>
        </div>
      )}

      {error && (
        <div className="mt-2 text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-1.5 font-semibold">
          {error}
        </div>
      )}

      <p className="text-[10px] text-ink-muted mt-2 leading-relaxed">{helpText}</p>
    </div>
  );
}
