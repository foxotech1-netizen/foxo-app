'use client';

// Topbar admin — recherche globale (« Mode Appel » phase 1).
// Barre sticky dans la colonne droite du layout admin (emplacement topbar
// prévu par src/app/admin/layout.tsx). Interroge GET /api/admin/search
// (debounce 300 ms, AbortController) et affiche un dropdown groupé par
// catégorie. Raccourci Ctrl+K / Cmd+K, Échap ferme, clic extérieur ferme.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { StatutBadge } from '@/components/StatutBadge';
import type { StatutIntervention } from '@/lib/types/database';
import type { SearchResults } from '@/app/api/admin/search/route';

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

type FetchState = 'idle' | 'loading' | 'done' | 'error';

function isEmpty(r: SearchResults): boolean {
  return (
    r.interventions.length === 0 &&
    r.occupants.length === 0 &&
    r.clients.length === 0 &&
    r.acps.length === 0 &&
    r.organisations.length === 0
  );
}

export function TopbarSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>('idle');
  const [results, setResults] = useState<SearchResults | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounce + fetch avec annulation des requêtes obsolètes.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      abortRef.current?.abort();
      setResults(null);
      setState('idle');
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState('loading');
      try {
        const r = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { results: SearchResults };
        setResults(d.results);
        setState('done');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // remplacée par une plus récente
        setResults(null);
        setState('error');
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Ctrl+K / Cmd+K → focus, Échap → fermeture.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      } else if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Clic extérieur → fermeture.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery('');
      setResults(null);
      setState('idle');
      router.push(href);
    },
    [router],
  );

  const showDropdown = open && query.trim().length >= MIN_CHARS;

  return (
    <header className="sticky top-0 z-40 bg-[var(--color-sand)]/95 backdrop-blur border-b border-[var(--color-sand-border)] px-6 py-2.5">
      <div ref={containerRef} className="relative max-w-[600px]">
        <div className="relative">
          <Search
            size={15}
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-muted)] pointer-events-none"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Rechercher : nom, téléphone, adresse, référence…"
            aria-label="Recherche globale"
            className="w-full pl-9 pr-16 py-2 bg-cream border border-sand-border rounded-lg text-[13px] text-ink outline-none focus:border-navy-mid placeholder:text-ink-muted placeholder:italic"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {state === 'loading' && (
              <span
                aria-hidden
                className="w-3.5 h-3.5 rounded-full border-2 border-[var(--color-sand-border)] border-t-[var(--color-navy)] animate-spin"
              />
            )}
            <kbd className="hidden md:inline text-[9px] font-mono font-bold text-ink-muted border border-sand-border rounded px-1 py-0.5 bg-sand">
              Ctrl K
            </kbd>
          </span>
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-cream border border-sand-border rounded-xl shadow-lg overflow-hidden max-h-[70vh] overflow-y-auto z-50">
            {state === 'error' && (
              <p className="px-4 py-3 text-[12px] font-semibold text-terra">
                Recherche indisponible — réessayez.
              </p>
            )}
            {state === 'done' && results && isEmpty(results) && (
              <p className="px-4 py-3 text-[12px] text-ink-muted italic">Aucun résultat</p>
            )}
            {state === 'loading' && !results && (
              <p className="px-4 py-3 text-[12px] text-ink-muted italic">Recherche…</p>
            )}

            {results && !isEmpty(results) && (
              <>
                <Group label="Interventions" count={results.interventions.length}>
                  {results.interventions.map((iv) => (
                    <Row key={iv.id} onClick={() => go(`/admin/interventions/${iv.id}`)}>
                      <span className="font-mono text-[11px] font-bold text-navy shrink-0">{iv.ref ?? '—'}</span>
                      <span className="text-[12px] text-ink-mid truncate flex-1">
                        {iv.adresse ?? iv.type ?? ''}
                        {iv.reference_externe ? ` · ${iv.reference_externe}` : ''}
                      </span>
                      <StatutBadge statut={iv.statut as StatutIntervention} />
                    </Row>
                  ))}
                </Group>
                <Group label="Occupants" count={results.occupants.length}>
                  {results.occupants.map((o) => (
                    <Row key={o.id} onClick={() => go(`/admin/interventions/${o.intervention_id}`)}>
                      <span className="text-[12px] font-bold text-ink shrink-0">
                        {[o.prenom, o.nom].filter(Boolean).join(' ') || '—'}
                      </span>
                      {o.telephone && <span className="font-mono text-[11px] text-ink-mid shrink-0">{o.telephone}</span>}
                      {o.appartement && <span className="text-[11px] text-ink-muted shrink-0">Apt. {o.appartement}</span>}
                      <span className="font-mono text-[10px] text-ink-muted truncate ml-auto">
                        {o.intervention_ref ?? ''}
                      </span>
                    </Row>
                  ))}
                </Group>
                <Group label="Clients" count={results.clients.length}>
                  {results.clients.map((c) => (
                    <Row key={c.id} onClick={() => go(`/admin/clients/${c.id}`)}>
                      <span className="text-[12px] font-bold text-ink truncate">{c.nom}</span>
                      <span className="text-[11px] text-ink-muted shrink-0">
                        {[c.type, c.ville].filter(Boolean).join(' · ')}
                      </span>
                      {c.bce && <span className="font-mono text-[10px] text-ink-muted ml-auto shrink-0">{c.bce}</span>}
                    </Row>
                  ))}
                </Group>
                <Group label="ACP" count={results.acps.length}>
                  {results.acps.map((a) => (
                    // La fiche /admin/clients/[id] résout aussi un id d'ACP
                    // (repli clients.acp_id — client miroir 2026-05-30).
                    <Row key={a.id} onClick={() => go(`/admin/clients/${a.id}`)}>
                      <span className="text-[12px] font-bold text-ink truncate">{a.nom}</span>
                      <span className="text-[11px] text-ink-muted truncate ml-auto">
                        {[a.adresse, a.ville].filter(Boolean).join(', ')}
                      </span>
                    </Row>
                  ))}
                </Group>
                <Group label="Organisations" count={results.organisations.length}>
                  {results.organisations.map((org) => (
                    <Row key={org.id} onClick={() => go('/admin/syndics')}>
                      <span className="text-[12px] font-bold text-ink truncate">{org.nom}</span>
                      <span className="text-[11px] text-ink-muted shrink-0 capitalize">{org.type ?? ''}</span>
                      {org.email && <span className="font-mono text-[10px] text-ink-muted ml-auto truncate">{org.email}</span>}
                    </Row>
                  ))}
                </Group>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

// ─── Sous-composants du dropdown ────────────────────────────────────────

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="border-b border-sand-mid last:border-b-0">
      <div className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted bg-sand">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-sand-hover transition-colors"
    >
      {children}
    </button>
  );
}
