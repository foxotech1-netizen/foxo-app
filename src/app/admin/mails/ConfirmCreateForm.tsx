'use client';

// Formulaire éditable affiché AVANT les 3 boutons d'action quand
// l'analyse existe mais qu'aucun dossier n'a été matché. Permet à
// l'admin de :
//   - Vérifier/corriger l'adresse extraite (souvent vide ou imprécise)
//   - Choisir le type d'intervention (5 valeurs DB)
//   - Vérifier les contacts occupant
//   - Choisir le créneau (primary proposé OU lier à un dossier existant
//     via autocomplete)
//
// Submit → POST /api/admin/mails/confirm-and-create. Side-effects
// (création Drive + INSERT intervention + réservation créneau + upload PJ)
// déférés ici, pas dans analyse-deep (read-only).
//
// ⚠ Limitation actuelle : seul le créneau primary est affiché en radio.
// Le créneau alternative n'est pas persisté en DB (mails_analyses ne
// stocke pas alternative_id). Si l'admin veut un autre créneau : lien
// vers /admin/planning pour choisir manuellement (à câbler ultérieurement
// avec un picker inline si besoin).

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Plus } from 'lucide-react';
import type {
  MailAnalyse,
  ConfirmCreateOccupant,
  OccupantExtrait,
  OccupantExtraitType,
  ContactPreference,
} from './MailAnalyseTypes';
import { emptyConfirmCreateOccupant } from './MailAnalyseTypes';
import { ALLOWED_TYPES_INTERVENTION } from '@/lib/mails/intervention-types';

const OCCUPANT_TYPE_LABELS: { value: OccupantExtraitType; label: string }[] = [
  { value: 'occupant', label: 'Occupant' },
  { value: 'proprietaire', label: 'Propriétaire' },
  { value: 'locataire', label: 'Locataire' },
  { value: 'concierge', label: 'Concierge' },
  { value: 'voisin', label: 'Voisin' },
  { value: 'gestionnaire', label: 'Gestionnaire' },
  { value: 'parties_communes', label: 'Parties communes' },
  { value: 'autre', label: 'Autre' },
];

const CONTACT_PREF_LABELS: { value: ContactPreference; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'both', label: 'Les deux' },
];

// Mêmes classe/style que les inputs existants du formulaire (adresse, type…).
const OCC_INPUT_CLASS = 'w-full px-2.5 py-1.5 rounded text-[12px] outline-none disabled:opacity-50';
const OCC_INPUT_STYLE: React.CSSProperties = {
  background: 'var(--color-cream)',
  border: '1px solid var(--color-sand-border)',
  color: 'var(--color-ink)',
};

interface SearchResult {
  id: string;
  ref: string | null;
  adresse: string | null;
}

interface Props {
  threadId: string;
  analyse: MailAnalyse;
  onConfirmed: (threadId: string) => Promise<void>;
}

type SubmitState = 'idle' | 'submitting';

