'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Ban, Circle, Plus, X } from 'lucide-react';
import type { Utilisateur } from '@/lib/types/database';
import { createTech } from './actions';
import { TechnicienDrawer } from './TechnicienDrawer';

const DEFAULT_COLOR = '#1B3A6B';
const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const INVITE_BANNER_TIMEOUT_MS = 10000;

type TechStatus =
  | { kind: 'disabled' }
  | { kind: 'online' }
  | { kind: 'offline'; lastSeenAt: string }
  | { kind: 'never' };

function computeStatus(t: Utilisateur, now: number): TechStatus {
  if (!t.actif) return { kind: 'disabled' };
  if (!t.last_seen_at) return { kind: 'never' };
  const ts = new Date(t.last_seen_at).getTime();
  if (Number.isNaN(ts)) return { kind: 'never' };
  if (now - ts <= ONLINE_THRESHOLD_MS) return { kind: 'online' };
  return { kind: 'offline', lastSeenAt: t.last_seen_at };
}

function formatRelative(iso: string, now: number): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return `il y a ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `il y a ${diffD}j`;
  const diffMo = Math.floor(diffD / 30);
  if (diffMo < 12) return `il y a ${diffMo} mois`;
  const diffY = Math.floor(diffMo / 12);
  return `il y a ${diffY} an${diffY > 1 ? 's' : ''}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function initials(t: Utilisateur): string {
  const a = (t.prenom ?? '').trim();
  const b = (t.nom ?? '').trim();
  if (a || b) return `${a.charAt(0)}${b.charAt(0)}`.toUpperCase() || '?';
  return (t.email ?? '?').charAt(0).toUpperCase();
}

// Calcule la luminance approx pour choisir un texte clair/foncé sur l'avatar.
function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return '#FFFFFF';
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? '#1A1A1A' : '#FFFFFF';
}

