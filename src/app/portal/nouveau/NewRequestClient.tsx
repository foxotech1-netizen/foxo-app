'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Acp, PrioriteIntervention, TypeIntervention } from '@/lib/types/database';
import { useOrgType, useVocab } from '../PortalContext';
import { AddressAutocomplete, addressFromString } from '@/components/AddressAutocomplete';
import {
  searchAcp,
  createAcp,
  submitRequest,
  type AcpInput,
  type OccupantInput,
} from '../actions';

const TYPES: TypeIntervention[] = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
];

const HOURS = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

type Step = 1 | 2 | 3 | 4 | 5;

export function NewRequestClient({
  preselectedDate,
  preselectedHeure,
  billingDefault,
}: {
  preselectedDate: string | null;
  preselectedHeure: string | null;
  billingDefault: { nom: string; email: string; bce: string };
}) {
  const router = useRouter();
  const orgType = useOrgType();
  const vocab = useVocab();
  const isCourtier = orgType === 'courtier';
  const accentBg = isCourtier
    ? 'bg-[#1D6FA4] hover:bg-[#175E8E]'
    : 'bg-navy hover:bg-navy-mid';

  const STEP_LABELS = isCourtier
    ? ['Sinistre', 'Problème', 'Occupants', 'Créneau', 'Facturation']
    : ['ACP', 'Problème', 'Occupants', 'Créneau', 'Facturation'];

  const [step, setStep] = useState<Step>(1);
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 1 — Mode SYNDIC : ACP
  const [acpQuery, setAcpQuery] = useState('');
  const [acpResults, setAcpResults] = useState<Acp[]>([]);
  const [selectedAcp, setSelectedAcp] = useState<Acp | null>(null);
  const [acpSearchError, setAcpSearchError] = useState<string | null>(null);
  const [showCreateAcp, setShowCreateAcp] = useState(false);
  const [creatingAcp, setCreatingAcp] = useState(false);
  const [newAcp, setNewAcp] = useState<AcpInput>({
    nom: '',
    adresse: '',
    ville: '',
    code_postal: '',
    bce: '',
    email_rapport: '',
    email_facturation: '',
  });
  const [adressePrecise, setAdressePrecise] = useState('');

  // Step 1 — Mode COURTIER : assuré + adresse sinistre + ref compagnie
  // + référence sinistre (n° dossier assureur) + compagnie d'assurance
  const [assureNom, setAssureNom] = useState('');
  const [sinistreRue, setSinistreRue] = useState('');
  const [sinistreCP, setSinistreCP] = useState('');
  const [sinistreVille, setSinistreVille] = useState('');
  const [refCompagnie, setRefCompagnie] = useState('');
  const [referenceSinistre, setReferenceSinistre] = useState('');
  const [compagnieAssurance, setCompagnieAssurance] = useState('');

  // Step 2 : Problème
  const [type, setType] = useState<TypeIntervention | ''>('');
  const [description, setDescription] = useState('');
  const [priorite, setPriorite] = useState<PrioriteIntervention>('normale');

  // Step 3 : Occupants
  const [occupants, setOccupants] = useState<OccupantInput[]>([
    { appartement: '', nom: '', email: '', telephone: '' },
  ]);

  // Step 4 : Créneau
  const [creneauDate, setCreneauDate] = useState(preselectedDate ?? '');
  const [creneauHeure, setCreneauHeure] = useState(preselectedHeure ?? '');

  // Step 5 : Facturation
  const [factNom, setFactNom] = useState(billingDefault.nom);
  const [factEmail, setFactEmail] = useState(billingDefault.email);
  const [factBce, setFactBce] = useState(billingDefault.bce);
  const [factRefBC, setFactRefBC] = useState('');

  // Debounced ACP search
  useEffect(() => {
    if (selectedAcp) return; // pas de search si on a déjà une ACP
    const q = acpQuery.trim();
    if (q.length < 2) { setAcpResults([]); setAcpSearchError(null); return; }
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await searchAcp(q);
        if (res.ok) {
          setAcpResults(res.data ?? []);
          setAcpSearchError(null);
        } else {
          setAcpSearchError(res.error);
          setAcpResults([]);
        }
      });
    }, 280);
    return () => clearTimeout(t);
  }, [acpQuery, selectedAcp]);

  function pickAcp(acp: Acp) {
    setSelectedAcp(acp);
    setAcpResults([]);
    setShowCreateAcp(false);
    setAcpQuery(acp.nom);
  }

  function clearAcp() {
    setSelectedAcp(null);
    setAcpQuery('');
    setShowCreateAcp(false);
  }

  function addOccupant() {
    setOccupants((o) => [...o, { appartement: '', nom: '', email: '', telephone: '' }]);
  }
  function removeOccupant(i: number) {
    setOccupants((o) => o.filter((_, idx) => idx !== i));
  }
  function updateOccupant(i: number, field: keyof OccupantInput, value: string) {
    setOccupants((o) => o.map((occ, idx) => (idx === i ? { ...occ, [field]: value } : occ)));
  }

  async function handleCreateAcp() {
    if (!newAcp.nom.trim()) return;
    setCreatingAcp(true);
    try {
      const res = await createAcp(newAcp);
      if (res.ok && res.data) pickAcp(res.data);
      else setAcpSearchError(res.ok ? 'Erreur création.' : res.error);
    } finally {
      setCreatingAcp(false);
    }
  }

  // Validation par étape
  function canProceed(): boolean {
    switch (step) {
      case 1:
        if (isCourtier) {
          return Boolean(
            assureNom.trim() &&
            sinistreRue.trim() && sinistreCP.trim() && sinistreVille.trim() &&
            refCompagnie.trim()
          );
        }
        return Boolean(selectedAcp);
      case 2: return Boolean(type) && description.trim().length > 5;
      case 3: return true;
      case 4: return true;
      case 5: return true;
    }
  }

  async function handleSubmit() {
    if (!isCourtier && !selectedAcp) return;
    setSubmitting(true);
    setSubmitError(null);
    let creneauIso: string | null = null;
    if (creneauDate) {
      const heure = creneauHeure || '09:00';
      creneauIso = new Date(`${creneauDate}T${heure}:00`).toISOString();
    }
    const res = await submitRequest({
      acp_id: isCourtier ? null : selectedAcp!.id,
      adresse_precise: isCourtier ? '' : adressePrecise,
      courtier: isCourtier
        ? {
            assure_nom: assureNom,
            sinistre_rue: sinistreRue,
            sinistre_code_postal: sinistreCP,
            sinistre_ville: sinistreVille,
            ref_compagnie: refCompagnie,
            reference_sinistre: referenceSinistre,
            compagnie_assurance: compagnieAssurance,
          }
        : undefined,
      type,
      description,
      priorite,
      creneau_iso: creneauIso,
      facturation: { nom: factNom, email: factEmail, bce: factBce, ref_bon_commande: factRefBC },
      occupants,
    });
    setSubmitting(false);
    if (res.ok && res.data) {
      router.push(`/portal/interventions/${res.data.id}?created=1`);
    } else if (!res.ok) {
      setSubmitError(res.error);
    }
  }

  return (
    <div className="space-y-5 max-w-[760px] mx-auto">
      <div>
        <h1 className="text-xl font-extrabold text-ink">
          {isCourtier ? 'Confier une mission' : 'Nouvelle demande d\'intervention'}
        </h1>
        <p className="text-xs text-ink-mid mt-1">
          5 étapes — vous pouvez revenir en arrière à tout moment.
        </p>
      </div>

      <StepIndicator step={step} labels={STEP_LABELS} />

      <div className="bg-cream border border-sand-border rounded-2xl p-5">
        {step === 1 && (
          isCourtier ? (
            <Step1Courtier
              assureNom={assureNom} setAssureNom={setAssureNom}
              rue={sinistreRue} setRue={setSinistreRue}
              codePostal={sinistreCP} setCodePostal={setSinistreCP}
              ville={sinistreVille} setVille={setSinistreVille}
              refCompagnie={refCompagnie} setRefCompagnie={setRefCompagnie}
              referenceSinistre={referenceSinistre} setReferenceSinistre={setReferenceSinistre}
              compagnieAssurance={compagnieAssurance} setCompagnieAssurance={setCompagnieAssurance}
            />
          ) : (
            <Step1
              query={acpQuery}
              setQuery={(v) => { setAcpQuery(v); if (selectedAcp) setSelectedAcp(null); }}
              results={acpResults}
              selectedAcp={selectedAcp}
              adressePrecise={adressePrecise}
              setAdressePrecise={setAdressePrecise}
              onPick={pickAcp}
              onClear={clearAcp}
              searching={pending}
              searchError={acpSearchError}
              showCreate={showCreateAcp}
              setShowCreate={setShowCreateAcp}
              newAcp={newAcp}
              setNewAcp={setNewAcp}
              onCreate={handleCreateAcp}
              creating={creatingAcp}
            />
          )
        )}
        {step === 2 && (
          <Step2
            type={type} setType={setType}
            description={description} setDescription={setDescription}
            priorite={priorite} setPriorite={setPriorite}
          />
        )}
        {step === 3 && (
          <Step3
            occupants={occupants}
            onAdd={addOccupant}
            onRemove={removeOccupant}
            onUpdate={updateOccupant}
          />
        )}
        {step === 4 && (
          <Step4
            date={creneauDate} setDate={setCreneauDate}
            heure={creneauHeure} setHeure={setCreneauHeure}
            preselected={Boolean(preselectedDate && preselectedHeure)}
          />
        )}
        {step === 5 && (
          <Step5
            nom={factNom} setNom={setFactNom}
            email={factEmail} setEmail={setFactEmail}
            bce={factBce} setBce={setFactBce}
            refBC={factRefBC} setRefBC={setFactRefBC}
          />
        )}
      </div>

      {submitError && (
        <div className="bg-terra-light border border-terra-mid text-terra rounded-lg px-3.5 py-2.5 text-xs">
          {submitError}
        </div>
      )}

      <div className="flex justify-between gap-2">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
          disabled={step === 1 || submitting}
          className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-50"
        >
          ← Précédent
        </button>
        {step < 5 ? (
          <button
            onClick={() => setStep((s) => Math.min(5, s + 1) as Step)}
            disabled={!canProceed()}
            className={`text-white px-4 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50 ${accentBg}`}
          >
            Suivant →
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting || (!isCourtier && !selectedAcp)}
            className={`text-white px-4 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50 ${accentBg}`}
          >
            {submitting
              ? 'Envoi…'
              : isCourtier ? 'Confier la mission ✓' : 'Soumettre la demande ✓'}
          </button>
        )}
      </div>
    </div>
  );
}

