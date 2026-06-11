'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, X, AlertTriangle } from 'lucide-react';

export interface AddressValue {
  adresse: string;          // rue + numéro composés en une ligne
  rue: string;
  numero: string;
  code_postal: string;
  ville: string;
  pays: string;
  lat: string | null;       // numeric côté DB, on garde string ici
  lng: string | null;
  verified: boolean;        // true si sélectionné depuis Nominatim
}

interface Suggestion {
  display_name: string;
  rue: string;
  numero: string;
  code_postal: string;
  ville: string;
  pays: string;
  lat: string;
  lng: string;
}

// Compose une adresse "Rue de la Loi 42" depuis (rue, numero)
function composeAdresse(rue: string, numero: string): string {
  const r = rue.trim();
  const n = numero.trim();
  if (!r) return n;
  if (!n) return r;
  return `${r} ${n}`;
}

// Autocomplete d'adresse via Nominatim (OpenStreetMap).
// - Saisie libre toujours possible (graceful degradation)
// - Debounce 400ms (respect du rate-limit Nominatim 1 req/s)
// - Selection → onChange avec une AddressValue complète + verified=true
// - Édition manuelle après sélection → reset verified=false (le badge ✅
//   disparaît pour signaler que l'admin a tapé manuellement)
export function AddressAutocomplete({
  value,
  onChange,
  placeholder = 'Rue, numéro, ville…',
  required,
  disabled,
  className,
  label,
}: {
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  // L'input est entièrement contrôlé par l'état INTERNE du composant
  // (`query`). On ne re-sync PAS sur `value.adresse` à chaque render —
  // sinon une normalisation côté parent (ex: setAdresse(addr.rue) au
  // lieu de addr.adresse) écraserait la saisie utilisateur en cours.
  // L'init `value.adresse` ne sert que pour l'hydratation au premier
  // mount (ex: édition d'un client existant).
  const [query, setQuery] = useState<string>(value.adresse || '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ignoreNextFetch = useRef(false);
  // Hydrate `query` UNE seule fois si une valeur initiale arrive après
  // le mount (ex: <Suspense> qui débloque les data après le 1er render).
  // Une fois que l'utilisateur a tapé OU sélectionné, plus de re-sync.
  const userTouched = useRef(false);
  useEffect(() => {
    if (userTouched.current) return;
    if (value.adresse && value.adresse !== query) {
      setQuery(value.adresse);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.adresse]);

  // Debounce 400ms + min 4 chars (cf. politique Nominatim)
  useEffect(() => {
    if (ignoreNextFetch.current) {
      ignoreNextFetch.current = false;
      return;
    }
    const q = query.trim();
    console.log('[autocomplete] query:', q);
    if (q.length < 4) {
      setSuggestions([]);
      setError(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/address/autocomplete?q=${encodeURIComponent(q)}`);
        const data = await r.json();
        console.log('[autocomplete] response', { ok: data.ok, count: (data.suggestions ?? []).length, error: data.error });
        if (data.ok) {
          setSuggestions(data.suggestions ?? []);
          setError(null);
        } else {
          setError(data.error ?? 'Erreur autocomplete.');
        }
      } catch (e) {
        console.error('[autocomplete] fetch threw:', e);
        setError(e instanceof Error ? e.message : 'Erreur réseau.');
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  // Click outside → ferme dropdown
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function selectSuggestion(s: Suggestion) {
    const adresse = composeAdresse(s.rue, s.numero);
    ignoreNextFetch.current = true; // éviter de re-fetch après l'autofill
    userTouched.current = true;
    setQuery(adresse);
    setSuggestions([]);
    setOpen(false);
    onChange({
      adresse,
      rue: s.rue,
      numero: s.numero,
      code_postal: s.code_postal,
      ville: s.ville,
      pays: s.pays || 'Belgique',
      lat: s.lat,
      lng: s.lng,
      verified: true,
    });
  }

  function handleManualChange(text: string) {
    userTouched.current = true;
    setQuery(text);
    setOpen(true);
    onChange({
      ...value,
      adresse: text,
      verified: false,
      // On garde rue/numero/cp/ville/lat/lng tels quels — l'utilisateur
      // voudra peut-être seulement corriger le numéro. Si la saisie
      // diverge fortement, lat/lng n'auront plus de sens, donc on les
      // remet à null.
      lat: null,
      lng: null,
    });
  }

  function handleClear() {
    userTouched.current = true;
    setQuery('');
    setSuggestions([]);
    onChange({
      adresse: '',
      rue: '',
      numero: '',
      code_postal: '',
      ville: '',
      pays: 'Belgique',
      lat: null,
      lng: null,
      verified: false,
    });
  }

  return (
    <div ref={wrapRef} className={'relative ' + (className ?? '')}>
      {label && (
        <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)] block mb-1.5">
          {label} {required && <span className="text-[var(--color-terra)] ml-0.5">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleManualChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className="w-full min-h-[48px] px-4 py-3 pr-24 border border-[var(--color-sand-border)] rounded-lg text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--color-navy)] focus:ring-2 focus:ring-[var(--color-navy-pale)] disabled:opacity-50 transition-all placeholder:text-[var(--color-ink-muted)] placeholder:italic"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {loading && (
            <span className="inline-block w-4 h-4 border-2 border-[var(--color-navy-mid)] border-t-transparent rounded-full animate-spin" aria-label="Chargement" />
          )}
          {value.verified && !loading && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[var(--color-ok-light)] text-[var(--color-ok)] border border-[var(--color-ok-mid)]"
              title={`Lat ${value.lat ?? '—'}, Lng ${value.lng ?? '—'}`}
            >
              <CheckCircle2 size={12} /> vérifiée
            </span>
          )}
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="text-[var(--color-ink-muted)] hover:text-[var(--color-terra)] leading-none w-7 h-7 flex items-center justify-center transition-colors"
              aria-label="Effacer"
              tabIndex={-1}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Champs structurés (lecture seule, en debug visuel) */}
      {value.verified && (value.code_postal || value.ville) && (
        <div className="text-[12px] text-[var(--color-ink-mid)] mt-1.5">
          {[value.code_postal, value.ville, value.pays].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Dropdown suggestions — pattern card signature triple-shadow */}
      {open && (suggestions.length > 0 || loading || error || (query.trim().length >= 4 && !loading)) && (
        <div
          className="absolute z-30 mt-1 w-full bg-[var(--color-cream)] border border-[var(--color-sand-border)] rounded-lg max-h-[280px] overflow-y-auto"
          style={{ boxShadow: 'var(--shadow-card)' }}
        >
          {error && (
            <div className="px-3 py-2.5 text-[12px] text-[var(--color-terra)] font-semibold inline-flex items-center gap-1.5">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
          {!error && suggestions.length === 0 && !loading && query.trim().length >= 4 && (
            <div className="px-3 py-2.5 text-[12px] text-[var(--color-ink-mid)] italic">
              Aucune adresse trouvée — tu peux saisir manuellement.
            </div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.lat}-${s.lng}-${i}`}
              type="button"
              onClick={() => selectSuggestion(s)}
              className="block w-full text-left px-3.5 py-2.5 hover:bg-[var(--color-sand)] focus:bg-[var(--color-navy-pale)] focus:text-[var(--color-navy)] focus:outline-none transition-colors border-b border-[var(--color-sand-mid)] last:border-b-0 min-h-[48px]"
            >
              <div className="text-[13px] font-semibold text-[var(--color-ink)]">
                {composeAdresse(s.rue, s.numero) || s.display_name.split(',')[0]}
              </div>
              <div className="text-[11px] text-[var(--color-ink-mid)] mt-0.5">
                {[s.code_postal, s.ville].filter(Boolean).join(' ') || s.display_name.split(',').slice(1).join(',').trim()}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper pour initialiser un AddressValue depuis une adresse string
// existante (legacy) — on ne sait pas si elle est vérifiée donc verified=false.
export function emptyAddress(): AddressValue {
  return { adresse: '', rue: '', numero: '', code_postal: '', ville: '', pays: 'Belgique', lat: null, lng: null, verified: false };
}

export function addressFromString(s: string | null | undefined): AddressValue {
  const txt = (s ?? '').trim();
  if (!txt) return emptyAddress();
  // Heuristique : "Rue X 42, 1000 Bruxelles" → rue+num / cp / ville
  const m = txt.match(/^(.+?),?\s*(\d{4})\s+(.+?)$/);
  if (m) {
    return {
      adresse: m[1].trim(),
      rue: m[1].trim(),
      numero: '',
      code_postal: m[2].trim(),
      ville: m[3].trim(),
      pays: 'Belgique',
      lat: null,
      lng: null,
      verified: false,
    };
  }
  return { ...emptyAddress(), adresse: txt };
}
