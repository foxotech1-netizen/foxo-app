'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import type { Slot } from '@/lib/portal/availability';
import { submitRdv } from './actions';

const TYPES = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
];

const HOURS = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const STEP_LABELS = ['Coordonnées', 'Problème', 'Créneau', 'Confirmation'];

type Step = 1 | 2 | 3 | 4;

type MonthData = { year: number; month: number; slots: Slot[] };

export function RdvClient({ months }: { months: MonthData[] }) {
  const [activeMonth, setActiveMonth] = useState(0); // 0 ou 1
  const [step, setStep] = useState<Step>(1);
  const [submitting, startTransition] = useTransition();
  const [success, setSuccess] = useState<{ ref: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Form state
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');

  const [rue, setRue] = useState('');
  const [codePostal, setCodePostal] = useState('');
  const [ville, setVille] = useState('');
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [priorite, setPriorite] = useState<'normale' | 'urgente'>('normale');
  const [photos, setPhotos] = useState<File[]>([]);

  const [creneauDate, setCreneauDate] = useState('');
  const [creneauHeure, setCreneauHeure] = useState('');
  const [creneauPreSelected, setCreneauPreSelected] = useState(false);

  const [accepted, setAccepted] = useState(false);

  const [stepError, setStepError] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  function pickSlot(s: Slot) {
    setCreneauDate(s.date);
    setCreneauHeure(s.hour);
    setCreneauPreSelected(true);
    // scroll vers le form
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Retourne null si l'étape est OK, sinon le message à afficher.
  function validateStep(): string | null {
    switch (step) {
      case 1:
        if (!prenom.trim()) return 'Indiquez votre prénom.';
        if (!nom.trim()) return 'Indiquez votre nom.';
        if (!email.trim()) return 'Indiquez votre email.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Email invalide.';
        if (!telephone.trim()) return 'Indiquez votre numéro de téléphone.';
        return null;
      case 2:
        if (!rue.trim() || !codePostal.trim() || !ville.trim()) {
          return 'Adresse complète requise (rue, code postal, ville).';
        }
        if (!type) return 'Sélectionnez un type d\'intervention.';
        if (description.trim().length < 10) {
          return 'Décrivez le problème en 10 caractères minimum.';
        }
        return null;
      case 3:
        return null; // créneau optionnel
      case 4:
        if (!accepted) return 'Cochez la case pour confirmer votre demande.';
        return null;
    }
  }

  function tryAdvance() {
    const err = validateStep();
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(4, s + 1) as Step);
  }

  function tryGoBack() {
    setStepError(null);
    setStep((s) => Math.max(1, s - 1) as Step);
  }

  function trySubmit() {
    const err = validateStep();
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    void handleSubmit();
  }

  function onPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPhotos((cur) => [...cur, ...files].slice(0, 3));
    if (photosInputRef.current) photosInputRef.current.value = '';
  }
  function removePhoto(i: number) {
    setPhotos((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    setServerError(null);
    let creneauIso: string | null = null;
    if (creneauDate) {
      const heure = creneauHeure || '09:00';
      creneauIso = new Date(`${creneauDate}T${heure}:00`).toISOString();
    }
    const fd = new FormData();
    fd.append('data', JSON.stringify({
      prenom, nom, email, telephone,
      rue, code_postal: codePostal, ville,
      type, description, priorite,
      creneauIso,
    }));
    photos.forEach((p, i) => fd.append(`photo_${i}`, p));

    startTransition(async () => {
      const res = await submitRdv(fd);
      if (res.ok) {
        setSuccess(res.data);
      } else {
        setServerError(res.error);
      }
    });
  }

  // ── Vue succès ─────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="bg-cream border border-sand-border rounded-2xl p-8 text-center max-w-[560px] mx-auto mt-4">
        <div className="text-5xl mb-3">🎉</div>
        <h1 className="text-2xl font-extrabold text-ok">Demande reçue !</h1>
        <p className="text-sm text-ink-mid mt-2 leading-relaxed">
          Un email de confirmation vous a été envoyé.<br />
          FoxO vous confirmera un créneau sous <strong>24h ouvrables</strong>.
        </p>
        <div className="mt-5 inline-block bg-sand border border-sand-border rounded-xl px-5 py-3">
          <div className="text-[10px] text-ink-muted uppercase tracking-wider font-bold">Référence</div>
          <div className="text-lg font-bold text-navy font-mono mt-1">{success.ref}</div>
        </div>
      </div>
    );
  }

  // ── Vue principale ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-ink">Demander une intervention</h1>
        <p className="text-sm text-ink-mid mt-1">
          Choisissez un créneau dans le calendrier ou complétez directement le formulaire.
        </p>
      </div>

      {/* CALENDRIER */}
      <CalendarWidget
        months={months}
        active={activeMonth}
        onChange={setActiveMonth}
        onPick={pickSlot}
        selectedIso={creneauPreSelected ? `${creneauDate}T${creneauHeure}:00` : null}
      />

      {/* FORM */}
      <div ref={formRef} className="bg-cream border border-sand-border rounded-2xl overflow-hidden">
        <StepIndicator step={step} />

        <div className="p-5 sm:p-6">
          {step === 1 && (
            <Step1
              prenom={prenom} setPrenom={setPrenom}
              nom={nom} setNom={setNom}
              email={email} setEmail={setEmail}
              telephone={telephone} setTelephone={setTelephone}
            />
          )}
          {step === 2 && (
            <Step2
              rue={rue} setRue={setRue}
              codePostal={codePostal} setCodePostal={setCodePostal}
              ville={ville} setVille={setVille}
              type={type} setType={setType}
              description={description} setDescription={setDescription}
              priorite={priorite} setPriorite={setPriorite}
              photos={photos} onPhotos={onPhotos}
              onRemovePhoto={removePhoto}
              photosInputRef={photosInputRef}
            />
          )}
          {step === 3 && (
            <Step3
              date={creneauDate} setDate={setCreneauDate}
              heure={creneauHeure} setHeure={setCreneauHeure}
              preSelected={creneauPreSelected}
              onClear={() => { setCreneauDate(''); setCreneauHeure(''); setCreneauPreSelected(false); }}
            />
          )}
          {step === 4 && (
            <Step4
              prenom={prenom} nom={nom} email={email} telephone={telephone}
              rue={rue} codePostal={codePostal} ville={ville}
              type={type} description={description} priorite={priorite}
              creneauDate={creneauDate} creneauHeure={creneauHeure}
              photoCount={photos.length}
              accepted={accepted} setAccepted={setAccepted}
            />
          )}

          {(stepError || serverError) && (
            <div className="mt-4 bg-terra-light border border-terra-mid text-terra rounded-lg px-3.5 py-2.5 text-xs font-semibold">
              {stepError ?? serverError}
            </div>
          )}

          <div className="flex justify-between gap-2 mt-5">
            <button
              type="button"
              onClick={tryGoBack}
              disabled={step === 1 || submitting}
              className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-50"
            >
              ← Précédent
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={tryAdvance}
                disabled={submitting}
                className="bg-navy text-white px-4 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
              >
                Suivant →
              </button>
            ) : (
              <button
                type="button"
                onClick={trySubmit}
                disabled={submitting}
                className="bg-navy text-white px-5 py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
              >
                {submitting ? 'Envoi…' : 'Confirmer ma demande'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Calendrier ─────────────────────────────────────────────────────────────

function CalendarWidget({
  months, active, onChange, onPick, selectedIso,
}: {
  months: MonthData[];
  active: number;
  onChange: (i: number) => void;
  onPick: (s: Slot) => void;
  selectedIso: string | null;
}) {
  const m = months[active];
  const cells = useMemo(() => buildGrid(m.year, m.month, m.slots), [m]);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <section className="bg-cream rounded-2xl border border-sand-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-sand-border">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-muted font-bold">Disponibilités FoxO</div>
          <div className="text-base font-bold text-ink mt-0.5">
            {MONTH_NAMES[m.month]} {m.year}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, active - 1))}
            disabled={active === 0}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border disabled:opacity-40"
          >‹</button>
          <button
            type="button"
            onClick={() => onChange(Math.min(months.length - 1, active + 1))}
            disabled={active >= months.length - 1}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border disabled:opacity-40"
          >›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-sand-border">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="bg-sand text-center py-2 text-[10px] font-bold text-ink-muted uppercase">
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={c.key}
            className={
              'p-1.5 sm:p-2 min-h-[72px] ' +
              (c.inMonth
                ? c.iso === todayStr ? 'bg-navy-pale' : 'bg-cream'
                : 'bg-[#FAFAF8] opacity-50')
            }
          >
            {c.inMonth && (
              <div className={
                'text-[11px] font-semibold mb-1 ' +
                (c.iso === todayStr ? 'text-navy font-extrabold' : 'text-ink-mid')
              }>
                {c.day}
              </div>
            )}
            <div className="space-y-0.5">
              {c.slots.map((s) => {
                const time = s.hour.replace(':', 'h');
                const isSelected = selectedIso === s.iso;
                if (s.status === 'libre') {
                  return (
                    <button
                      key={s.iso}
                      type="button"
                      onClick={() => onPick(s)}
                      className={
                        'block w-full text-[10px] font-semibold rounded px-1.5 py-0.5 truncate transition-colors ' +
                        (isSelected
                          ? 'bg-navy text-white'
                          : 'bg-ok-light text-ok hover:bg-[#C8E5D5]')
                      }
                    >
                      {time}{isSelected ? ' ✓' : ''}
                    </button>
                  );
                }
                if (s.status === 'reserve') {
                  return (
                    <div key={s.iso} className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-navy-light text-navy truncate">
                      {time}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-sand-border">
        <Legend bg="bg-ok-light" border="border-ok-mid" label="Disponible" />
        <Legend bg="bg-navy-light" border="border-navy-mid" label="Réservé" />
        <Legend bg="bg-navy" border="border-navy" label="Sélectionné" textWhite />
      </div>
    </section>
  );
}

function Legend({ bg, border, label, textWhite }: { bg: string; border: string; label: string; textWhite?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-mid">
      <span className={`w-3 h-3 rounded-sm ${bg} ${border} border ${textWhite ? '' : ''}`} />
      {label}
    </div>
  );
}

type Cell = {
  key: string;
  day: number;
  inMonth: boolean;
  iso: string;
  slots: Slot[];
};

function buildGrid(year: number, month: number, slots: Slot[]): Cell[] {
  const byDate = new Map<string, Slot[]>();
  for (const s of slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }

  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const startDow = (firstOfMonth.getDay() + 6) % 7;

  const cells: Cell[] = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -(startDow - i - 1));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cells.push({ key: `pad-${i}`, day: d.getDate(), inMonth: false, iso, slots: [] });
  }
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ key: iso, day: d, inMonth: true, iso, slots: byDate.get(iso) ?? [] });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ key: `tail-${cells.length}`, day: 0, inMonth: false, iso: '', slots: [] });
  }
  return cells;
}

// ── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  return (
    <div className="bg-sand border-b border-sand-border px-4 py-3">
      <div className="flex gap-1.5 sm:gap-2 items-center">
        {STEP_LABELS.map((label, i) => {
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
              }>{label}</span>
              {i < STEP_LABELS.length - 1 && (
                <div className={'flex-1 h-px ' + (n < step ? 'bg-ok' : 'bg-sand-border')} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, type = 'text', placeholder, required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-ink-mid block mb-1.5">
        {label}{required && <span className="text-terra"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
      />
    </div>
  );
}

function Step1(props: {
  prenom: string; setPrenom: (v: string) => void;
  nom: string; setNom: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  telephone: string; setTelephone: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">1. Vos coordonnées</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Prénom" value={props.prenom} onChange={props.setPrenom} required />
        <Field label="Nom" value={props.nom} onChange={props.setNom} required />
      </div>
      <Field label="Email" type="email" value={props.email} onChange={props.setEmail} placeholder="vous@exemple.be" required />
      <Field label="Téléphone" type="tel" value={props.telephone} onChange={props.setTelephone} placeholder="+32 ..." required />
    </div>
  );
}

function Step2(props: {
  rue: string; setRue: (v: string) => void;
  codePostal: string; setCodePostal: (v: string) => void;
  ville: string; setVille: (v: string) => void;
  type: string; setType: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  priorite: 'normale' | 'urgente'; setPriorite: (v: 'normale' | 'urgente') => void;
  photos: File[];
  onPhotos: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemovePhoto: (i: number) => void;
  photosInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">2. Le problème</h3>

      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">
          Adresse du logement <span className="text-terra">*</span>
        </label>
        <input
          value={props.rue}
          onChange={(e) => props.setRue(e.target.value)}
          placeholder="Rue et numéro"
          required
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid mb-2"
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            value={props.codePostal}
            onChange={(e) => props.setCodePostal(e.target.value)}
            placeholder="Code postal"
            required
            className="col-span-1 px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          />
          <input
            value={props.ville}
            onChange={(e) => props.setVille(e.target.value)}
            placeholder="Ville"
            required
            className="col-span-2 px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">
          Type d&apos;intervention <span className="text-terra">*</span>
        </label>
        <select
          value={props.type}
          onChange={(e) => props.setType(e.target.value)}
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white"
          required
        >
          <option value="">— Sélectionner —</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">
          Description détaillée <span className="text-terra">*</span>
        </label>
        <textarea
          value={props.description}
          onChange={(e) => props.setDescription(e.target.value)}
          placeholder="Décrivez le problème, l'étage, les dégâts visibles…"
          rows={5}
          required
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y min-h-[100px]"
        />
        <p className="text-[11px] text-ink-muted mt-1">
          {props.description.trim().length} caractère(s) — minimum 10
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">Priorité</label>
        <div className="grid grid-cols-2 gap-2">
          {(['normale', 'urgente'] as const).map((p) => (
            <label
              key={p}
              className={
                'px-3.5 py-2.5 border-2 rounded-lg cursor-pointer flex items-center gap-2 text-xs ' +
                (props.priorite === p ? 'border-navy bg-navy-pale' : 'border-sand-border bg-white')
              }
            >
              <input
                type="radio"
                name="priorite"
                checked={props.priorite === p}
                onChange={() => props.setPriorite(p)}
                className="accent-[#1B3A6B]"
              />
              {p === 'urgente' ? '⚡ Urgente' : 'Normale'}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">Photos (facultatif, max 3)</label>
        <input
          ref={props.photosInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={props.onPhotos}
          className="hidden"
          id="rdv-photos"
        />
        <label
          htmlFor="rdv-photos"
          className={
            'inline-block px-4 py-2.5 rounded-lg text-xs font-semibold cursor-pointer ' +
            (props.photos.length >= 3
              ? 'bg-sand-mid text-ink-muted cursor-not-allowed'
              : 'bg-sand-mid text-ink-mid hover:bg-sand-border')
          }
        >
          📷 {props.photos.length >= 3 ? 'Maximum atteint' : 'Ajouter des photos'}
        </label>
        {props.photos.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {props.photos.map((p, i) => (
              <div key={i} className="flex items-center justify-between bg-sand rounded-md px-3 py-1.5 text-[12px]">
                <span className="truncate flex-1">{p.name}</span>
                <span className="text-ink-muted text-[11px] mx-2">{(p.size / 1024 / 1024).toFixed(1)} MB</span>
                <button
                  type="button"
                  onClick={() => props.onRemovePhoto(i)}
                  className="text-terra hover:underline text-[11px]"
                >Retirer</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Step3(props: {
  date: string; setDate: (v: string) => void;
  heure: string; setHeure: (v: string) => void;
  preSelected: boolean;
  onClear: () => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">3. Créneau souhaité</h3>
      <p className="text-xs text-ink-mid">Non contractuel — FoxO confirmera sous 24h ouvrables.</p>
      {props.preSelected && (
        <div className="bg-ok-light border border-ok-mid rounded-lg px-3.5 py-2.5 text-[13px] text-ok flex justify-between items-center">
          <span>✅ Créneau pré-sélectionné depuis le calendrier</span>
          <button
            type="button"
            onClick={props.onClear}
            className="text-[11px] text-ok underline hover:no-underline"
          >Modifier</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Date</label>
          <input
            type="date"
            value={props.date}
            onChange={(e) => props.setDate(e.target.value)}
            className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Heure</label>
          <select
            value={props.heure}
            onChange={(e) => props.setHeure(e.target.value)}
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

function Step4(props: {
  prenom: string; nom: string; email: string; telephone: string;
  rue: string; codePostal: string; ville: string;
  type: string; description: string; priorite: 'normale' | 'urgente';
  creneauDate: string; creneauHeure: string;
  photoCount: number;
  accepted: boolean; setAccepted: (v: boolean) => void;
}) {
  const adresse = `${props.rue}, ${props.codePostal} ${props.ville}`;
  const creneau = props.creneauDate
    ? `${props.creneauDate}${props.creneauHeure ? ' à ' + props.creneauHeure.replace(':', 'h') : ''}`
    : 'À définir avec FoxO';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-navy">4. Récapitulatif</h3>
      <div className="bg-sand rounded-xl p-4 border border-sand-border space-y-2 text-[13px]">
        <Row label="Demandeur" value={`${props.prenom} ${props.nom}`} />
        <Row label="Email" value={props.email} mono />
        <Row label="Téléphone" value={props.telephone} mono />
        <Row label="Adresse" value={adresse} />
        <Row label="Type" value={props.type} />
        <Row label="Priorité" value={props.priorite === 'urgente' ? '⚡ Urgente' : 'Normale'} />
        <Row label="Créneau" value={creneau} />
        {props.photoCount > 0 && <Row label="Photos" value={`${props.photoCount} jointe(s)`} />}
      </div>

      <div className="bg-cream border border-sand-border rounded-lg p-3 text-[12px] text-ink-mid leading-relaxed">
        <strong className="text-ink block mb-1">Description :</strong>
        <p className="whitespace-pre-wrap">{props.description}</p>
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={props.accepted}
          onChange={(e) => props.setAccepted(e.target.checked)}
          className="mt-0.5 accent-[#1B3A6B]"
        />
        <span className="text-[12px] text-ink-mid leading-relaxed">
          J&apos;accepte d&apos;être contacté par FoxO pour confirmation du créneau et accepte le traitement de mes données pour le suivi de cette demande.
        </span>
      </label>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <span className="text-[11px] text-ink-muted uppercase tracking-wider font-bold col-span-1">{label}</span>
      <span className={'col-span-2 ' + (mono ? 'font-mono text-xs' : '')}>{value}</span>
    </div>
  );
}
