'use client';

import { useState, useTransition } from 'react';
import {
  Building2, Scale, Shield, Search, Hammer, ShowerHead,
  Zap, Home, Flame, Package, X, CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import type { Organisation, TypeOrganisation } from '@/lib/types/database';
import { TypeBadge } from '@/components/TypeBadge';
import { createOrganisation } from '../actions';
import { OrganisationDrawer } from './OrganisationDrawer';
import { AddressAutocomplete, emptyAddress, type AddressValue } from '@/components/AddressAutocomplete';

// Source unique de vérité pour la liste des types d'organisations dans
// l'UI partenaires (radios de création + select d'édition dans le drawer).
// Si tu en ajoutes/retires une, mets aussi à jour OrganisationDrawer.tsx
// (même constante dupliquée localement, par choix de scope) et la
// migration SQL `organisations_type_check` / `user_role`.
const ORG_TYPES: { v: TypeOrganisation; l: string; icon: LucideIcon }[] = [
  { v: 'syndic',       l: 'Syndic',       icon: Building2 },
  { v: 'courtier',     l: 'Courtier',     icon: Scale },
  { v: 'assurance',    l: 'Assurance',    icon: Shield },
  { v: 'expert',       l: 'Expert',       icon: Search },
  { v: 'entrepreneur', l: 'Entrepreneur', icon: Hammer },
  { v: 'plombier',     l: 'Plombier',     icon: ShowerHead },
  { v: 'electricien',  l: 'Électricien',  icon: Zap },
  { v: 'toiturier',    l: 'Toiturier',    icon: Home },
  { v: 'chauffagiste', l: 'Chauffagiste', icon: Flame },
  { v: 'autre_metier', l: 'Autre métier', icon: Package },
];

export function SyndicsClient({
  initial,
  loadError,
  title,
}: {
  initial: Organisation[];
  loadError: string | null;
  title?: string;
}) {
  const [orgs, setOrgs] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<TypeOrganisation>('syndic');
  const [drawerOrg, setDrawerOrg] = useState<Organisation | null>(null);
  // État contrôlé pour le champ Adresse (AddressAutocomplete) — on
  // injecte ensuite adresse + lat + lng dans le formData via des hidden
  // inputs pour rester compatible avec l'action server existante.
  const [addr, setAddr] = useState<AddressValue>(emptyAddress());

  function onSubmit(formData: FormData) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await createOrganisation(formData);
      if (res.error) { setError(res.error); return; }
      const created = res.data as Organisation;
      setOrgs((arr) => [created, ...arr]);
      setSuccess(`${created.nom} ajouté en tant que ${created.type}.`);
      setTimeout(() => { setOpen(false); setAddr(emptyAddress()); setSuccess(null); }, 1500);
    });
  }

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            {title ?? 'Partenaires'}
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {orgs.length} partenaire{orgs.length > 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={() => { setOpen(true); setError(null); setSuccess(null); }}
          className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm"
        >
          + Nouveau partenaire
        </button>
      </div>

      <div>
        {loadError && (
          <div className="mb-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold">
            Connexion à la base limitée : {loadError}
          </div>
        )}

        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sand">
                {['Nom', 'Type', 'Email', 'Contact', 'Téléphone', 'BCE'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-ink-muted text-[13px]">
                    Aucun partenaire enregistré
                  </td>
                </tr>
              ) : orgs.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => setDrawerOrg(o)}
                  className="border-b border-sand-mid hover:bg-sand-hover cursor-pointer"
                >
                  <td className="px-3.5 py-3 font-bold text-[13px]">{o.nom}</td>
                  <td className="px-3.5 py-3 text-xs">
                    <TypeBadge type={o.type} />
                  </td>
                  <td className="px-3.5 py-3 text-xs font-mono text-ink-mid">{o.email}</td>
                  <td className="px-3.5 py-3 text-xs">{o.contact ?? '—'}</td>
                  <td className="px-3.5 py-3 text-xs">{o.telephone ?? '—'}</td>
                  <td className="px-3.5 py-3 text-xs font-mono">{o.bce ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !pending) { setOpen(false); setAddr(emptyAddress()); } }}
          className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
        >
          {/* flex-col : header fixe, le formulaire est l'unique zone
              scrollable (plus de sticky qui glisse sous un 2e scroller). */}
          <div className="bg-cream rounded-2xl w-full max-w-[520px] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-5 border-b border-sand-border flex justify-between items-center flex-shrink-0 bg-cream">
              <div>
                <div className="text-base font-extrabold text-ink">Nouveau partenaire</div>
                <div className="text-[11px] text-ink-muted mt-0.5">Syndic ou courtier d&apos;assurance</div>
              </div>
              <button
                onClick={() => { if (!pending) { setOpen(false); setAddr(emptyAddress()); } }}
                disabled={pending}
                className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border disabled:opacity-50 inline-flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <form action={onSubmit} className="px-6 py-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-ink-mid block mb-1.5">Type *</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {ORG_TYPES.map((t) => {
                    const Icon = t.icon;
                    return (
                      <label
                        key={t.v}
                        className={`px-3 py-2 border-2 rounded-lg cursor-pointer flex items-center gap-1.5 text-xs ${
                          type === t.v ? 'border-navy bg-navy-pale' : 'border-sand-border'
                        }`}
                      >
                        <input
                          type="radio" name="type" value={t.v}
                          checked={type === t.v}
                          onChange={() => setType(t.v)}
                          className="accent-[#1B3A6B]"
                        />
                        <Icon size={14} />
                        <span>{t.l}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="bg-sand rounded-xl p-3.5 border border-sand-border space-y-3">
                <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                  Société
                </div>
                <Field name="nom" label="Nom *" placeholder="ex: IG Syndic SPRL" required />
                <div className="grid grid-cols-2 gap-2.5">
                  <Field name="bce" label="BCE" placeholder="BE0123.456.789" />
                  <Field name="telephone" label="Téléphone" placeholder="+32 2 123 45 67" />
                </div>
                <AddressAutocomplete
                  label="Adresse"
                  value={addr}
                  onChange={setAddr}
                  placeholder="Rue de la Loi 42, 1000 Bruxelles"
                />
                {/* Hidden inputs : participent au formData pour le server action */}
                <input type="hidden" name="adresse" value={addr.code_postal || addr.ville
                  ? `${addr.adresse}${addr.code_postal || addr.ville ? `, ${addr.code_postal} ${addr.ville}`.trimEnd() : ''}`.trim()
                  : addr.adresse} />
                <input type="hidden" name="lat" value={addr.lat ?? ''} />
                <input type="hidden" name="lng" value={addr.lng ?? ''} />
              </div>

              <div className="bg-sand rounded-xl p-3.5 border border-sand-border space-y-3">
                <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                  Contact principal
                </div>
                <Field name="contact" label="Nom du contact" placeholder="Caroline Mignon" />
                <Field name="email" label="Email de connexion *" type="email" placeholder="contact@igsyndic.be" required />
              </div>

              {error && (
                <div className="bg-terra-light border border-terra-mid text-terra rounded-lg px-3.5 py-2.5 text-xs">
                  {error}
                </div>
              )}
              {success && (
                <div className="bg-ok-light border border-ok-mid text-ok rounded-lg px-3.5 py-2.5 text-xs font-semibold text-center inline-flex items-center justify-center gap-1.5 w-full">
                  <CheckCircle2 size={14} />
                  <span>{success}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); setAddr(emptyAddress()); }}
                  disabled={pending}
                  className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="bg-navy text-white px-4 py-2.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                >
                  {pending ? 'Création…' : 'Créer le partenaire'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {drawerOrg && (
        <OrganisationDrawer
          org={drawerOrg}
          onClose={() => setDrawerOrg(null)}
          onUpdate={(updated) => {
            // Mise à jour optimiste : patch l'item dans la liste ET le
            // drawer (sinon le drawer continuerait d'afficher l'ancienne
            // version puisque org est passé en prop).
            setDrawerOrg((prev) => (prev ? { ...prev, ...updated } : prev));
            setOrgs((arr) => arr.map((o) => (o.id === drawerOrg.id ? { ...o, ...updated } : o)));
          }}
        />
      )}
    </>
  );
}

function Field({
  name, label, type = 'text', placeholder, required,
}: {
  name: string; label: string; type?: string; placeholder?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-ink-mid block mb-1">{label}</label>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
      />
    </div>
  );
}