export function TechniciensClient({
  initial,
  loadError,
}: {
  initial: Utilisateur[];
  loadError: string | null;
}) {
  const [techs, setTechs] = useState<Utilisateur[]>(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [drawerTech, setDrawerTech] = useState<Utilisateur | null>(null);
  const [inviteBanner, setInviteBanner] = useState<string | null>(null);

  // Re-render toutes les 30s pour rafraîchir l'indicateur "il y a Xmin".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Auto-disparition du bandeau d'avertissement après ~10s.
  useEffect(() => {
    if (!inviteBanner) return;
    const id = setTimeout(() => setInviteBanner(null), INVITE_BANNER_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [inviteBanner]);

  const sorted = useMemo(() => {
    return [...techs].sort((a, b) => {
      if (a.actif !== b.actif) return a.actif ? -1 : 1;
      return (a.prenom ?? '').localeCompare(b.prenom ?? '');
    });
  }, [techs]);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createTech(formData);
      if (res.error) { setError(res.error); return; }
      const created = res.data as Utilisateur;
      setTechs((arr) => [created, ...arr]);
      setOpen(false);
      setColor(DEFAULT_COLOR);
      setInviteBanner(
        `${created.prenom ?? ''} ${created.nom ?? ''} créé. Son compte de connexion est prêt : il se connectera sur tech.foxo.be avec son email (un code à 6 chiffres lui sera envoyé par email à la première connexion).`
      );
    });
  }

  function handleTechUpdated(updated: Utilisateur) {
    setTechs((arr) => arr.map((t) => (t.id === updated.id ? updated : t)));
    setDrawerTech(updated);
  }

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Techniciens
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {techs.length} technicien{techs.length > 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={() => { setOpen(true); setError(null); }}
          className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm inline-flex items-center gap-1.5"
        >
          <Plus size={14} />Ajouter un technicien
        </button>
      </div>

      <div>
        {loadError && (
          <div className="mb-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold">
            Connexion à la base limitée : {loadError}
          </div>
        )}

        {inviteBanner && (
          <div className="mb-3 px-4 py-3 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold flex items-start justify-between gap-3">
            <span className="flex-1">{inviteBanner}</span>
            <button
              type="button"
              onClick={() => setInviteBanner(null)}
              className="bg-[#E8C896] text-[#8A5A1A] px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap hover:brightness-95"
            >
              OK, compris
            </button>
          </div>
        )}

        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sand">
                {['Nom', 'Email', 'Téléphone', 'Couleur', 'Statut', 'Créé le'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-ink-muted text-[13px]">
                    Aucun technicien enregistré
                  </td>
                </tr>
              ) : sorted.map((t) => {
                const status = computeStatus(t, now);
                const fullName = [t.prenom, t.nom].filter(Boolean).join(' ') || '—';
                const c = t.couleur ?? DEFAULT_COLOR;
                const inactive = !t.actif;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setDrawerTech(t)}
                    className={`border-b border-sand-mid hover:bg-sand-hover cursor-pointer ${inactive ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3.5 py-3 text-[13px]">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-extrabold flex-shrink-0"
                          style={{ background: c, color: readableTextColor(c) }}
                        >
                          {initials(t)}
                        </div>
                        <span className={`font-bold ${inactive ? 'line-through text-ink-muted' : ''}`}>
                          {fullName}
                        </span>
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-xs font-mono text-ink-mid">{t.email ?? '—'}</td>
                    <td className="px-3.5 py-3 text-xs">{t.telephone ?? '—'}</td>
                    <td className="px-3.5 py-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded-full border border-sand-border flex-shrink-0"
                          style={{ background: c }}
                        />
                        <span className="font-mono text-ink-muted">{c.toUpperCase()}</span>
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-xs">
                      <StatusCell status={status} now={now} />
                    </td>
                    <td className="px-3.5 py-3 text-xs text-ink-muted">{formatDate(t.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Ajouter */}
      {open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !pending) { setOpen(false); setColor(DEFAULT_COLOR); } }}
          className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
        >
          <div className="bg-cream rounded-2xl w-full max-w-[520px] max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="px-6 py-5 border-b border-sand-border flex justify-between items-center sticky top-0 bg-cream">
              <div>
                <div className="text-base font-extrabold text-ink">Nouveau technicien</div>
                <div className="text-[11px] text-ink-muted mt-0.5">Profil terrain (équipe FoxO)</div>
              </div>
              <button
                onClick={() => { if (!pending) { setOpen(false); setColor(DEFAULT_COLOR); } }}
                disabled={pending}
                className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border disabled:opacity-50 inline-flex items-center justify-center"
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </div>

            <form action={onSubmit} className="px-6 py-5 space-y-4">
              <div className="bg-sand rounded-xl p-3.5 border border-sand-border space-y-3">
                <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                  Identité
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field name="prenom" label="Prénom *" placeholder="Jean" required />
                  <Field name="nom" label="Nom *" placeholder="Dupont" required />
                </div>
                <Field name="email" label="Email *" type="email" placeholder="tech3@foxo.be" required />
                <Field name="telephone" label="Téléphone" placeholder="+32 470 12 34 56" />
              </div>

              <div className="bg-sand rounded-xl p-3.5 border border-sand-border space-y-3">
                <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                  Couleur planning
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    name="couleur"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-14 h-10 border border-sand-border rounded cursor-pointer bg-white"
                  />
                  <span className="font-mono text-xs text-ink-mid">{color.toUpperCase()}</span>
                </div>
              </div>

              {error && (
                <div className="bg-terra-light border border-terra-mid text-terra rounded-lg px-3.5 py-2.5 text-xs">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => { setOpen(false); setColor(DEFAULT_COLOR); }}
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
                  {pending ? 'Création…' : 'Créer le technicien'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {drawerTech && (
        <TechnicienDrawer
          tech={drawerTech}
          onClose={() => setDrawerTech(null)}
          onUpdated={handleTechUpdated}
        />
      )}
    </>
  );
}

function StatusCell({ status, now }: { status: TechStatus; now: number }) {
  if (status.kind === 'disabled') {
    return (
      <span className="text-ink-muted line-through inline-flex items-center gap-1.5">
        <Ban size={12} />Désactivé
      </span>
    );
  }
  if (status.kind === 'online') {
    return (
      <span className="text-ok font-semibold inline-flex items-center gap-1.5">
        <Circle size={12} className="fill-ok text-ok" />En ligne
      </span>
    );
  }
  if (status.kind === 'offline') {
    return (
      <span className="text-ink-muted inline-flex items-center gap-1.5">
        <Circle size={12} className="fill-ink-muted text-ink-muted" />Hors ligne <span className="text-ink-muted/80">({formatRelative(status.lastSeenAt, now)})</span>
      </span>
    );
  }
  return (
    <span className="text-ink-muted inline-flex items-center gap-1.5">
      <Circle size={12} className="fill-ink-muted text-ink-muted" />Jamais connecté
    </span>
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