export function ConfirmCreateForm({ threadId, analyse, onConfirmed }: Props) {
  const [adresse, setAdresse] = useState(analyse.adresse_extraite ?? '');
  const [typeInterv, setTypeInterv] = useState<string>('Autre');
  const [occupants, setOccupants] = useState<ConfirmCreateOccupant[]>(() => {
    const src = analyse.occupants_extraits;
    if (src && src.length > 0) return src.map(fromExtrait);
    return [emptyConfirmCreateOccupant()];
  });
  const [creneauChoice, setCreneauChoice] = useState<'primary' | 'existing' | 'other'>('primary');

  function fromExtrait(o: OccupantExtrait): ConfirmCreateOccupant {
    return {
      prenom: o.prenom,
      nom: o.nom,
      email: o.email,
      telephone: o.telephone,
      appartement: o.appartement,
      etage: o.etage,
      type: o.type,
      instructions: o.remarques,
      contact_preference: 'email',
    };
  }

  function addOccupant() {
    setOccupants((a) => [...a, emptyConfirmCreateOccupant()]);
  }
  function removeOccupant(i: number) {
    setOccupants((a) => (a.length > 1 ? a.filter((_, idx) => idx !== i) : a));
  }
  function updateOccupant(i: number, patch: Partial<ConfirmCreateOccupant>) {
    setOccupants((a) => a.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  // Autocomplete dossier existant
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkedDossier, setLinkedDossier] = useState<SearchResult | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState<string | null>(null);

  const primary = analyse.creneau;
  const adresseInvalid = creneauChoice !== 'existing' && adresse.trim().length === 0;

  // Debounce autocomplete (300ms — politique Nominatim-like).
  // Pas de clear synchrone via setState dans l'effect : on dérive la
  // visibilité du dropdown depuis searchQuery.length < 2 plus bas
  // (effet eslint-friendly + zéro flash).
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (searchQuery.trim().length < 2) {
      return () => {
        if (searchTimer.current) clearTimeout(searchTimer.current);
      };
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/admin/interventions/search?q=${encodeURIComponent(searchQuery.trim())}`,
          { cache: 'no-store' },
        );
        const data = await r.json();
        if (data.success) setSearchResults((data.results ?? []) as SearchResult[]);
      } catch { /* noop */ }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

  // Liste affichée : vide si la query est trop courte, même si on a des
  // résultats résiduels d'une recherche précédente.
  const visibleResults = searchQuery.trim().length >= 2 ? searchResults : [];

  function pickExisting(r: SearchResult) {
    setLinkedDossier(r);
    setSearchOpen(false);
    setSearchQuery(r.ref ? `${r.ref} — ${r.adresse ?? ''}`.trim() : (r.adresse ?? ''));
    setCreneauChoice('existing');
  }

  function clearLinkedDossier() {
    setLinkedDossier(null);
    setSearchQuery('');
    setCreneauChoice('primary');
  }

  async function handleSubmit() {
    setError(null);

    if (creneauChoice !== 'existing' && adresseInvalid) {
      setError('Adresse requise (ou lie à un dossier existant).');
      return;
    }
    if (!analyse.creneau_propose_id || !primary) {
      setError('Aucun créneau disponible — relance l\'analyse approfondie.');
      return;
    }
    if (creneauChoice === 'existing' && !linkedDossier) {
      setError('Sélectionne un dossier dans la liste de recherche.');
      return;
    }
    if (creneauChoice === 'other') {
      // Pas encore implémenté : on guide l'admin vers /admin/planning.
      setError('Pour un autre créneau, ouvre /admin/planning, sélectionne le créneau, puis reviens ici. Fonctionnalité picker inline à venir.');
      return;
    }

    setSubmitState('submitting');
    try {
      const body = {
        thread_id: threadId,
        adresse: adresse.trim(),
        type_intervention: typeInterv,
        occupants,
        // Rétro-compat : confirm-and-create lit encore les champs singuliers
        // (consommation occupants[] côté serveur ajoutée en 1.c). On dérive
        // depuis le premier occupant de la liste.
        occupant_telephone: occupants[0]?.telephone ?? '',
        occupant_email: occupants[0]?.email ?? '',
        // creneau_propose_id est l'ID DB du créneau primary stocké par
        // analyse-deep ; analyse.creneau ne contient que la metadata
        // formatée (date / heure / tech_nom).
        creneau_id: analyse.creneau_propose_id,
        dossier_match_id: linkedDossier?.id ?? null,
      };
      const r = await fetch('/api/admin/mails/confirm-and-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!data.success) {
        setError(data.error ?? 'Échec création.');
        setSubmitState('idle');
        return;
      }
      // Succès : refresh l'analyse → l'UI bascule sur cas 1 (3 boutons)
      // car dossier_match_id est maintenant set.
      await onConfirmed(threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
      setSubmitState('idle');
    }
  }

  return (
    <div
      className="rounded-md p-4 space-y-3"
      style={{
        background: 'var(--color-sand)',
        border: '1px solid var(--color-sand-border)',
      }}
    >
      <div className="font-sora text-[13px] font-semibold" style={{ color: 'var(--color-ink)' }}>
        Vérifier les informations avant création
      </div>

      {/* Adresse */}
      <Field label="Adresse" required={creneauChoice !== 'existing'}>
        <input
          type="text"
          value={adresse}
          onChange={(e) => setAdresse(e.target.value)}
          placeholder="Avenue Henri Liebrecht 66, 1090 Bruxelles"
          disabled={submitState === 'submitting' || creneauChoice === 'existing'}
          className="w-full px-2.5 py-1.5 rounded text-[12px] outline-none disabled:opacity-50"
          style={{
            background: 'var(--color-cream)',
            border: `1px solid ${adresseInvalid ? 'var(--color-terra)' : 'var(--color-sand-border)'}`,
            color: 'var(--color-ink)',
          }}
        />
        {adresseInvalid && (
          <div className="text-[10px] mt-1" style={{ color: 'var(--color-terra)' }}>
            Adresse extraite vide — saisis une adresse postale belge complète.
          </div>
        )}
      </Field>

      {/* Type intervention */}
      <Field label="Type">
        <select
          value={typeInterv}
          onChange={(e) => setTypeInterv(e.target.value)}
          disabled={submitState === 'submitting'}
          className="w-full px-2.5 py-1.5 rounded text-[12px] outline-none disabled:opacity-50"
          style={{
            background: 'var(--color-cream)',
            border: '1px solid var(--color-sand-border)',
            color: 'var(--color-ink)',
          }}
        >
          {ALLOWED_TYPES_INTERVENTION.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>

      {/* Occupants (liste éditable, pré-remplie depuis occupants_extraits) */}
      <Field label="Occupants">
        <div className="space-y-2">
          {occupants.map((o, i) => (
            <div
              key={i}
              className="rounded p-2.5 space-y-2"
              style={{ background: 'var(--color-cream)', border: '1px solid var(--color-sand-border)' }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: 'var(--color-ink-muted)' }}
                >
                  Occupant {i + 1}
                </span>
                {occupants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeOccupant(i)}
                    disabled={submitState === 'submitting'}
                    className="text-[10px] font-medium hover:underline disabled:opacity-50"
                    style={{ color: 'var(--color-terra)' }}
                  >
                    Supprimer
                  </button>
                )}
              </div>

              {/* Ligne 1 : Appartement | Étage | Type */}
              <div className="grid grid-cols-3 gap-1.5">
                <input
                  type="text"
                  value={o.appartement}
                  onChange={(e) => updateOccupant(i, { appartement: e.target.value })}
                  disabled={submitState === 'submitting'}
                  placeholder="Apt"
                  className={OCC_INPUT_CLASS}
                  style={OCC_INPUT_STYLE}
                />
                <input
                  type="text"
                  value={o.etage}
                  onChange={(e) => updateOccupant(i, { etage: e.target.value })}
                  disabled={submitState === 'submitting'}
                  placeholder="Étage"
                  className={OCC_INPUT_CLASS}
                  style={OCC_INPUT_STYLE}
                />
                <select
                  value={o.type}
                  onChange={(e) => updateOccupant(i, { type: e.target.value as OccupantExtraitType })}
                  disabled={submitState === 'submitting'}
                  className={OCC_INPUT_CLASS}
                  style={OCC_INPUT_STYLE}
                >
                  {OCCUPANT_TYPE_LABELS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Ligne 2 : Prénom | Nom */}
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  value={o.prenom}
                  onChange={(e) => updateOccupant(i, { prenom: e.target.value })}
                  disabled={submitState === 'submitting'}
                  placeholder="Prénom"
                  className={OCC_INPUT_CLASS}
                  style={OCC_INPUT_STYLE}
                />
                <input
                  type="text"
                  value={o.nom}
                  onChange={(e) => updateOccupant(i, { nom: e.target.value })}
                  disabled={submitState === 'submitting'}
                  placeholder="Nom"
                  className={OCC_INPUT_CLASS}
                  style={OCC_INPUT_STYLE}
                />
              </div>

              {/* Ligne 3 : Email | Téléphone */}
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="email"
                  value={o.email}
                  onChange={(e) => updateOccupant(i, { email: e.target.value })}
                  disabled={submitState === 'submitting'}
                  placeholder="prenom@example.be"
                  className={OCC_INPUT_CLASS}
                  style={OCC_INPUT_STYLE}
                />
                <input
                  type="tel"
                  value={o.telephone}
                  onChange={(e) => updateOccupant(i, { telephone: e.target.value })}
                  disabled={submitState === 'submitting'}
                  placeholder="+32 ..."
                  className={OCC_INPUT_CLASS}
                  style={OCC_INPUT_STYLE}
                />
              </div>

              {/* Ligne 4 : Mode de contact préféré */}
              <div className="flex flex-wrap items-center gap-3">
                {CONTACT_PREF_LABELS.map((p) => (
                  <label
                    key={p.value}
                    className="inline-flex items-center gap-1.5 cursor-pointer text-[12px]"
                    style={{ color: 'var(--color-ink)' }}
                  >
                    <input
                      type="radio"
                      name={`contact-pref-${i}`}
                      value={p.value}
                      checked={o.contact_preference === p.value}
                      onChange={() => updateOccupant(i, { contact_preference: p.value })}
                      disabled={submitState === 'submitting'}
                    />
                    {p.label}
                  </label>
                ))}
              </div>

              {/* Ligne 5 : Instructions */}
              <textarea
                value={o.instructions}
                onChange={(e) => updateOccupant(i, { instructions: e.target.value })}
                disabled={submitState === 'submitting'}
                rows={2}
                placeholder="Instructions (digicode, accès, clés…)"
                className={`${OCC_INPUT_CLASS} resize-y`}
                style={OCC_INPUT_STYLE}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addOccupant}
          disabled={submitState === 'submitting'}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--color-sand-mid)', color: 'var(--color-ink-mid)' }}
        >
          <Plus size={14} aria-hidden /> Ajouter un occupant
        </button>
      </Field>

      {/* Créneau (radios) */}
      <Field label="Créneau">
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="creneau-choice"
              value="primary"
              checked={creneauChoice === 'primary'}
              onChange={() => { clearLinkedDossier(); setCreneauChoice('primary'); }}
              disabled={!primary || submitState === 'submitting'}
              className="mt-0.5"
            />
            <span className="text-[12px]" style={{ color: 'var(--color-ink)' }}>
              {primary
                ? `${formatDateFr(primary.date)} ${primary.heure_debut} → ${primary.heure_fin} — ${primary.technicien_nom}`
                : 'Aucun créneau proposé'}
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="creneau-choice"
              value="other"
              checked={creneauChoice === 'other'}
              onChange={() => { clearLinkedDossier(); setCreneauChoice('other'); }}
              disabled={submitState === 'submitting'}
              className="mt-0.5"
            />
            <span className="text-[12px]" style={{ color: 'var(--color-ink)' }}>
              Autre créneau —{' '}
              <a
                href="/admin/planning"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: 'var(--color-navy)' }}
              >
                ouvrir /admin/planning
              </a>
            </span>
          </label>
        </div>
      </Field>

      {/* Lier à un dossier existant */}
      <Field label="OU lier à un dossier existant">
        <div className="relative">
          <div className="relative">
            <Search
              size={12}
              aria-hidden
              style={{
                position: 'absolute',
                left: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-ink-muted)',
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
                if (linkedDossier) setLinkedDossier(null);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Rechercher par ref ou adresse…"
              disabled={submitState === 'submitting'}
              className="w-full pl-7 pr-2.5 py-1.5 rounded text-[12px] outline-none disabled:opacity-50"
              style={{
                background: 'var(--color-cream)',
                border: `1px solid ${linkedDossier ? 'var(--color-ok-mid)' : 'var(--color-sand-border)'}`,
                color: 'var(--color-ink)',
              }}
            />
          </div>
          {searchOpen && visibleResults.length > 0 && (
            <div
              className="absolute top-full left-0 right-0 mt-1 z-20 rounded overflow-hidden max-h-[200px] overflow-y-auto"
              style={{
                background: 'var(--color-cream)',
                border: '1px solid var(--color-sand-border)',
                boxShadow: '0 4px 12px rgba(15,32,64,0.12)',
              }}
            >
              {visibleResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => pickExisting(r)}
                  className="w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[var(--color-sand-hover)]"
                  style={{ color: 'var(--color-ink)' }}
                >
                  <span className="font-sora font-semibold" style={{ color: 'var(--color-navy)' }}>
                    {r.ref ?? '?'}
                  </span>
                  <span className="ml-2" style={{ color: 'var(--color-ink-mid)' }}>
                    {r.adresse ?? '—'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {linkedDossier && (
            <div className="text-[10px] mt-1" style={{ color: 'var(--color-ok)' }}>
              ✓ Lié à <strong>{linkedDossier.ref ?? '?'}</strong> — pas de nouveau dossier créé.
            </div>
          )}
        </div>
      </Field>

      {error && (
        <div
          className="px-2.5 py-1.5 rounded text-[11px] font-medium"
          style={{
            background: 'var(--color-terra-light)',
            border: '1px solid var(--color-terra-mid)',
            color: 'var(--color-terra)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitState === 'submitting'}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[12px] font-bold disabled:opacity-50 min-h-[44px]"
          style={{ background: 'var(--color-navy)', color: 'var(--color-cream)' }}
        >
          {submitState === 'submitting' && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {submitState === 'submitting'
            ? 'Création en cours (5-10s)…'
            : (linkedDossier ? 'Lier au dossier' : 'Valider et créer le dossier')}
        </button>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="text-[10px] font-medium uppercase tracking-wider block mb-1"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        {label}
        {required && <span style={{ color: 'var(--color-terra)' }}> *</span>}
      </span>
      {children}
    </label>
  );
}

function formatDateFr(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
}
