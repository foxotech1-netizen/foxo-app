'use client';

// Formulaire éditable affiché AVANT les 3 boutons d'action quand
// l'analyse existe mais qu'aucun dossier n'a été matché. Permet à
// l'admin de :
//   - Vérifier/corriger l'adresse extraite (souvent vide ou imprécise)
//   - Choisir le type d'intervention (5 valeurs DB)
//   - Vérifier les contacts occupant
//   - Choisir le créneau : proposition recalculée EN DIRECT à l'ouverture du
//     formulaire (recommandé + alternative), ou « sans créneau » (dossier à
//     planifier ensuite), ou lier à un dossier existant via autocomplete
//
// Submit → POST /api/admin/mails/confirm-and-create. Side-effects
// (création Drive + INSERT intervention + réservation créneau + upload PJ)
// déférés ici, pas dans analyse-deep (read-only).
//
// Le créneau n'est plus figé au moment de l'analyse : il est recalculé ici
// via proposeSlotForIntervention (même moteur que le planning). Un mail
// analysé avant la création des disponibilités, ou dont le créneau proposé a
// été pris entre-temps, reste donc traitable sans relancer l'analyse.

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Search, Plus, RefreshCw } from 'lucide-react';
import { proposeSlotForIntervention } from '@/app/admin/planning/actions';
import type { ProposeCreneauResult } from '@/lib/mails/propose-creneau';
import type {
  MailAnalyse,
  ConfirmCreateOccupant,
  OccupantExtrait,
  OccupantExtraitType,
  ContactPreference,
} from './MailAnalyseTypes';
import { emptyConfirmCreateOccupant } from './MailAnalyseTypes';
import { ALLOWED_TYPES_INTERVENTION } from '@/lib/mails/intervention-types';

