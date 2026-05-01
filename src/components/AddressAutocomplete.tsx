'use client';

import { useEffect, useRef, useState } from 'react';

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
  const [query, setQuery] = useState<string>(value.adresse || '');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ignoreNextFetch = useRef(false);

  // Re-sync l'input quand le parent reset value.adresse
  useEffect(() => {
    setQuery(value.adresse || '');
  }, [value.adresse]);

  // Debounce 400ms + min 4 chars (cf. politique Nominatim)
  useEffect(() => {
    if (ignoreNextFetch.current) {
      ignoreNextFetch.current = false;
      return;
    }
    const q = query.trim();
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
        if (data.ok) {
          setSuggestions(data.suggestions ?? []);
          setError(null);
        } else {
          setError(data.error ?? 'Erreur autocomplete.');
        }
      } catch (e) {
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
        <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">
          {label} {required && <span className="text-terra">*</span>}
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
          className="w-full px-3 py-2.5 pr-20 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid disabled:opacity-50 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && (
            <span className="inline-block w-3.5 h-3.5 border-2 border-navy-mid border-t-transparent rounded-full animate-spin" aria-label="Chargement" />
          )}
          {value.verified && !loading && (
            <span
              className="inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-ok-light text-ok border border-ok-mid dark:bg-[#14281E] dark:text-[#7AC9A0] dark:border-[#2A4F3A]"
              title={`Lat ${value.lat ?? '—'}, Lng ${value.lng ?? '—'}`}
            >
              ✅ vérifiée
            </span>
          )}
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="text-ink-muted hover:text-terra text-[14px] leading-none w-5 h-5 flex items-center justify-center"
              aria-label="Effacer"
              tabIndex={-1}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Champs structurés (lecture seule, en debug visuel) */}
      {value.verified && (value.code_postal || value.ville) && (
        <div className="text-[11px] text-ink-muted mt-1 dark:text-[#C8C2B8]">
          {[value.code_postal, value.ville, value.pays].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Dropdown suggestions */}
      {open && (suggestions.length > 0 || loading || error || (query.trim().length >= 4 && !loading)) && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-sand-border rounded-lg shadow-lg max-h-[280px] overflow-y-auto dark:bg-[#221E1A] dark:border-[#3D3A32]">
          {error && (
            <div className="px-3 py-2 text-[11px] text-terra font-semibold">⚠️ {error}</div>
          )}
          {!error && suggestions.length === 0 && !loading && query.trim().length >= 4 && (
            <div className="px-3 py-2 text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
              Aucune adresse trouvée — tu peux saisir manuellement.
            </div>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${s.lat}-${s.lng}-${i}`}
              type="button"
              onClick={() => selectSuggestion(s)}
              className="block w-full text-left px-3 py-2 hover:bg-sand transition-colors border-b border-sand-mid last:border-b-0 dark:hover:bg-[#2A2520] dark:border-[#3D3A32]"
            >
              <div className="text-[12px] font-bold text-ink dark:text-[#F0ECE4]">
                {composeAdresse(s.rue, s.numero) || s.display_name.split(',')[0]}
              </div>
              <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">
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
