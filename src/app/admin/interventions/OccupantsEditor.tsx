'use client';

// Éditeur d'occupants partagé — extrait À L'IDENTIQUE du tableau d'occupants
// de src/app/admin/planning/CreateInterventionModal.tsx (refactor pur, aucun
// changement de rendu ni de comportement). Contrôlé : value + onChange.
//
// Réutilisable par le modal Planning et le modal de création à froid. Le titre
// de Section et le paragraphe d'aide sont pilotés par les props title/hint.

import {
  CheckCircle2,
  XCircle,
  Mail,
  Smartphone,
  MessageCircle,
  Hourglass,
  type LucideIcon,
} from 'lucide-react';
import type { SlotOccupant } from '../planning/actions';

// Gabarit d'une ligne occupant vierge — identique à l'état initial / addOccupant
// du modal Planning.
function emptyOccupant(): SlotOccupant {
  return { appartement: '', etage: '', prenom: '', nom: '', email: '', telephone: '', conf: 'en_attente', instructions: '', contact_preference: 'email' };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2">
        {title}
      </div>
      {children}
    </section>
  );
}

export function OccupantsEditor({
  value,
  onChange,
  title = 'Occupants',
  hint,
}: {
  value: SlotOccupant[];
  onChange: (next: SlotOccupant[]) => void;
  title?: string;
  hint?: string;
}) {
  function addOccupant() {
    onChange([...value, emptyOccupant()]);
  }
  function removeOccupant(i: number) {
    onChange(value.length > 1 ? value.filter((_, idx) => idx !== i) : value);
  }
  function updateOccupant(i: number, patch: Partial<SlotOccupant>) {
    onChange(value.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  return (
    <Section title={title}>
      <div className="space-y-2">
        {value.map((o, i) => (
          <div key={i} className="bg-white border border-sand-border rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                Unité {i + 1}
              </span>
              {value.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeOccupant(i)}
                  className="text-[10px] text-terra hover:underline"
                >
                  Retirer
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={o.appartement}
                onChange={(e) => updateOccupant(i, { appartement: e.target.value })}
                placeholder="Numéro / nom (Apt 3B, Cave 2, Communs…)"
                className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
              />
              <input
                value={o.etage ?? ''}
                onChange={(e) => updateOccupant(i, { etage: e.target.value })}
                placeholder="Étage (optionnel)"
                className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={o.prenom}
                onChange={(e) => updateOccupant(i, { prenom: e.target.value })}
                placeholder="Prénom occupant"
                className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
              />
              <input
                value={o.nom}
                onChange={(e) => updateOccupant(i, { nom: e.target.value })}
                placeholder="Nom occupant"
                className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
              />
              <input
                value={o.telephone}
                onChange={(e) => updateOccupant(i, { telephone: e.target.value })}
                type="tel"
                placeholder="+32 488 12 34 56"
                className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white font-mono"
              />
              <input
                value={o.email}
                onChange={(e) => updateOccupant(i, { email: e.target.value })}
                type="email"
                placeholder="Email (lien occupant /o/…)"
                className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
              />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                Statut accès
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { v: 'confirme', icon: CheckCircle2 as LucideIcon, label: 'Confirmé' },
                    { v: 'en_attente', icon: Hourglass as LucideIcon, label: 'À confirmer' },
                    { v: 'decline', icon: XCircle as LucideIcon, label: 'Pas d\'accès' },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.v}
                    className={
                      'px-2 py-1.5 border rounded text-[11px] font-semibold cursor-pointer text-center inline-flex items-center justify-center gap-1 ' +
                      (o.conf === opt.v
                        ? 'border-navy bg-navy-pale text-navy dark:text-white'
                        : 'border-sand-border bg-white text-ink-mid')
                    }
                  >
                    <input
                      type="radio"
                      checked={o.conf === opt.v}
                      onChange={() => updateOccupant(i, { conf: opt.v })}
                      className="sr-only"
                    />
                    <opt.icon size={12} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                Préférence contact
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { v: 'email', icons: [Mail] as LucideIcon[], label: 'Email' },
                    { v: 'sms', icons: [Smartphone] as LucideIcon[], label: 'SMS' },
                    { v: 'whatsapp', icons: [MessageCircle] as LucideIcon[], label: 'WhatsApp' },
                    { v: 'both', icons: [Mail, Smartphone] as LucideIcon[], label: 'Les deux' },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.v}
                    className={
                      'px-1.5 py-1 border rounded text-[10px] font-semibold cursor-pointer text-center inline-flex items-center justify-center gap-1 ' +
                      (o.contact_preference === opt.v
                        ? 'border-navy bg-navy-pale text-navy dark:text-white'
                        : 'border-sand-border bg-white text-ink-mid')
                    }
                  >
                    <input
                      type="radio"
                      checked={o.contact_preference === opt.v}
                      onChange={() => updateOccupant(i, { contact_preference: opt.v })}
                      className="sr-only"
                    />
                    <span className="inline-flex items-center gap-0.5">
                      {opt.icons.map((Ic, idx) => <Ic key={idx} size={10} />)}
                    </span>
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <textarea
              value={o.instructions ?? ''}
              onChange={(e) => updateOccupant(i, { instructions: e.target.value })}
              placeholder="Instructions spécifiques (digicode, gardien, créneau d'accès…)"
              rows={2}
              className="w-full px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none resize-y"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addOccupant}
          className="w-full bg-sand-mid text-ink-mid border border-sand-border px-3 py-2 rounded-md text-[12px] font-semibold dark:bg-[rgba(255,255,255,.06)]"
        >
          + Ajouter un appartement
        </button>
        {hint && (
          <p className="text-[10px] text-ink-muted italic mt-1">
            {hint}
          </p>
        )}
      </div>
    </Section>
  );
}
