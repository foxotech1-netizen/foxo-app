'use client';

import { useState } from 'react';

// Bouton outline navy. Au clic : fetch + blob → déclenche le download
// avec le nom de fichier voulu. Affiche un spinner pendant la génération.
export function DownloadButton({
  href,
  filename,
  label,
  icon = '📄',
  className = '',
}: {
  href: string;
  filename: string;
  label: string;
  icon?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(href, { credentials: 'include' });
      if (!r.ok) {
        let msg = `Erreur ${r.status}`;
        try {
          const j = await r.json();
          if (j?.error) msg = j.error;
        } catch { /* not JSON */ }
        setError(msg);
        setLoading(false);
        return;
      }
      const blob = await r.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Petit délai avant revoke pour laisser la nav démarrer le download
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau');
    }
    setLoading(false);
  }

  return (
    <div className={'flex flex-col gap-1.5 ' + className}>
      <button
        type="button"
        onClick={download}
        disabled={loading}
        className="
          inline-flex items-center justify-center gap-2
          px-4 py-2.5 rounded-lg text-[13px] font-semibold
          border border-[#A17244] text-[#A17244] bg-transparent
          hover:bg-[#A17244] hover:text-white
          disabled:opacity-60 disabled:cursor-wait disabled:hover:bg-transparent disabled:hover:text-[#A17244]
          transition-colors
        "
      >
        {loading ? (
          <>
            <Spinner />
            <span>Génération…</span>
          </>
        ) : (
          <>
            <span>{icon}</span>
            <span>{label}</span>
          </>
        )}
      </button>
      {error && (
        <span className="text-[11px] text-terra">{error}</span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="animate-spin"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