// Libellés FR des types d'occupant — exporté pour réutilisation (fiche
// dossier U2, tableau occupants).
export const OCCUPANT_TYPE_LABELS: { value: OccupantExtraitType; label: string }[] = [
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

// Un créneau proposé = entrée non-null du résultat de proposeCreneau.
type CreneauOption = NonNullable<ProposeCreneauResult['primary']>;

export function ConfirmCreateForm({ threadId, analyse, onConfirmed }: Props) {
  const [adresse, setAdresse] = useState(analyse.adresse_extraite ?? '');
  const [typeInterv, setTypeInterv] = useState<string>('Autre');
  const [occupants, setOccupants] = useState<ConfirmCreateOccupant[]>(() => {
    const src = analyse.occupants_extraits;
    if (src && src.length > 0) return src.map(fromExtrait);
    return [emptyConfirmCreateOccupant()];
  });
  // Créneau retenu : id d'un créneau proposé, ou null = « sans créneau ».
  const [selectedCreneauId, setSelectedCreneauId] = useState<string | null>(null);
  // Vrai dès que l'admin a choisi lui-même une option : un rafraîchissement
  // ne remplace alors plus son choix (sauf si le créneau choisi a disparu).
  const [creneauTouched, setCreneauTouched] = useState(false);
  const [proposal, setProposal] = useState<ProposeCreneauResult | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposing, startProposing] = useTransition();

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

  const creneauOptions: CreneauOption[] = proposal
    ? [proposal.primary, proposal.alternative].filter((c): c is CreneauOption => c !== null)
    : [];
  const adresseInvalid = !linkedDossier && adresse.trim().length === 0;
  const hasContactableOccupant = occupants.some((o) => o.email.trim() || o.telephone.trim());

  // Recalcule les créneaux libres (lecture seule côté serveur). L'adresse
  // courante du formulaire sert au regroupement géographique des tournées.
  // Aucun setState synchrone ici : tous les états sont posés après l'await.
  function loadProposal() {
    startProposing(async () => {
      try {
        const r = await proposeSlotForIntervention({
          adresse: adresse.trim() || null,
          urgence: Boolean(analyse.urgence),
        });
        setProposalError(null);
        setProposal(r);
        const ids = [r.primary?.creneau_id, r.alternative?.creneau_id].filter(Boolean);
        setSelectedCreneauId((cur) => {
          if (creneauTouched && (cur === null || ids.includes(cur))) return cur;
          return r.primary?.creneau_id ?? null;
        });
      } catch (e) {
        setProposal({ primary: null, alternative: null, fenetre_etendue: false });
        setSelectedCreneauId(null);
        setProposalError(e instanceof Error ? e.message : 'Recherche de créneaux impossible.');
      }
    });
  }

  // Première proposition à l'ouverture du formulaire. Une seule fois.
  useEffect(() => {
    loadProposal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  }

  function clearLinkedDossier() {
    setLinkedDossier(null);
    setSearchQuery('');
  }

  function chooseCreneau(id: string | null) {
    clearLinkedDossier();
    setCreneauTouched(true);
    setSelectedCreneauId(id);
  }

  async function handleSubmit() {
    setError(null);

    if (adresseInvalid) {
      setError('Adresse requise (ou lie à un dossier existant).');
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
        // Créneau choisi dans la proposition en direct, ou null = dossier
        // créé « sans créneau ». Jamais de créneau en mode « lier à un
        // dossier existant » : le planning du dossier n'est pas modifié.
        creneau_id: linkedDossier ? null : selectedCreneauId,
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
      <Field label="Adresse" required={!linkedDossier}>
        <input
          type="text"
          value={adresse}
          onChange={(e) => setAdresse(e.target.value)}
          placeholder="Avenue Henri Liebrecht 66, 1090 Bruxelles"
          disabled={submitState === 'submitting' || !!linkedDossier}
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

      {/* Créneau — proposition recalculée en direct */}
      <Field label="Créneau" as="div">
        <div className="space-y-1.5">
          {proposing && !proposal && (
            <div className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-ink-muted)' }}>
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Recherche des créneaux libres…
            </div>
          )}

          {creneauOptions.map((c, idx) => (
            <label key={c.creneau_id} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="creneau-choice"
                value={c.creneau_id}
                checked={!linkedDossier && selectedCreneauId === c.creneau_id}
                onChange={() => chooseCreneau(c.creneau_id)}
                disabled={proposing || submitState === 'submitting'}
                className="mt-0.5"
              />
              <span className="text-[12px]" style={{ color: 'var(--color-ink)' }}>
                {`${formatDateFr(c.date)} ${c.heure_debut} → ${c.heure_fin} — ${c.technicien_nom}`}
                <span style={{ color: 'var(--color-ink-muted)' }}>
                  {idx === 0 ? ' · recommandé' : ' · alternative'}
                </span>
              </span>
            </label>
          ))}

          {proposal && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="creneau-choice"
                value="none"
                checked={!linkedDossier && selectedCreneauId === null}
                onChange={() => chooseCreneau(null)}
                disabled={proposing || submitState === 'submitting'}
                className="mt-0.5"
              />
              <span className="text-[12px]" style={{ color: 'var(--color-ink)' }}>
                Sans créneau — créer le dossier et planifier ensuite
              </span>
            </label>
          )}

          {proposal && creneauOptions.length === 0 && !proposalError && (
            <div className="text-[11px]" style={{ color: 'var(--color-amber-foxo)' }}>
              Aucun créneau libre à proposer. Ajoute des disponibilités dans{' '}
              <a
                href="/admin/planning"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: 'var(--color-navy)' }}
              >
                le planning
              </a>
              {' '}(au plus tôt dans 3 jours, dès demain pour une urgence), puis clique sur
              « Actualiser » — ou crée le dossier sans créneau.
            </div>
          )}
          {proposal?.fenetre_etendue && creneauOptions.length > 0 && (
            <div className="text-[11px]" style={{ color: 'var(--color-amber-foxo)' }}>
              Rien de libre dans le délai habituel — créneaux proposés plus tard.
            </div>
          )}
          {proposalError && (
            <div className="text-[11px]" style={{ color: 'var(--color-terra)' }}>
              {proposalError}
            </div>
          )}

          <button
            type="button"
            onClick={loadProposal}
            disabled={proposing || submitState === 'submitting'}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold hover:underline disabled:opacity-50"
            style={{ color: 'var(--color-navy)' }}
          >
            <RefreshCw size={11} className={proposing ? 'animate-spin' : undefined} aria-hidden />
            {proposing ? 'Recherche…' : 'Actualiser les créneaux'}
          </button>

          {!linkedDossier && selectedCreneauId !== null && hasContactableOccupant && (
            <div className="text-[11px]" style={{ color: 'var(--color-ink-muted)' }}>
              À la création, la demande de confirmation de présence est envoyée aux occupants
              renseignés ci-dessus (email ou SMS selon le mode de contact choisi).
            </div>
          )}
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
                boxShadow: 'var(--shadow-raised)',
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
          // En mode création, désactivé pendant une recherche de créneaux :
          // évite une création « sans créneau » par simple précipitation, et
          // garantit que le créneau envoyé est bien celui affiché. Le mode
          // « lier à un dossier » n'utilise aucun créneau : jamais bloqué.
          disabled={submitState === 'submitting' || (proposing && !linkedDossier)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[12px] font-bold disabled:opacity-50 min-h-[44px]"
          style={{ background: 'var(--color-navy)', color: 'var(--color-cream)' }}
        >
          {submitState === 'submitting' && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {submitState === 'submitting'
            ? 'Création en cours (5-10s)…'
            : linkedDossier
              ? 'Lier au dossier'
              : selectedCreneauId !== null
                ? 'Valider et créer le dossier'
                : 'Créer le dossier sans créneau'}
        </button>
      </div>
    </div>
  );
}

// `as="div"` pour un GROUPE de contrôles (radios + textes + bouton) : dans un
// <label>, un clic sur n'importe quel texte du bloc activerait le premier
// contrôle — ici, il changerait silencieusement le créneau choisi.
function Field({ label, required, as = 'label', children }: {
  label: string;
  required?: boolean;
  as?: 'label' | 'div';
  children: React.ReactNode;
}) {
  const Wrapper = as;
  return (
    <Wrapper className="block">
      <span
        className="text-[10px] font-medium uppercase tracking-wider block mb-1"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        {label}
        {required && <span style={{ color: 'var(--color-terra)' }}> *</span>}
      </span>
      {children}
    </Wrapper>
  );
}

function formatDateFr(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
}
