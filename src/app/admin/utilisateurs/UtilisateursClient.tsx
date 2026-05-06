'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export type UtilisateurRow = {
  id: string;
  email: string | null;
  role: 'syndic' | 'courtier' | 'technicien' | null;
  actif: boolean;
  organisation_id: string | null;
  telephone: string | null;
  created_at: string | null;
  last_seen_at: string | null;
  organisation: { id: string; nom: string } | null;
  org_nom: string | null;
};

type OrgLite = { id: string; nom: string; type: 'syndic' | 'courtier' };

type ChipId = 'tous' | 'syndic' | 'courtier' | 'technicien';
const CHIPS: { id: ChipId; label: string }[] = [
  { id: 'tous',       label: 'Tous' },
  { id: 'syndic',     label: 'Syndics' },
  { id: 'courtier',   label: 'Courtiers' },
  { id: 'technicien', label: 'Techniciens' },
];

const ROLE_COLORS: Record<NonNullable<UtilisateurRow['role']>, string> = {
  syndic:     '#1B3A6B',
  courtier:   '#1D6FA4',
  technicien: '#1F6B45',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function UtilisateursClient({
  initial,
  loadError,
}: {
  initial: UtilisateurRow[];
  loadError: string | null;
}) {
  const [users, setUsers] = useState<UtilisateurRow[]>(initial);
  const [orgs, setOrgs] = useState<OrgLite[]>([]);
  const [chip, setChip] = useState<ChipId>('tous');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err' | 'amber'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState<UtilisateurRow | null>(null);

  // Sync prop → state si le server re-render après router.refresh().
  const [lastInit, setLastInit] = useState(initial);
  if (lastInit !== initial) {
    setLastInit(initial);
    setUsers(initial);
  }

  // Form inline
  const [formOpen, setFormOpen] = useState(false);
  const [fEmail, setFEmail] = useState('');
  const [fRole, setFRole] = useState<NonNullable<UtilisateurRow['role']>>('syndic');
  const [fOrgId, setFOrgId] = useState<string>('');

  // Charge la liste des organisations pour le select. queueMicrotask pour
  // sortir le setState du body sync de l'effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/organisations', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.ok) return;
        const list = (d.organisations ?? []) as OrgLite[];
        queueMicrotask(() => { if (!cancelled) setOrgs(list); });
      })
      .catch(() => { /* noop */ });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (chip === 'tous') return users;
    return users.filter((u) => u.role === chip);
  }, [users, chip]);

  const counts = useMemo(() => {
    const out: Record<ChipId, number> = { tous: users.length, syndic: 0, courtier: 0, technicien: 0 };
    for (const u of users) {
      if (u.role === 'syndic') out.syndic += 1;
      else if (u.role === 'courtier') out.courtier += 1;
      else if (u.role === 'technicien') out.technicien += 1;
    }
    return out;
  }, [users]);

  function resetForm() {
    setFEmail('');
    setFRole('syndic');
    setFOrgId('');
  }

  function submitCreate() {
    setFeedback(null);
    startTransition(async () => {
      const r = await fetch('/api/admin/utilisateurs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fEmail.trim(),
          role: fRole,
          organisation_id: fOrgId || null,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        if (data.error === 'no_auth_account') {
          setFeedback({
            kind: 'amber',
            msg: "Cette personne n'a pas encore de compte. Demandez-lui de se connecter une première fois sur portal.foxo.be, puis revenez ici.",
          });
        } else {
          setFeedback({ kind: 'err', msg: data.error ?? 'Échec création.' });
        }
        return;
      }
      // Optimistic : ajoute en tête de liste
      setUsers((arr) => [data.utilisateur as UtilisateurRow, ...arr]);
      resetForm();
      setFormOpen(false);
      setFeedback({ kind: 'ok', msg: 'Utilisateur créé.' });
    });
  }

  function toggleActif(u: UtilisateurRow) {
    const next = !u.actif;
    // Optimistic
    setUsers((arr) => arr.map((x) => (x.id === u.id ? { ...x, actif: next } : x)));
    startTransition(async () => {
      const r = await fetch(`/api/admin/utilisateurs/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actif: next }),
      });
      const data = await r.json();
      if (!data.ok) {
        // Rollback
        setUsers((arr) => arr.map((x) => (x.id === u.id ? { ...x, actif: u.actif } : x)));
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec toggle actif.' });
      }
    });
  }

  function performDelete(u: UtilisateurRow) {
    const snapshot = users;
    setUsers((arr) => arr.filter((x) => x.id !== u.id));
    setConfirmDelete(null);
    startTransition(async () => {
      const r = await fetch(`/api/admin/utilisateurs/${u.id}`, { method: 'DELETE' });
      const data = await r.json();
      if (!data.ok) {
        setUsers(snapshot);
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec suppression.' });
        return;
      }
      setFeedback({ kind: 'ok', msg: `${u.email ?? 'Utilisateur'} supprimé.` });
    });
  }

  return (
    <>
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Utilisateurs partenaires</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {users.length} utilisateur(s) — {counts.syndic} syndic(s), {counts.courtier} courtier(s), {counts.technicien} technicien(s)
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setFormOpen((v) => !v); setFeedback(null); }}
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:opacity-90"
        >
          {formOpen ? 'Annuler' : '+ Ajouter'}
        </button>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5 space-y-4">
        {loadError && (
          <div className="px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold">
            Connexion limitée : {loadError}
          </div>
        )}

        {feedback && (
          <div className={
            'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok' ? 'bg-ok-light border-ok-mid text-ok'
              : feedback.kind === 'amber' ? 'bg-amber-light border-[#E8C896] text-[#8A5A1A]'
              : 'bg-terra-light border-terra-mid text-terra')
          }>
            {feedback.msg}
          </div>
        )}

        {/* Form inline collapsible */}
        {formOpen && (
          <div className="bg-cream border border-sand-border rounded-xl p-4 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
              Nouvel utilisateur
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={fEmail}
                  onChange={(e) => setFEmail(e.target.value)}
                  placeholder="contact@partenaire.be"
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">
                  Rôle *
                </label>
                <select
                  value={fRole}
                  onChange={(e) => setFRole(e.target.value as typeof fRole)}
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white cursor-pointer"
                >
                  <option value="syndic">Syndic</option>
                  <option value="courtier">Courtier</option>
                  <option value="technicien">Technicien</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1">
                  Organisation {fRole === 'technicien' ? '' : '*'}
                </label>
                <select
                  value={fOrgId}
                  onChange={(e) => setFOrgId(e.target.value)}
                  disabled={fRole === 'technicien'}
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white cursor-pointer disabled:opacity-50"
                >
                  <option value="">{fRole === 'technicien' ? '— (interne)' : 'Sélectionner…'}</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.nom} ({o.type})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setFormOpen(false); resetForm(); }}
                disabled={pending}
                className="bg-sand-mid text-ink-mid px-3 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={pending || !fEmail.trim() || (fRole !== 'technicien' && !fOrgId)}
                className="bg-navy text-white px-4 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
              >
                {pending ? '…' : 'Créer'}
              </button>
            </div>
          </div>
        )}

        {/* Chips filtres */}
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => {
            const active = c.id === chip;
            const n = counts[c.id];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChip(c.id)}
                className={
                  'text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors ' +
                  (active
                    ? 'bg-navy text-white border-navy'
                    : 'bg-cream text-ink-mid border-sand-border hover:bg-sand-mid')
                }
              >
                {c.label}
                <span className={'ml-1.5 text-[10px] font-semibold ' + (active ? 'opacity-80' : 'opacity-60')}>
                  ({n})
                </span>
              </button>
            );
          })}
        </div>

        {/* Tableau */}
        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-sand">
                  {['Email', 'Rôle', 'Organisation', 'Actif', 'Créé le', 'Actions'].map((h) => (
                    <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-ink-muted text-[13px]">
                      Aucun utilisateur ne correspond au filtre.
                    </td>
                  </tr>
                ) : filtered.map((u) => (
                  <tr key={u.id} className="border-b border-sand-mid hover:bg-sand-hover">
                    <td className="px-3.5 py-3 font-mono text-xs font-semibold text-ink">
                      {u.email ?? '—'}
                    </td>
                    <td className="px-3.5 py-3">
                      {u.role && (
                        <span
                          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold text-white whitespace-nowrap"
                          style={{ background: ROLE_COLORS[u.role] }}
                        >
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-[12px]">
                      {u.org_nom ?? <span className="text-ink-muted italic">—</span>}
                    </td>
                    <td className="px-3.5 py-3">
                      <Toggle active={u.actif} onChange={() => toggleActif(u)} disabled={pending} />
                    </td>
                    <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                      {fmtDate(u.created_at)}
                    </td>
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(u)}
                        disabled={pending}
                        className="text-[10px] bg-terra-light text-terra border border-terra-mid px-2 py-1 rounded font-bold disabled:opacity-50 inline-flex items-center justify-center"
                        title="Supprimer"
                        aria-label="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Supprimer ${confirmDelete?.email ?? ''} ?`}
        message="L'utilisateur perdra son accès au login (la whitelist DB ne le trouvera plus). Le compte auth.users reste intact — purge-le manuellement dans le dashboard Supabase si nécessaire."
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onConfirm={() => { if (confirmDelete) performDelete(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

// Switch iOS-style minimaliste pour le toggle actif (pas de dépendance externe).
function Toggle({
  active, onChange, disabled,
}: {
  active: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onChange}
      disabled={disabled}
      className={
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ' +
        (active ? 'bg-ok' : 'bg-sand-border')
      }
    >
      <span
        className={
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' +
          (active ? 'translate-x-4' : 'translate-x-0.5')
        }
      />
    </button>
  );
}
