'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Photo = { name: string; url: string; createdAt: string | null };

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 40);
}

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

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    setProgress({ done: 0, total: files.length });

    const supabase = createClient();
    const uploaded: Photo[] = [];

    for (const file of files) {
      const ts = Date.now();
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase();
      const name = `${ts}-${slugify(file.name.replace(ext, ''))}${ext}`;
      const path = `${interventionId}/${name}`;

      const { error: upErr } = await supabase.storage
        .from('intervention-photos')
        .upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (upErr) {
        setError(`Échec upload ${file.name} : ${upErr.message}`);
        break;
      }
      const { data: signed } = await supabase.storage
        .from('intervention-photos')
        .createSignedUrl(path, 60 * 60 * 24);
      if (signed?.signedUrl) {
        uploaded.push({ name, url: signed.signedUrl, createdAt: new Date().toISOString() });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setPhotos((cur) => [...uploaded, ...cur]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
    router.refresh();
  }

  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">
          Photos terrain
        </div>
        <span className="text-[11px] text-ink-mid">{photos.length}</span>
      </div>

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
          'block w-full text-center py-3.5 rounded-xl font-bold text-[14px] cursor-pointer ' +
          (uploading ? 'bg-sand-mid text-ink-muted' : 'bg-navy text-white hover:bg-navy-mid active:bg-navy-mid')
        }
      >
        {uploading
          ? `Upload ${progress.done}/${progress.total}…`
          : '📸 Prendre des photos'}
      </label>

      {error && (
        <div className="text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 mt-2 font-semibold">
          {error}
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          {photos.map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-square overflow-hidden rounded-md border border-sand-border bg-sand-mid"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
            </a>
          ))}
        </div>
      )}

      <p className="text-[10px] text-ink-muted mt-3 leading-relaxed">
        Stockées dans Supabase Storage (bucket privé). Lien valide 24h pour la prévisualisation.
      </p>
    </section>
  );
}