function StepIndicator({ step, labels }: { step: Step; labels: string[] }) {
  return (
    <div className="flex gap-1.5 sm:gap-2 items-center">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const state = n < step ? 'done' : n === step ? 'active' : 'todo';
        return (
          <div key={label} className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
            <div
              className={
                'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ' +
                (state === 'done' ? 'bg-ok text-white' :
                  state === 'active' ? 'bg-navy text-white' :
                  'bg-sand-mid text-ink-muted')
              }
            >
              {state === 'done' ? '✓' : n}
            </div>
            <span className={
              'text-[11px] font-semibold truncate hidden sm:inline ' +
              (state === 'active' ? 'text-navy' : 'text-ink-mid')
            }>
              {label}
            </span>
            {i < labels.length - 1 && (
              <div className={'flex-1 h-px ' + (n < step ? 'bg-ok' : 'bg-sand-border')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1 : ACP ─────────────────────────────────────────────────────────

function Step1({
  query, setQuery, results, selectedAcp, adressePrecise, setAdressePrecise,
  onPick, onClear, searching, searchError,
  showCreate, setShowCreate, newAcp, setNewAcp, onCreate, creating,
}: {
  query: string; setQuery: (v: string) => void;
  results: Acp[]; selectedAcp: Acp | null;
  adressePrecise: string; setAdressePrecise: (v: string) => void;
  onPick: (a: Acp) => void; onClear: () => void;
  searching: boolean; searchError: string | null;
  showCreate: boolean; setShowCreate: (v: boolean) => void;
  newAcp: AcpInput; setNewAcp: (v: AcpInput) => void;
  onCreate: () => void; creating: boolean;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">1. Immeuble concerné</h3>

      {selectedAcp ? (
        <div className="bg-navy-pale border border-navy-light rounded-lg p-3.5">
          <div className="flex justify-between items-start gap-3">
            <div>
              <div className="text-xs text-navy/70 font-semibold uppercase tracking-wider">
                ACP sélectionnée
              </div>
              <div className="font-bold text-[15px] text-navy mt-1">{selectedAcp.nom}</div>
              <div className="text-xs text-navy/80 mt-0.5">
                {[selectedAcp.adresse, selectedAcp.code_postal, selectedAcp.ville]
                  .filter(Boolean).join(', ') || '—'}
              </div>
              {selectedAcp.bce && (
                <div className="text-[11px] font-mono text-navy/60 mt-1">BCE : {selectedAcp.bce}</div>
              )}
            </div>
            <button
              onClick={onClear}
              className="text-[11px] text-navy underline hover:no-underline"
            >
              Changer
            </button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="text-xs font-semibold text-ink-mid block mb-1.5">
              Rechercher par nom ou par numéro BCE
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ex : Résidence Bellevue · BE0123.456.789"
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
            />
            {searching && <p className="text-[11px] text-ink-muted mt-1.5">Recherche…</p>}
            {searchError && <p className="text-[11px] text-terra mt-1.5">{searchError}</p>}
          </div>

          {query.length >= 2 && results.length > 0 && (
            <div className="bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[280px] overflow-y-auto">
              {results.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onPick(a)}
                  className="block w-full text-left px-3.5 py-2.5 hover:bg-sand-hover"
                >
                  <div className="font-semibold text-[13px]">{a.nom}</div>
                  <div className="text-[11px] text-ink-muted">
                    {[a.adresse, a.code_postal, a.ville].filter(Boolean).join(', ') || '—'}
                    {a.bce ? ` · BCE ${a.bce}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}

          {query.length >= 2 && !searching && results.length === 0 && (
            <div className="bg-amber-light border border-[#E8C896] rounded-lg p-3.5">
              <p className="text-[13px] text-[#8A5A1A] mb-2">
                Aucune ACP trouvée pour <strong>{query}</strong>.
              </p>
              {!showCreate ? (
                <button
                  onClick={() => { setShowCreate(true); setNewAcp({ ...newAcp, nom: query }); }}
                  className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold"
                >
                  + Créer une nouvelle ACP
                </button>
              ) : null}
            </div>
          )}

          {showCreate && (
            <div className="bg-white border border-sand-border rounded-lg p-4 space-y-3">
              <div className="text-xs font-bold text-navy uppercase tracking-wider">
                Nouvelle ACP
              </div>
              <Field label="Nom *" value={newAcp.nom} onChange={(v) => setNewAcp({ ...newAcp, nom: v })} placeholder="Résidence Bellevue" />
              <AddressAutocomplete
                label="Adresse de l'immeuble"
                value={addressFromString(newAcp.adresse)}
                onChange={(v) => setNewAcp({
                  ...newAcp,
                  adresse: v.adresse,
                  code_postal: v.code_postal,
                  ville: v.ville,
                })}
                placeholder="Avenue Louise 42, 1050 Bruxelles"
                required
              />
              <Field label="Numéro BCE" value={newAcp.bce} onChange={(v) => setNewAcp({ ...newAcp, bce: v })} placeholder="BE0123.456.789" />
              <Field label="Email rapport" value={newAcp.email_rapport} onChange={(v) => setNewAcp({ ...newAcp, email_rapport: v })} placeholder="rapport@..." type="email" />
              <Field label="Email facturation" value={newAcp.email_facturation} onChange={(v) => setNewAcp({ ...newAcp, email_facturation: v })} placeholder="facturation@..." type="email" />
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setShowCreate(false)} className="bg-sand-mid text-ink-mid px-3.5 py-2 rounded-lg text-xs font-semibold">
                  Annuler
                </button>
                <button
                  onClick={onCreate}
                  disabled={creating || !newAcp.nom.trim()}
                  className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
                >
                  {creating ? 'Création…' : 'Créer & sélectionner'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">
          Adresse précise de l&apos;intervention (si différente de l&apos;ACP)
        </label>
        <input
          value={adressePrecise}
          onChange={(e) => setAdressePrecise(e.target.value)}
          placeholder="ex : Apt 3B, étage 5"
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
        />
      </div>
    </div>
  );
}

// ── Step 2 : Problème ─────────────────────────────────────────────────────

function Step2({
  type, setType, description, setDescription, priorite, setPriorite,
}: {
  type: TypeIntervention | ''; setType: (v: TypeIntervention | '') => void;
  description: string; setDescription: (v: string) => void;
  priorite: PrioriteIntervention; setPriorite: (v: PrioriteIntervention) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">2. Description du problème</h3>
      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">Type *</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TypeIntervention)}
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white"
        >
          <option value="">— Sélectionner —</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">Description *</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Décrivez le problème, l'étage, les dégâts visibles…"
          rows={5}
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y min-h-[100px]"
        />
        <p className="text-[11px] text-ink-muted mt-1">{description.trim().length} caractère(s)</p>
      </div>
      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">Priorité</label>
        <div className="grid grid-cols-2 gap-2">
          {(['normale', 'urgente'] as PrioriteIntervention[]).map((p) => (
            <label
              key={p}
              className={
                'px-3.5 py-2.5 border-2 rounded-lg cursor-pointer flex items-center gap-2 text-xs ' +
                (priorite === p ? 'border-navy bg-navy-pale' : 'border-sand-border bg-white')
              }
            >
              <input
                type="radio"
                name="priorite"
                checked={priorite === p}
                onChange={() => setPriorite(p)}
                className="accent-[#1B3A6B]"
              />
              {p === 'urgente' ? '⚡ Urgente' : 'Normale'}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 3 : Occupants ────────────────────────────────────────────────────

function Step3({
  occupants, onAdd, onRemove, onUpdate,
}: {
  occupants: OccupantInput[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, field: keyof OccupantInput, v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-navy">3. Occupants concernés</h3>
        <p className="text-[12px] text-ink-mid mt-1">
          Optionnel. Chacun recevra un lien de confirmation personnalisé une fois la demande validée.
        </p>
      </div>
      <div className="space-y-2.5">
        {occupants.map((o, i) => (
          <div key={i} className="bg-white border border-sand-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                Occupant {i + 1}
              </span>
              {occupants.length > 1 && (
                <button
                  onClick={() => onRemove(i)}
                  className="text-[11px] text-terra hover:underline"
                >
                  Supprimer
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Apt." value={o.appartement} onChange={(v) => onUpdate(i, 'appartement', v)} placeholder="3B" />
              <Field label="Nom" value={o.nom} onChange={(v) => onUpdate(i, 'nom', v)} placeholder="Dupont Marc" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Field label="Email" value={o.email} onChange={(v) => onUpdate(i, 'email', v)} placeholder="dupont@..." type="email" />
              <Field label="Téléphone" value={o.telephone} onChange={(v) => onUpdate(i, 'telephone', v)} placeholder="+32…" type="tel" />
            </div>
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="bg-sand-mid text-ink-mid px-3.5 py-2 rounded-lg text-xs font-semibold">
        + Ajouter un occupant
      </button>
    </div>
  );
}

// ── Step 4 : Créneau ──────────────────────────────────────────────────────

function Step4({
  date, setDate, heure, setHeure, preselected,
}: {
  date: string; setDate: (v: string) => void;
  heure: string; setHeure: (v: string) => void;
  preselected: boolean;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">4. Créneau souhaité</h3>
      <p className="text-[12px] text-ink-mid">
        Non contractuel — FoxO confirmera sous 24h ouvrables.
      </p>
      {preselected && (
        <div className="bg-ok-light border border-ok-mid rounded-lg px-3.5 py-2.5 text-[13px] text-ok">
          ✅ Créneau pré-sélectionné depuis le calendrier
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" type="date" value={date} onChange={setDate} />
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Heure</label>
          <select
            value={heure}
            onChange={(e) => setHeure(e.target.value)}
            className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white"
          >
            <option value="">— Indifférent —</option>
            {HOURS.map((h) => <option key={h} value={h}>{h.replace(':', 'h')}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-ink-muted">
        Vous pouvez aussi laisser vide — FoxO vous proposera un créneau.
      </p>
    </div>
  );
}

// ── Step 5 : Facturation ──────────────────────────────────────────────────

function Step5({
  nom, setNom, email, setEmail, bce, setBce, refBC, setRefBC,
}: {
  nom: string; setNom: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  bce: string; setBce: (v: string) => void;
  refBC: string; setRefBC: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">5. Facturation</h3>
      <p className="text-[12px] text-ink-mid">
        Pré-rempli avec les coordonnées de votre société. Modifiez si nécessaire.
      </p>
      <Field label="Destinataire de la facture" value={nom} onChange={setNom} placeholder="Nom ou raison sociale" />
      <Field label="Email facturation" value={email} onChange={setEmail} placeholder="facturation@…" type="email" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Numéro BCE" value={bce} onChange={setBce} placeholder="BE0123.456.789" />
        <Field label="Référence bon de commande" value={refBC} onChange={setRefBC} placeholder="BC-2026-…" />
      </div>
    </div>
  );
}

// ── Step 1 COURTIER : sinistre ──────────────────────────────────────────

function Step1Courtier({
  assureNom, setAssureNom,
  rue, setRue,
  codePostal, setCodePostal,
  ville, setVille,
  refCompagnie, setRefCompagnie,
  referenceSinistre, setReferenceSinistre,
  compagnieAssurance, setCompagnieAssurance,
}: {
  assureNom: string; setAssureNom: (v: string) => void;
  rue: string; setRue: (v: string) => void;
  codePostal: string; setCodePostal: (v: string) => void;
  ville: string; setVille: (v: string) => void;
  refCompagnie: string; setRefCompagnie: (v: string) => void;
  referenceSinistre: string; setReferenceSinistre: (v: string) => void;
  compagnieAssurance: string; setCompagnieAssurance: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold" style={{ color: '#1D6FA4' }}>1. Sinistre</h3>

      <Field label="Nom de l'assuré *" value={assureNom} onChange={setAssureNom} placeholder="ex : SPRL Dupont — Cabinet d'expertise" />

      <AddressAutocomplete
        label="Adresse du sinistre"
        value={{
          adresse: rue,
          rue: '',
          numero: '',
          code_postal: codePostal,
          ville,
          pays: 'BE',
          lat: null,
          lng: null,
          verified: false,
        }}
        onChange={(v) => {
          setRue(v.adresse);
          setCodePostal(v.code_postal);
          setVille(v.ville);
        }}
        placeholder="Rue du Marché 10, 1000 Bruxelles"
        required
      />

      <Field
        label="Référence compagnie *"
        value={refCompagnie}
        onChange={setRefCompagnie}
        placeholder="Numéro de dossier interne (ex : SIN-2026-1234)"
      />

      <div className="rounded-lg p-3" style={{ background: '#EAF2F8', border: '1px solid #A8C8E0' }}>
        <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#1D6FA4' }}>
          🏛️ Informations assurance
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field
            label="Référence sinistre"
            value={referenceSinistre}
            onChange={setReferenceSinistre}
            placeholder="ex : 2026/87234"
          />
          <Field
            label="Compagnie d'assurance"
            value={compagnieAssurance}
            onChange={setCompagnieAssurance}
            placeholder="ex : Ethias, AXA, Allianz…"
          />
        </div>
        <p className="text-[10px] mt-2" style={{ color: '#1D6FA4' }}>
          Optionnels. Apparaissent sur la fiche du dossier et permettent au technicien
          de référencer le sinistre auprès de la compagnie.
        </p>
      </div>

      <p className="text-[11px] text-ink-muted">
        La référence compagnie vous permettra de retrouver le dossier dans votre liste
        et apparaîtra sur les rapports/factures.
      </p>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-ink-mid block mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
      />
    </div>
  );
}
