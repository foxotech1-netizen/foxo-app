'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { Camera, Check, CheckCircle2, ChevronDown, Shield, Zap } from 'lucide-react';
import type { Slot } from '@/lib/portal/availability';
import { Logo } from '@/components/Logo';
import { submitRdv } from './actions';
import { AddressAutocomplete } from '@/components/AddressAutocomplete';

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

  // Form state — Mandant
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [bce, setBce] = useState('');

  // Adresse facturation (mandant)
  const [rue, setRue] = useState('');
  const [codePostal, setCodePostal] = useState('');
  const [ville, setVille] = useState('');

  // Lieu d'intervention
  const [lieuMeme, setLieuMeme] = useState(true);
  const [lieuRue, setLieuRue] = useState('');
  const [lieuCp, setLieuCp] = useState('');
  const [lieuVille, setLieuVille] = useState('');

  // Contact sur place
  const [contactActif, setContactActif] = useState(false);
  const [contactPrenom, setContactPrenom] = useState('');
  const [contactNom, setContactNom] = useState('');
  const [contactTel, setContactTel] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactInstr, setContactInstr] = useState('');

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
        if (!rue.trim() || !codePostal.trim() || !ville.trim()) {
          return 'Adresse de facturation complète requise.';
        }
        if (!lieuMeme) {
          if (!lieuRue.trim() || !lieuCp.trim() || !lieuVille.trim()) {
            return 'Adresse d\'intervention complète requise.';
          }
        }
        if (contactActif) {
          if (!contactPrenom.trim() || !contactNom.trim()) return 'Prénom + nom du contact sur place requis.';
          if (!contactTel.trim()) return 'Téléphone du contact sur place requis.';
          if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
            return 'Email du contact sur place invalide.';
          }
        }
        return null;
      case 2:
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
      prenom, nom, email, telephone, bce,
      rue, code_postal: codePostal, ville,
      lieu_meme: lieuMeme,
      lieu_rue: lieuRue,
      lieu_cp: lieuCp,
      lieu_ville: lieuVille,
      contact_actif: contactActif,
      contact_prenom: contactPrenom,
      contact_nom: contactNom,
      contact_tel: contactTel,
      contact_email: contactEmail,
      contact_instr: contactInstr,
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
      <div className="px-4 sm:px-6 py-12 max-w-[1100px] mx-auto w-full">
        <div
          className="bg-[var(--color-cream)] rounded-[10px] p-8 sm:p-10 text-center max-w-[560px] mx-auto"
          style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
        >
          {/* Icône Check géante dans cercle ok-light */}
          <div className="flex justify-center mb-5">
            <div className="w-24 h-24 rounded-full bg-[var(--color-ok-light)] flex items-center justify-center">
              <Check size={48} className="text-[var(--color-ok)]" strokeWidth={2.5} />
            </div>
          </div>
          <h1 className="font-sora text-[28px] sm:text-[32px] font-semibold text-[var(--color-ink)] tracking-tight">
            Demande envoyée
          </h1>
          <p className="text-[15px] text-[var(--color-ink-mid)] mt-3 leading-relaxed">
            Un email de confirmation vous a été envoyé.<br />
            FoxO vous confirmera un créneau sous <strong className="text-[var(--color-ink)]">24 h ouvrables</strong>.
          </p>
          <div className="mt-6 inline-block bg-[var(--color-sand-mid)] rounded-xl px-6 py-4">
            <div className="text-[11px] text-[var(--color-ink-mid)] uppercase tracking-[0.12em] font-medium">Référence</div>
            <div className="font-sora text-[20px] font-semibold text-[var(--color-navy)] font-mono tracking-[0.01em] mt-1">
              {success.ref}
            </div>
          </div>
          <div className="mt-8">
            <a
              href="/rdv"
              className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-md text-[14px] font-semibold text-[var(--color-navy)] bg-transparent border border-[var(--color-navy)] hover:bg-[var(--color-navy-pale)] transition-colors"
            >
              Retour à l&apos;accueil
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Vue principale ─────────────────────────────────────────────────────
  return (
    <>
      {/* HERO navy fort — signal de confiance institutionnelle pour
          particuliers qui découvrent FoxO. Logo blanc + titre Sora cream.
          Pattern propre à la page publique RDV (navy plus présent qu'ailleurs). */}
      <section
        className="px-4 sm:px-6 py-12 sm:py-16 text-center"
        style={{ background: 'linear-gradient(135deg, var(--color-navy) 0%, var(--color-navy-dark) 100%)' }}
      >
        <div className="max-w-[1100px] mx-auto">
          <div className="flex justify-center mb-5">
            <Logo size={56} variant="blanc" priority />
          </div>
          <h1 className="font-sora text-[32px] sm:text-[40px] md:text-[44px] font-semibold text-[var(--color-cream)] tracking-tight leading-tight">
            Demander une intervention
          </h1>
          <p className="text-[15px] sm:text-[16px] text-[var(--color-cream)]/80 mt-3 max-w-[640px] mx-auto leading-relaxed">
            Détection de fuites par des techniciens certifiés.
            Réponse confirmée sous <strong className="text-[var(--color-cream)]">24 h ouvrables</strong>.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-[13px]">
            <span className="inline-flex items-center gap-1.5 text-[var(--color-cream)]/85 bg-[var(--color-cream)]/10 border border-[var(--color-cream)]/15 px-3 py-1.5 rounded-full">
              <Shield size={14} />Détection non destructive
            </span>
            <span className="inline-flex items-center gap-1.5 text-[var(--color-cream)]/85 bg-[var(--color-cream)]/10 border border-[var(--color-cream)]/15 px-3 py-1.5 rounded-full">
              Belgique francophone &amp; néerlandophone
            </span>
            {/* TODO design system : envisager d'ajouter ici un témoignage
                syndic, des logos clients en niveau de gris discret, ou
                une garantie "Réponse sous 24h" en pill ok-light cream
                — éviter d'implémenter sans accord Christophe. */}
          </div>
          <button
            type="button"
            onClick={() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="mt-8 inline-flex items-center justify-center gap-2 min-h-[52px] px-6 rounded-md text-[15px] font-semibold bg-[var(--color-cream)] text-[var(--color-navy)] hover:bg-[var(--color-sand)] transition-colors shadow-sm"
          >
            Démarrer ma demande
            <ChevronDown size={18} />
          </button>
        </div>
      </section>

      <div className="px-4 sm:px-6 py-8 sm:py-10 max-w-[1100px] mx-auto w-full"
        style={{ paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))' }}>
      <div className="space-y-6">
      <div>
        <h2 className="font-sora text-[22px] sm:text-[24px] font-semibold text-[var(--color-ink)] tracking-tight">
          Choisissez votre créneau
        </h2>
        <p className="text-[14px] text-[var(--color-ink-mid)] mt-1">
          Cliquez sur un créneau libre ci-dessous, ou complétez directement le formulaire.
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
      <div
        ref={formRef}
        className="bg-[var(--color-cream)] rounded-[10px] overflow-hidden"
        style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
      >
        <StepIndicator step={step} />

        <div className="p-5 sm:p-7">
          {step === 1 && (
            <Step1
              prenom={prenom} setPrenom={setPrenom}
              nom={nom} setNom={setNom}
              email={email} setEmail={setEmail}
              telephone={telephone} setTelephone={setTelephone}
              rue={rue} setRue={setRue}
              codePostal={codePostal} setCodePostal={setCodePostal}
              ville={ville} setVille={setVille}
              bce={bce} setBce={setBce}
              lieuMeme={lieuMeme} setLieuMeme={setLieuMeme}
              lieuRue={lieuRue} setLieuRue={setLieuRue}
              lieuCp={lieuCp} setLieuCp={setLieuCp}
              lieuVille={lieuVille} setLieuVille={setLieuVille}
              contactActif={contactActif} setContactActif={setContactActif}
              contactPrenom={contactPrenom} setContactPrenom={setContactPrenom}
              contactNom={contactNom} setContactNom={setContactNom}
              contactTel={contactTel} setContactTel={setContactTel}
              contactEmail={contactEmail} setContactEmail={setContactEmail}
              contactInstr={contactInstr} setContactInstr={setContactInstr}
            />
          )}
          {step === 2 && (
            <Step2
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
              rue={lieuMeme ? rue : lieuRue}
              codePostal={lieuMeme ? codePostal : lieuCp}
              ville={lieuMeme ? ville : lieuVille}
              type={type} description={description} priorite={priorite}
              creneauDate={creneauDate} creneauHeure={creneauHeure}
              photoCount={photos.length}
              accepted={accepted} setAccepted={setAccepted}
            />
          )}

          {(stepError || serverError) && (
            <div className="mt-4 bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] text-[var(--color-terra)] rounded-lg px-4 py-3 text-[13px] font-medium">
              {stepError ?? serverError}
            </div>
          )}

          <div className="flex justify-between gap-3 mt-6 pt-5 border-t border-[var(--color-sand-mid)]">
            <button
              type="button"
              onClick={tryGoBack}
              disabled={step === 1 || submitting}
              className="px-4 sm:px-5 min-h-[48px] rounded-md text-[14px] font-medium bg-[var(--color-cream)] text-[var(--color-ink)] border border-[var(--color-sand-border)] hover:bg-[var(--color-sand-hover)] disabled:opacity-50 transition-colors"
            >
              ← Précédent
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={tryAdvance}
                disabled={submitting}
                className="px-5 sm:px-6 min-h-[48px] rounded-md text-[14px] font-semibold bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] disabled:opacity-50 transition-colors shadow-sm"
              >
                Suivant →
              </button>
            ) : (
              <button
                type="button"
                onClick={trySubmit}
                disabled={submitting}
                className="px-5 sm:px-6 min-h-[56px] rounded-md text-[15px] font-semibold bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] disabled:opacity-50 transition-colors shadow-sm inline-flex items-center justify-center gap-2"
              >
                {submitting ? 'Envoi en cours…' : (<><Check size={18} />Confirmer ma demande</>)}
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      </div>
    </>
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
    <section className="bg-[var(--card-bg)] rounded-2xl border border-[var(--card-border)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)]">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-3)] font-bold">Disponibilités FoxO</div>
          <div className="text-base font-bold text-[var(--text)] mt-0.5">
            {MONTH_NAMES[m.month]} {m.year}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(Math.max(0, active - 1))}
            disabled={active === 0}
            className="bg-[var(--card-border-2)] w-8 h-8 rounded-md text-[var(--text-2)] hover:bg-[var(--card-border)] disabled:opacity-40"
          >‹</button>
          <button
            type="button"
            onClick={() => onChange(Math.min(months.length - 1, active + 1))}
            disabled={active >= months.length - 1}
            className="bg-[var(--card-border-2)] w-8 h-8 rounded-md text-[var(--text-2)] hover:bg-[var(--card-border)] disabled:opacity-40"
          >›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-[var(--card-border)]">
        {DAYS_SHORT.map((d) => (
          <div key={d} className="bg-[var(--table-bg)] text-center py-2 text-[10px] font-bold text-[var(--text-3)] uppercase">
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={c.key}
            className={
              'p-1.5 sm:p-2 min-h-[72px] ' +
              (c.inMonth
                ? c.iso === todayStr ? 'bg-[var(--accent-dim)]' : 'bg-[var(--card-bg)]'
                : 'bg-[var(--main-bg)] opacity-50')
            }
          >
            {c.inMonth && (
              <div className={
                'text-[11px] font-semibold mb-1 ' +
                (c.iso === todayStr ? 'text-[var(--accent)] font-extrabold' : 'text-[var(--text-2)]')
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
                        'flex items-center justify-center gap-1 w-full text-[10px] font-semibold rounded px-1.5 py-0.5 truncate transition-colors ' +
                        (isSelected
                          ? 'bg-[var(--btn-bg)] text-[var(--btn-color)]'
                          : 'bg-ok-light text-ok hover:bg-[#C8E5D5]')
                      }
                    >
                      <span>{time}</span>
                      {isSelected && <Check size={12} />}
                    </button>
                  );
                }
                if (s.status === 'reserve') {
                  return (
                    <div key={s.iso} className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-[var(--accent-dim)] text-[var(--accent)] truncate">
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

      <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-[var(--card-border)]">
        <Legend swatchClass="bg-ok-light border-ok-mid" label="Disponible" />
        <Legend swatchClass="bg-[var(--accent-dim)] border-[var(--accent)]" label="Réservé" />
        <Legend swatchClass="bg-[var(--btn-bg)] border-[var(--btn-bg)]" label="Sélectionné" />
      </div>
    </section>
  );
}

function Legend({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
      <span className={`w-3 h-3 rounded-sm border ${swatchClass}`} />
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
    <div className="bg-[var(--table-bg)] border-b border-[var(--card-border)] px-4 py-3">
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
                    state === 'active' ? 'bg-[var(--btn-bg)] text-[var(--btn-color)]' :
                    'bg-[var(--card-border-2)] text-[var(--text-3)]')
                }
              >
                {state === 'done' ? <Check size={14} /> : n}
              </div>
              <span className={
                'text-[11px] font-semibold truncate hidden sm:inline ' +
                (state === 'active' ? 'text-[var(--accent)]' : 'text-[var(--text-2)]')
              }>{label}</span>
              {i < STEP_LABELS.length - 1 && (
                <div className={'flex-1 h-px ' + (n < step ? 'bg-ok' : 'bg-[var(--card-border)]')} />
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
      <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">
        {label}{required && <span className="text-terra"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}

function Step1(props: {
  prenom: string; setPrenom: (v: string) => void;
  nom: string; setNom: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  telephone: string; setTelephone: (v: string) => void;
  rue: string; setRue: (v: string) => void;
  codePostal: string; setCodePostal: (v: string) => void;
  ville: string; setVille: (v: string) => void;
  bce: string; setBce: (v: string) => void;
  lieuMeme: boolean; setLieuMeme: (v: boolean) => void;
  lieuRue: string; setLieuRue: (v: string) => void;
  lieuCp: string; setLieuCp: (v: string) => void;
  lieuVille: string; setLieuVille: (v: string) => void;
  contactActif: boolean; setContactActif: (v: boolean) => void;
  contactPrenom: string; setContactPrenom: (v: string) => void;
  contactNom: string; setContactNom: (v: string) => void;
  contactTel: string; setContactTel: (v: string) => void;
  contactEmail: string; setContactEmail: (v: string) => void;
  contactInstr: string; setContactInstr: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Section 1 : Mandant */}
      <section>
        <h3 className="text-sm font-bold text-[var(--accent)] mb-3">
          Vos coordonnées <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] ml-1">(mandant — facturation)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Prénom" value={props.prenom} onChange={props.setPrenom} required />
          <Field label="Nom" value={props.nom} onChange={props.setNom} required />
        </div>
        <div className="mt-3">
          <Field label="Email" type="email" value={props.email} onChange={props.setEmail} placeholder="vous@exemple.be" required />
        </div>
        <div className="mt-3">
          <Field label="Téléphone" type="tel" value={props.telephone} onChange={props.setTelephone} placeholder="+32 ..." required />
        </div>
        <div className="mt-3">
          <AddressAutocomplete
            label="Adresse de facturation"
            required
            value={{
              adresse: props.rue,
              rue: '',
              numero: '',
              code_postal: props.codePostal,
              ville: props.ville,
              pays: 'Belgique',
              lat: null,
              lng: null,
              verified: false,
            }}
            onChange={(addr) => {
              props.setRue(addr.adresse);
              if (addr.code_postal) props.setCodePostal(addr.code_postal);
              if (addr.ville) props.setVille(addr.ville);
            }}
            placeholder="Commence à taper la rue…"
          />
        </div>
        <div className="mt-3">
          <Field
            label="BCE / TVA (optionnel — si professionnel)"
            value={props.bce}
            onChange={props.setBce}
            placeholder="BE0123.456.789"
          />
        </div>
      </section>

      {/* Section 2 : Lieu d'intervention */}
      <section className="border-t border-[var(--card-border)] pt-4">
        <h3 className="text-sm font-bold text-[var(--accent)] mb-3">Lieu d&apos;intervention</h3>
        <label className="flex items-center gap-2 text-[13px] cursor-pointer mb-3 text-[var(--text)]">
          <input
            type="checkbox"
            checked={props.lieuMeme}
            onChange={(e) => props.setLieuMeme(e.target.checked)}
            className="accent-[var(--btn-bg)]"
          />
          Même adresse que ci-dessus
        </label>
        {!props.lieuMeme && (
          <div>
            <input
              value={props.lieuRue}
              onChange={(e) => props.setLieuRue(e.target.value)}
              placeholder="Rue et numéro de l'intervention"
              className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] mb-2"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                value={props.lieuCp}
                onChange={(e) => props.setLieuCp(e.target.value)}
                placeholder="Code postal"
                className="col-span-1 px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
              <input
                value={props.lieuVille}
                onChange={(e) => props.setLieuVille(e.target.value)}
                placeholder="Ville"
                className="col-span-2 px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
        )}
      </section>

      {/* Section 3 : Contact sur place (optionnel) */}
      <section className="border-t border-[var(--card-border)] pt-4">
        <h3 className="text-sm font-bold text-[var(--accent)] mb-3">
          Contact sur place <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)] ml-1">(optionnel)</span>
        </h3>
        <label className="flex items-center gap-2 text-[13px] cursor-pointer mb-3 text-[var(--text)]">
          <input
            type="checkbox"
            checked={props.contactActif}
            onChange={(e) => props.setContactActif(e.target.checked)}
            className="accent-[var(--btn-bg)]"
          />
          Contact différent de moi
        </label>
        {props.contactActif && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Prénom" value={props.contactPrenom} onChange={props.setContactPrenom} required />
              <Field label="Nom" value={props.contactNom} onChange={props.setContactNom} required />
            </div>
            <Field label="Téléphone" type="tel" value={props.contactTel} onChange={props.setContactTel} placeholder="+32 ..." required />
            <Field label="Email (optionnel)" type="email" value={props.contactEmail} onChange={props.setContactEmail} placeholder="contact@..." />
            <div>
              <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">
                Instructions d&apos;accès
              </label>
              <textarea
                value={props.contactInstr}
                onChange={(e) => props.setContactInstr(e.target.value)}
                placeholder="Digicode, gardien, créneau d'accès…"
                rows={3}
                className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Step2(props: {
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
      <h3 className="text-sm font-bold text-[var(--accent)]">2. Le problème</h3>

      <div>
        <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">
          Type d&apos;intervention <span className="text-terra">*</span>
        </label>
        <select
          value={props.type}
          onChange={(e) => props.setType(e.target.value)}
          className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)]"
          required
        >
          <option value="">— Sélectionner —</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">
          Description détaillée <span className="text-terra">*</span>
        </label>
        <textarea
          value={props.description}
          onChange={(e) => props.setDescription(e.target.value)}
          placeholder="Décrivez le problème, l'étage, les dégâts visibles…"
          rows={5}
          required
          className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y min-h-[100px]"
        />
        <p className="text-[11px] text-[var(--text-3)] mt-1">
          {props.description.trim().length} caractère(s) — minimum 10
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">Priorité</label>
        <div className="grid grid-cols-2 gap-2">
          {(['normale', 'urgente'] as const).map((p) => (
            <label
              key={p}
              className={
                'px-3.5 py-2.5 border-2 rounded-lg cursor-pointer flex items-center gap-2 text-xs ' +
                (props.priorite === p
                  ? 'border-[var(--btn-bg)] bg-[var(--accent-dim)] text-[var(--text)]'
                  : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text)]')
              }
            >
              <input
                type="radio"
                name="priorite"
                checked={props.priorite === p}
                onChange={() => props.setPriorite(p)}
                className="accent-[var(--btn-bg)]"
              />
              {p === 'urgente' ? (
                <span className="inline-flex items-center gap-1">
                  <Zap size={14} /> Urgente
                </span>
              ) : 'Normale'}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">Photos (facultatif, max 3)</label>
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
            'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold cursor-pointer ' +
            (props.photos.length >= 3
              ? 'bg-[var(--card-border-2)] text-[var(--text-3)] cursor-not-allowed'
              : 'bg-[var(--card-border-2)] text-[var(--text-2)] hover:bg-[var(--card-border)]')
          }
        >
          <Camera size={14} />
          {props.photos.length >= 3 ? 'Maximum atteint' : 'Ajouter des photos'}
        </label>
        {props.photos.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {props.photos.map((p, i) => (
              <div key={i} className="flex items-center justify-between bg-[var(--table-bg)] rounded-md px-3 py-1.5 text-[12px] text-[var(--text)]">
                <span className="truncate flex-1">{p.name}</span>
                <span className="text-[var(--text-3)] text-[11px] mx-2">{(p.size / 1024 / 1024).toFixed(1)} MB</span>
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
      <h3 className="text-sm font-bold text-[var(--accent)]">3. Créneau souhaité</h3>
      <p className="text-xs text-[var(--text-2)]">Non contractuel — FoxO confirmera sous 24h ouvrables.</p>
      {props.preSelected && (
        <div className="bg-ok-light border border-ok-mid rounded-lg px-3.5 py-2.5 text-[13px] text-ok flex justify-between items-center">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={14} /> Créneau pré-sélectionné depuis le calendrier
          </span>
          <button
            type="button"
            onClick={props.onClear}
            className="text-[11px] text-ok underline hover:no-underline"
          >Modifier</button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">Date</label>
          <input
            type="date"
            value={props.date}
            onChange={(e) => props.setDate(e.target.value)}
            className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-[var(--text-2)] block mb-1.5">Heure</label>
          <select
            value={props.heure}
            onChange={(e) => props.setHeure(e.target.value)}
            className="w-full px-3 py-2.5 border border-[var(--card-border)] rounded-lg text-[13px] bg-[var(--card-bg)] text-[var(--text)]"
          >
            <option value="">— Indifférent —</option>
            {HOURS.map((h) => <option key={h} value={h}>{h.replace(':', 'h')}</option>)}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-3)]">
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
      <h3 className="text-sm font-bold text-[var(--accent)]">4. Récapitulatif</h3>
      <div className="bg-[var(--table-bg)] rounded-xl p-4 border border-[var(--card-border)] space-y-2 text-[13px] text-[var(--text)]">
        <Row label="Demandeur" value={`${props.prenom} ${props.nom}`} />
        <Row label="Email" value={props.email} mono />
        <Row label="Téléphone" value={props.telephone} mono />
        <Row label="Adresse" value={adresse} />
        <Row label="Type" value={props.type} />
        <Row
          label="Priorité"
          value={
            props.priorite === 'urgente' ? (
              <span className="inline-flex items-center gap-1">
                <Zap size={14} /> Urgente
              </span>
            ) : 'Normale'
          }
        />
        <Row label="Créneau" value={creneau} />
        {props.photoCount > 0 && <Row label="Photos" value={`${props.photoCount} jointe(s)`} />}
      </div>

      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-3 text-[12px] text-[var(--text-2)] leading-relaxed">
        <strong className="text-[var(--text)] block mb-1">Description :</strong>
        <p className="whitespace-pre-wrap">{props.description}</p>
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={props.accepted}
          onChange={(e) => props.setAccepted(e.target.checked)}
          className="mt-0.5 accent-[var(--btn-bg)]"
        />
        <span className="text-[12px] text-[var(--text-2)] leading-relaxed">
          J&apos;accepte d&apos;être contacté par FoxO pour confirmation du créneau et accepte le traitement de mes données pour le suivi de cette demande.
        </span>
      </label>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <span className="text-[11px] text-[var(--text-3)] uppercase tracking-wider font-bold col-span-1">{label}</span>
      <span className={'col-span-2 ' + (mono ? 'font-mono text-xs' : '')}>{value}</span>
    </div>
  );
}
