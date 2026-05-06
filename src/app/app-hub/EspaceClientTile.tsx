'use client';

import { ArrowRight, User } from 'lucide-react';
import { useState } from 'react';

const ICON_COLOR = '#FBBF24';

// Tuile "Espace Client" — pas un lien direct : on ouvre un mini-form
// inline où le client saisit sa référence, puis on redirige vers le
// tracker statique foxo-track.netlify.app. Form positionné en absolu
// sous la tuile, glassmorphism cohérent avec le reste du hub.
export function EspaceClientTile({ delayMs }: { delayMs: number }) {
  const [expanded, setExpanded] = useState(false);
  const [refDossier, setRefDossier] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = refDossier.trim();
    if (!cleaned) return;
    window.location.href =
      `https://foxo-track.netlify.app/${encodeURIComponent(cleaned)}.html`;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="hub-tile"
        style={{ animation: `hubFadeInUp 0.4s ease-out ${delayMs}ms both` }}
      >
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <div
            className="w-11 h-11 rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{ background: `${ICON_COLOR}26` }}
          >
            <User size={22} style={{ color: ICON_COLOR }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold font-display text-white">
              Espace Client
            </div>
            <div
              className="text-[13px] mt-0.5"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              Particulier ou entreprise
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <form
          onSubmit={submit}
          className="absolute left-0 right-0 top-full mt-2 z-10 rounded-xl p-2.5 flex items-center gap-2"
          style={{
            background: 'rgba(15,30,53,0.92)',
            border: '1px solid rgba(255,255,255,0.18)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          }}
        >
          <input
            type="text"
            value={refDossier}
            onChange={(e) => setRefDossier(e.target.value)}
            placeholder="Référence dossier"
            autoFocus
            className="flex-1 min-w-0 px-2.5 py-2 rounded-md text-[13px] outline-none bg-transparent text-white placeholder:text-white/40"
            style={{ border: '1px solid rgba(255,255,255,0.15)' }}
          />
          <button
            type="submit"
            disabled={!refDossier.trim()}
            className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center disabled:opacity-40 cursor-pointer"
            style={{ background: ICON_COLOR, color: '#0F1E35' }}
            aria-label="Aller au dossier"
          >
            <ArrowRight size={14} />
          </button>
        </form>
      )}
    </div>
  );
}
