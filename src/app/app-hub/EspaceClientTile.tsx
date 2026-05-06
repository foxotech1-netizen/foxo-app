'use client';

import { ArrowRight, User } from 'lucide-react';
import { useState } from 'react';

const ACCENT = '#E07B39';

// Tuile "Espace Client" — pas un lien direct comme les autres : on
// ouvre un mini-formulaire où le client saisit sa référence dossier,
// puis on redirige vers le tracker statique foxo-track.netlify.app.
export function EspaceClientTile() {
  const [expanded, setExpanded] = useState(false);
  const [refDossier, setRefDossier] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = refDossier.trim();
    if (!cleaned) return;
    // Tracker statique externe — l'URL embarque la ref dans le path.
    window.location.href =
      `https://foxo-track.netlify.app/${encodeURIComponent(cleaned)}.html`;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative w-[140px] sm:w-[160px] aspect-square bg-white border border-[#E6E2DC] rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-1.5 transition-all hover:scale-[1.03] hover:shadow-lg cursor-pointer"
      >
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: ACCENT }} />
        <User size={40} style={{ color: ACCENT }} />
        <div className="text-[15px] font-bold font-display text-ink text-center px-2">
          Espace Client
        </div>
        <div className="text-[12px] text-ink-mid text-center px-3 leading-tight">
          Particulier ou entreprise — consultez votre dossier
        </div>
      </button>

      {expanded && (
        <form
          onSubmit={submit}
          className="absolute left-0 right-0 top-full mt-2 z-10 bg-white border border-[#E6E2DC] rounded-xl p-2.5 flex items-center gap-2 shadow-lg"
        >
          <input
            type="text"
            value={refDossier}
            onChange={(e) => setRefDossier(e.target.value)}
            placeholder="Référence dossier"
            autoFocus
            className="flex-1 min-w-0 px-2 py-1.5 border border-[#E6E2DC] rounded-md text-[12px] outline-none focus:border-[#E07B39]"
          />
          <button
            type="submit"
            disabled={!refDossier.trim()}
            className="flex-shrink-0 w-7 h-7 rounded-md text-white flex items-center justify-center disabled:opacity-40 cursor-pointer"
            style={{ background: ACCENT }}
            aria-label="Aller au dossier"
          >
            <ArrowRight size={14} />
          </button>
        </form>
      )}
    </div>
  );
}
