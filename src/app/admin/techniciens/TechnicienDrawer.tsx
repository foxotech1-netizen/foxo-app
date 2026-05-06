'use client';

import { useEffect, useState, useTransition } from 'react';
import { Ban, Check, Clock, Save, X } from 'lucide-react';
import type { StatutIntervention, Utilisateur } from '@/lib/types/database';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtDateTime } from '@/lib/format';
import { setTechActive, updateTech } from './actions';
import type { TechInterventionsResponse } from '@/app/api/admin/techniciens/[id]/interventions/route';

type Tab = 'profil' | 'historique';

const DEFAULT_COLOR = '#1B3A6B';

export function TechnicienDrawer({
  tech, onClose, onUpdated,
}: {
  tech: Utilisateur;
  onClose: () => void;
  onUpdated: (t: Utilisateur) => void;
}) {
  const [tab, setTab] = useState<Tab>('profil');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Form state contrôlé pour le profil
  const [prenom, setPrenom] = useState(tech.prenom ?? '');
  const [nom, setNom] = useState(tech.nom ?? '');
  const [telephone, setTelephone] = useState(tech.telephone ?? '');
  const [couleur, setCouleur] = useState(tech.couleur ?? DEFAULT_COLOR);
  const [actif, setActif] = useState(tech.actif);

  function saveProfile() {
    setFeedback(null);
    const fd = new FormData();
    fd.set('prenom', prenom);
    fd.set('nom', nom);
    fd.set('telephone', telephone);
    fd.set('couleur', couleur);
    fd.set('actif', actif ? 'true' : 'false');

    startTransition(async () => {
      const res = await updateTech(tech.id, fd);
      if (res.error) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      const updated = res.data as Utilisateur;
      onUpdated(updated);
      setFeedback({ kind: 'ok', msg: 'Modifications enregistrées' });
    });
  }

  function toggleActive() {
    const next = !actif;
    if (!next) {
      const ok = window.confirm(
        `Désactiver ${tech.prenom ?? tech.email ?? 'ce technicien'} ?\n\nIl ne pourra plus se connecter à l'app tech (les données restent intactes).`,
      );
      if (!ok) return;
    }
    setFeedback(null);
    startTransition(async () => {
      const res = await setTechActive(tech.id, next);
      if (res.error) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      const updated = res.data as Utilisateur;
      setActif(updated.actif);
      onUpdated(updated);
      setFeedback({ kind: 'ok', msg: next ? 'Technicien réactivé' : 'Technicien désactivé' });
    });
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-navy-deep/45 z-50 flex justify-end"
    >
      <div className="w-[480px] max-w-full bg-cream h-screen overflow-y-auto shadow-2xl border-l border-sand-border flex flex-col dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <header className="px-5 pt-5 pb-3 bg-sand border-b border-sand-border dark:bg-[#141210] dark:border-[#2C2A24]">
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-md flex items-center justify-center text-[13px] font-extrabold flex-shrink-0"
                style={{ background: tech.couleur ?? DEFAULT_COLOR, color: '#FFFFFF' }}
              >
                {((tech.prenom ?? '').charAt(0) + (tech.nom ?? '').charAt(0)).toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-extrabold text-ink truncate dark:text-[#F0ECE4]">
                  {[tech.prenom, tech.nom].filter(Boolean).join(' ') || tech.email || '—'}
                </h2>
                <div className="text-[11px] text-ink-mid mt-0.5 dark:text-[#C8C2B8] font-mono truncate">
                  {tech.email ?? '—'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border flex-shrink-0 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] inline-flex items-center justify-center"
              aria-label="Fermer"
            ><X size={16} /></button>
          </div>
        </header>

        <nav className="flex bg-cream px-5 border-b border-sand-border dark:bg-[#1C1A16] dark:border-[#2C2A24]">
          {(['profil', 'historique'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`py-2.5 px-4 text-xs font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'text-navy border-navy font-bold dark:text-[#A8C4F2] dark:border-[#A8C4F2]'
                  : 'text-ink-muted border-transparent hover:text-ink-mid dark:text-[#C8C2B8]'
              }`}
            >
              {t === 'profil' ? 'Profil' : (
                <span className="inline-flex items-center gap-1.5"><Clock size={12} />Historique</span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-5 py-4 flex-1 overflow-y-auto bg-sand dark:bg-[#141210]">
          {feedback && (
            <div className={
              'mb-3 px-3 py-2 text-[12px] font-semibold border rounded-md ' +
              (feedback.kind === 'ok'
                ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#14281E] dark:border-[#2A4F3A] dark:text-[#7AC9A0]'
                : 'bg-terra-light border-terra-mid text-terra')
            }>
              {feedback.msg}
            </div>
          )}

          {tab === 'profil' && (
            <div className="space-y-3">
              <div className="bg-cream border border-sand-border rounded-xl p-4 space-y-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted dark:text-[#C8C2B8]">
                  Identité
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <LabeledInput label="Prénom *" value={prenom} onChange={setPrenom} />
                  <LabeledInput label="Nom *" value={nom} onChange={setNom} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1 dark:text-[#C8C2B8]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={tech.email ?? ''}
                    readOnly
                    className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-sand-mid text-ink-muted font-mono cursor-not-allowed dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#C8C2B8]"
                  />
                  <p className="text-[10px] text-ink-muted mt-1 italic dark:text-[#C8C2B8]">
                    L&apos;email est la clé d&apos;authentification — non modifiable après création.
                  </p>
                </div>
                <LabeledInput label="Téléphone" value={telephone} onChange={setTelephone} placeholder="+32 470 12 34 56" />
              </div>

              <div className="bg-cream border border-sand-border rounded-xl p-4 space-y-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted dark:text-[#C8C2B8]">
                  Couleur planning
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={couleur}
                    onChange={(e) => setCouleur(e.target.value)}
                    className="w-14 h-10 border border-sand-border rounded cursor-pointer bg-white"
                  />
                  <span className="font-mono text-xs text-ink-mid">{couleur.toUpperCase()}</span>
                </div>
              </div>

              <div className="bg-cream border border-sand-border rounded-xl p-4 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted dark:text-[#C8C2B8]">
                      Compte actif
                    </div>
                    <p className="text-[11px] text-ink-muted mt-1 italic dark:text-[#C8C2B8]">
                      Les comptes désactivés ne peuvent plus se connecter sur tech.foxo.be.
                    </p>
                  </div>
                  <Switch checked={actif} onChange={setActif} disabled={pending} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={toggleActive}
                  disabled={pending}
                  className={
                    'text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50 ' +
                    (actif
                      ? 'bg-terra-light text-terra border border-terra-mid'
                      : 'bg-ok-light text-ok border border-ok-mid')
                  }
                >
                  {actif ? (
                    <span className="inline-flex items-center gap-1.5"><Ban size={12} />Désactiver</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5"><Check size={12} />Réactiver</span>
                  )}
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={pending}
                    className="bg-sand-mid text-ink-mid px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
                  >
                    Fermer
                  </button>
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={pending}
                    className="bg-navy text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
                  >
                    {pending ? '…' : (
                      <span className="inline-flex items-center gap-1.5"><Save size={12} />Enregistrer</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'historique' && <HistoriqueTab techId={tech.id} />}
        </div>
      </div>
    </div>
  );
}

// ─── Onglet Historique ──────────────────────────────────────────────
type FiltreStatut = 'all' | 'en_cours' | 'realisees' | 'cloturees';

const FILTRES: { key: FiltreStatut; label: string; statuts: StatutIntervention[] | null }[] = [
  { key: 'all',       label: 'Toutes',     statuts: null },
  { key: 'en_cours',  label: 'En cours',   statuts: ['nouvelle', 'attente', 'confirmee', 'en_suspens'] },
  { key: 'realisees', label: 'Réalisées',  statuts: ['realisee', 'rapport'] },
  { key: 'cloturees', label: 'Clôturées',  statuts: ['cloturee'] },
];

function HistoriqueTab({ techId }: { techId: string }) {
  const [data, setData] = useState<TechInterventionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filtre, setFiltre] = useState<FiltreStatut>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/techniciens/${techId}/interventions`, { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json();
        if (cancelled) return;
        if (!r.ok || !json.ok) {
          setError(json.error ?? `HTTP ${r.status}`);
        } else {
          setData(json as TechInterventionsResponse);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur réseau.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [techId]);

  if (loading && !data) {
    return (
      <div className="bg-cream border border-sand-border rounded-xl p-6 text-center dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div className="text-[12px] text-ink-muted dark:text-[#C8C2B8]">Chargement…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-terra-light border border-terra-mid text-terra rounded-xl p-4 text-[12px]">
        Erreur de chargement : {error}
      </div>
    );
  }

  if (!data) return null;

  const activeStatuts = FILTRES.find((f) => f.key === filtre)?.statuts;
  const filtered = activeStatuts
    ? data.interventions.filter((i) => activeStatuts.includes(i.statut))
    : data.interventions;

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Total" value={data.stats.total} />
        <StatCard label="Ce mois" value={data.stats.ce_mois} />
        <StatCard label="Cette année" value={data.stats.cette_annee} />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-1.5">
        {FILTRES.map((f) => {
          const active = filtre === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFiltre(f.key)}
              className={
                'px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ' +
                (active
                  ? 'bg-navy text-white border-navy'
                  : 'bg-cream text-ink-mid border-sand-border hover:bg-sand-mid dark:bg-[#1C1A16] dark:border-[#2C2A24] dark:text-[#C8C2B8]')
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="bg-cream border border-sand-border rounded-xl p-6 text-center text-[12px] text-ink-muted italic dark:bg-[#1C1A16] dark:border-[#2C2A24] dark:text-[#C8C2B8]">
          {data.interventions.length === 0
            ? 'Aucune intervention assignée à ce technicien.'
            : 'Aucune intervention ne correspond à ce filtre.'}
        </div>
      ) : (
        <div className="bg-cream border border-sand-border rounded-xl overflow-hidden dark:bg-[#1C1A16] dark:border-[#2C2A24]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sand dark:bg-[#221E1A]">
                {['Date', 'Réf', 'ACP', 'Statut'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border dark:text-[#C8C2B8] dark:border-[#2C2A24]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((iv) => (
                <tr
                  key={iv.id}
                  className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#2C2A24] dark:hover:bg-[#221E1A]"
                >
                  <td className="px-3 py-2 text-[11px] text-ink whitespace-nowrap dark:text-[#F0ECE4]">
                    <a
                      href={`/admin/interventions/${iv.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block hover:text-navy"
                      title={iv.adresse ?? ''}
                    >
                      {iv.creneau_debut ? fmtDateTime(iv.creneau_debut) : '—'}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-[11px] font-mono text-navy dark:text-[#A8C4F2]">
                    <a
                      href={`/admin/interventions/${iv.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {iv.ref ?? iv.id.slice(0, 8)}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-ink-mid dark:text-[#C8C2B8]">
                    <div className="font-semibold text-ink dark:text-[#F0ECE4] truncate max-w-[140px]" title={iv.acp_nom ?? ''}>
                      {iv.acp_nom ?? '—'}
                    </div>
                    {iv.adresse && (
                      <div className="text-[10px] text-ink-muted truncate max-w-[140px]" title={iv.adresse}>
                        {iv.adresse}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatutBadge statut={iv.statut} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.interventions.length >= 200 && (
            <div className="px-3 py-2 text-[10px] text-ink-muted italic border-t border-sand-border bg-sand dark:border-[#2C2A24] dark:bg-[#221E1A] dark:text-[#C8C2B8]">
              200 dernières interventions affichées.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-cream border border-sand-border rounded-lg px-3 py-2.5 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
      <div className="text-lg font-extrabold text-ink leading-tight dark:text-[#F0ECE4]">{value}</div>
      <div className="text-[9px] font-bold text-ink-muted uppercase tracking-wider mt-0.5 dark:text-[#C8C2B8]">
        {label}
      </div>
    </div>
  );
}

function LabeledInput({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted block mb-1 dark:text-[#C8C2B8]">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
      />
    </div>
  );
}

function Switch({
  checked, onChange, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      className={
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 flex-shrink-0 ' +
        (checked ? 'bg-navy' : 'bg-sand-mid')
      }
    >
      <span
        className={
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ' +
          (checked ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  );
}
