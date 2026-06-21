'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Send, WifiOff } from 'lucide-react';
import { compressImage } from '@/lib/images/compress-image';

export type Photo = { name: string; url: string; createdAt: string | null };

// ─── IndexedDB queue offline ─────────────────────────────────────────────
//
// Stocke les fichiers à uploader quand le réseau revient. Une seule store
// `queue` clé auto-incrémentée. Schéma simple, pas de migrations.

const DB_NAME = 'foxo-photos';
const STORE = 'queue';
const DB_VERSION = 1;

interface QueueEntry {
  id?: number;
  intervention_id: string;
  filename: string;
  type: string;
  blob: Blob;
  added_at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAdd(entry: Omit<QueueEntry, 'id' | 'added_at'>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ ...entry, added_at: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queueList(interventionId?: string): Promise<QueueEntry[]> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = (req.result as QueueEntry[]) ?? [];
      resolve(interventionId ? all.filter((e) => e.intervention_id === interventionId) : all);
    };
    req.onerror = () => resolve([]);
  });
}

async function queueRemove(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ─── Upload Drive via API ────────────────────────────────────────────────

async function uploadToDrive(interventionId: string, file: File | Blob, filename: string, type: string): Promise<{ ok: boolean; drive_url?: string; error?: string }> {
  const fd = new FormData();
  // Repackage Blob en File pour préserver le filename côté server
  const f = file instanceof File ? file : new File([file], filename, { type });
  const compressed = await compressImage(f);
  fd.append('file', compressed);
  fd.append('intervention_id', interventionId);
  try {
    const res = await fetch('/api/tech/upload-photo', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.error ?? 'Erreur upload.' };
    return { ok: true, drive_url: data.drive_url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Réseau indisponible.' };
  }
}

// ─── Composant ────────────────────────────────────────────────────────────

export function PhotosPanel({
  interventionId,
  initialPhotos,
}: {
  interventionId: string;
  initialPhotos: Photo[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [queueCount, setQueueCount] = useState(0);
  const [online, setOnline] = useState<boolean>(true);

  // État réseau + drain de la queue à chaque retour online
  useEffect(() => {
    function refreshQueue() {
      queueList(interventionId).then((q) => setQueueCount(q.length));
    }
    function onOnline() {
      setOnline(true);
      drainQueue();
    }
    function onOffline() {
      setOnline(false);
    }
    if (typeof window !== 'undefined') {
      setOnline(navigator.onLine);
      refreshQueue();
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interventionId]);

  async function drainQueue() {
    const items = await queueList(interventionId);
    if (items.length === 0) return;
    setError(null);
    setUploading(true);
    let done = 0;
    setProgress({ done: 0, total: items.length });
    for (const it of items) {
      const r = await uploadToDrive(interventionId, it.blob, it.filename, it.type);
      if (r.ok && it.id != null) {
        await queueRemove(it.id);
        if (r.drive_url) {
          setPhotos((cur) => [{ name: it.filename, url: r.drive_url!, createdAt: new Date().toISOString() }, ...cur]);
        }
      }
      done++;
      setProgress({ done, total: items.length });
    }
    setUploading(false);
    setQueueCount(await queueList(interventionId).then((q) => q.length));
    router.refresh();
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    setProgress({ done: 0, total: files.length });

    let done = 0;
    for (const file of files) {
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase();
      const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(0, 80) || `photo${ext}`;
      const filename = safe;

      if (!navigator.onLine) {
        // Pas de réseau → on enqueue et on continue
        try {
          await queueAdd({
            intervention_id: interventionId,
            filename,
            type: file.type || 'image/jpeg',
            blob: file,
          });
        } catch (e) {
          setError('Échec ajout à la file offline : ' + (e instanceof Error ? e.message : ''));
        }
      } else {
        const r = await uploadToDrive(interventionId, file, filename, file.type);
        if (r.ok && r.drive_url) {
          setPhotos((cur) => [{ name: filename, url: r.drive_url!, createdAt: new Date().toISOString() }, ...cur]);
        } else if (!r.ok) {
          // Fallback offline si l'upload réseau a échoué
          await queueAdd({
            intervention_id: interventionId,
            filename,
            type: file.type || 'image/jpeg',
            blob: file,
          });
          setError(r.error ?? 'Upload échoué — photo mise en file.');
        }
      }
      done++;
      setProgress({ done, total: files.length });
    }

    setQueueCount(await queueList(interventionId).then((q) => q.length));
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  return (
    <section
      className="bg-[var(--color-cream)] rounded-xl p-4"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
          <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">
            Photos terrain
          </div>
        </div>
        <span
          className="font-sora text-[11px] font-semibold text-[var(--accent-tech)] bg-[var(--color-ok-light)] px-2.5 py-0.5 rounded-full"
        >
          {photos.length}
        </span>
      </div>

      {!online && (
        <div className="text-[12px] bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)] border border-[var(--color-amber-foxo)]/30 rounded-md px-3 py-2 mb-3 font-semibold inline-flex items-center gap-1.5">
          <WifiOff size={13} />Hors ligne — les photos seront uploadées automatiquement au retour du réseau.
        </div>
      )}

      {queueCount > 0 && (
        <div className="text-[12px] bg-[var(--color-navy-pale)] text-[var(--color-navy)] border border-[var(--color-navy-light)] rounded-md px-3 py-2 mb-3 font-semibold flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5"><Send size={13} />{queueCount} photo{queueCount > 1 ? 's' : ''} en attente d&apos;envoi</span>
          {online && (
            <button
              type="button"
              onClick={drainQueue}
              disabled={uploading}
              className="text-[11px] underline hover:no-underline disabled:opacity-50 min-h-[40px]"
            >
              Envoyer maintenant
            </button>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={onFiles}
        disabled={uploading}
        className="hidden"
        id="photo-input"
      />
      <label
        htmlFor="photo-input"
        className={
          'flex items-center justify-center w-full text-center py-4 rounded-xl font-semibold text-[15px] cursor-pointer transition-opacity hover:opacity-90 min-h-[48px] ' +
          (uploading
            ? 'bg-[var(--color-sand-mid)] text-[var(--color-ink-muted)]'
            : 'bg-[var(--color-navy)] text-[var(--color-cream)] hover:bg-[var(--color-navy-dark)]')
        }
      >
        {uploading
          ? `Upload ${progress.done}/${progress.total}…`
          : <span className="inline-flex items-center justify-center gap-2"><Camera size={20} />Prendre des photos</span>}
      </label>

      {error && (
        <div className="text-[12px] text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-md px-3 py-2 mt-3 font-semibold">
          {error}
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mt-4">
          {photos.map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-square overflow-hidden rounded-lg border border-[var(--color-sand-border)] bg-[var(--color-sand-mid)] transition-transform active:scale-[0.97]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[var(--color-ink-mid)] mt-3 leading-relaxed">
        Uploadées vers Google Drive (RAPPORTS/[année]/[ref+adresse]/photos/). Les photos prises
        hors ligne sont stockées localement (IndexedDB) et envoyées au retour du réseau.
      </p>
    </section>
  );
}
