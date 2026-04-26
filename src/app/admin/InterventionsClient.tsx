'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  STATUT_INFO,
  STATUT_PIPELINE,
  type InterventionRow,
  type StatutIntervention,
} from '@/lib/types/database';
import { updateInterventionStatus, resendRapportToSyndic } from './actions';
import { FactureBlock } from './FactureBlock';

const STATUTS_FILTRE: ('tous' | StatutIntervention)[] = [
  'tous',
  'nouvelle',
  'date_proposee',
  'attente_confirmation',
  'confirmee',
  'realisee',
  'rapport_disponible',
  'facturee',
  'cloturee',
  'en_suspens',
];

function fmtDate(iso: string | null, full = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return full
    ? d.toLocaleString('fr-BE', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit',
      })
    : d.toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
}

function rel(iso: string | null): string {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return '< 1h';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}

function Badge({ statut, big = false }: { statut: StatutIntervention; big?: boolean }) {
  const info = STATUT_INFO[statut];
  return (
    <span
      className="inline-block rounded-full font-semibold whitespace-nowrap"
      style={{
        color: info.fg,
        background: info.bg,
        fontSize: big ? 12 : 11,
        padding: big ? '4px 12px' : '3px 9px',
      }}
    >
      {info.label}
    </span>
  );
}

function Pipebar({ statut }: { statut: StatutIntervention }) {
  if (statut === 'en_suspens') {
    return (
      <div className="flex gap-0.5 mt-1.5 items-center">
        <div className="h-[3px] flex-1 rounded-md bg-[#F7EDE5] border border-[#E8C4AF]" />
        <span className="text-[9px] text-terra font-bold ml-1.5 whitespace-nowrap font-mono">
          EN SUSPENS
        </span>
      </div>
    );
  }
  const idx = STATUT_PIPELINE.indexOf(statut);
  return (
    <div className="flex gap-0.5 mt-1.5">
      {STATUT_PIPELINE.map((p, i) => (
        <div
          key={p}
          className="h-[3px] flex-1 rounded-md"
          style={{ background: i <= idx ? STATUT_INFO[p].fg : '#DDD8CC' }}
        />
      ))}
    </div>
  );
}

export function InterventionsClient({
  initialRows,
  loadError,
}: {
  initialRows: InterventionRow[];
  loadError: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof STATUTS_FILTRE[number]>('tous');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'dossier' | 'suivi' | 'documents'>('dossier');
  const [pendingStatut, setPendingStatut] = useState<StatutIntervention | ''>('');
  const [suspensMotif, setSuspensMotif] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [emailPending, startEmailTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((iv) => {
      const matchQuery =
        !q ||
        [iv.ref, iv.acp?.nom, iv.acp?.ville, iv.acp?.adresse, iv.syndic?.nom, iv.description]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q));
      const matchFilter = filter === 'tous' || iv.statut === filter;
      return matchQuery && matchFilter;
    });
  }, [rows, query, filter]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // Stats
  const stats = useMemo(() => {
    const inProgress = rows.filter((r) =>
      ['confirmee', 'realisee', 'date_proposee', 'attente_confirmation'].includes(r.statut),
    ).length;
    const suspended = rows.filter((r) => r.statut === 'en_suspens').length;
    const reports = rows.filter((r) => r.statut === 'rapport_disponible').length;
    const closed = rows.filter((r) => r.statut === 'cloturee').length;
    const urgent = rows.filter((r) => r.priorite === 'urgente' && r.statut !== 'cloturee').length;
    return { inProgress, suspended, reports, closed, urgent };
  }, [rows]);

  function openDrawer(id: string) {
    const iv = rows.find((r) => r.id === id);
    setSelectedId(id);
    setTab('dossier');
    setPendingStatut(iv?.statut ?? '');
    setSuspensMotif(iv?.suspens_motif ?? '');
    setStatusMessage(null);
  }
  function closeDrawer() {
    setSelectedId(null);
    setStatusMessage(null);
  }

  function resendRapport() {
    if (!selected) return;
    setEmailMessage(null);
    startEmailTransition(async () => {
      const res = await resendRapportToSyndic(selected.id);
      if (res.error) setEmailMessage({ kind: 'err', msg: res.error });
      else setEmailMessage({ kind: 'ok', msg: 'Rapport envoyé au syndic ✓' });
    });
  }

  function applyStatus() {
    if (!selected || !pendingStatut) return;
    setStatusMessage(null);
    startTransition(async () => {
      const res = await updateInterventionStatus(
        selected.id,
        pendingStatut as StatutIntervention,
        pendingStatut === 'en_suspens' ? suspensMotif : null,
      );
      if (res.error) {
        setStatusMessage('Erreur : ' + res.error);
        return;
      }
      // Optimistic local update
      setRows((rs) =>
        rs.map((r) =>
          r.id === selected.id
            ? {
                ...r,
                statut: pendingStatut as StatutIntervention,
                suspens_motif: pendingStatut === 'en_suspens' ? suspensMotif : null,
                updated_at: new Date().toISOString(),
              }
            : r,
        ),
      );
      setStatusMessage('✓ Statut mis à jour');
    });
  }

  return (
    <>
      {/* Topbar */}
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Interventions</h1>
          <p className="text-[11px] text-ink-muted mt-0.5 capitalize">
            {new Date().toLocaleDateString('fr-BE', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2.5 px-6 pt-4 flex-shrink-0">
        <StatCard num={stats.inProgress} label="En cours" />
        <StatCard
          num={stats.suspended}
          label="En suspens"
          warning={stats.suspended > 0}
        />
        <StatCard num={stats.reports} label="Rapports dispo." accent />
        <StatCard num={stats.closed} label="Clôturées (total)" muted />
      </div>

      {/* Banner urgent */}
      {stats.urgent > 0 && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-terra-light border border-terra-mid text-terra rounded-lg text-xs font-semibold">
          ⚡ {stats.urgent} intervention(s) urgente(s) en attente de traitement
        </div>
      )}

      {loadError && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold">
          Connexion à la base limitée : {loadError}
        </div>
      )}

      {/* Filtres */}
      <div className="flex gap-2 px-6 pt-3.5 flex-shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — référence, ACP, syndic, adresse…"
          className="flex-1 px-3.5 py-2.5 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream cursor-pointer"
        >
          <option value="tous">Tous statuts</option>
          {STATUT_PIPELINE.map((s) => (
            <option key={s} value={s}>{STATUT_INFO[s].label}</option>
          ))}
          <option value="en_suspens">En suspens</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 pt-3 pb-4">
        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <table className="w-full border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-sand">
                {['Réf.', 'ACP', 'Type', 'Syndic', 'Technicien', 'Créneau', 'Statut', 'Màj'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-ink-muted text-[13px]">
                    Aucune intervention
                  </td>
                </tr>
              ) : (
                filtered.map((iv) => {
                  const sel = iv.id === selectedId;
                  return (
                    <tr
                      key={iv.id}
                      onClick={() => openDrawer(iv.id)}
                      className={`cursor-pointer border-b border-sand-mid transition-colors ${
                        sel ? 'bg-navy-pale' : 'bg-cream hover:bg-sand-hover'
                      }`}
                    >
                      <td className="px-3.5 py-2.5">
                        <div className="font-mono text-xs font-medium text-navy">{iv.ref ?? '—'}</div>
                        {iv.priorite === 'urgente' && (
                          <span className="inline-block mt-1 text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-1.5 py-0.5">
                            ⚡ URGENT
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-bold text-[13px]">{iv.acp?.nom ?? '—'}</div>
                        <div className="text-[10px] text-ink-muted truncate max-w-[200px]">
                          {[iv.acp?.adresse, iv.acp?.ville].filter(Boolean).join(', ') || '—'}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid whitespace-nowrap">
                        {iv.type ?? '—'}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="text-xs font-semibold">{iv.syndic?.nom ?? '—'}</div>
                        <div className="text-[10px] text-ink-muted">{iv.syndic?.type ?? ''}</div>
                      </td>
                      <td className="px-3.5 py-2.5 text-xs">
                        {iv.technicien ? (
                          <span>{(iv.technicien.prenom ?? '')[0]}. {iv.technicien.nom}</span>
                        ) : (
                          <span className="text-terra font-semibold text-[11px]">Non assigné</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                        {fmtDate(iv.creneau_debut)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <Badge statut={iv.statut} />
                        <Pipebar statut={iv.statut} />
                      </td>
                      <td className="px-3.5 py-2.5 text-[10px] text-ink-muted font-mono whitespace-nowrap">
                        {rel(iv.updated_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-muted mt-2 px-0.5">
          {filtered.length} intervention(s)
          {filtered.length !== rows.length ? ` sur ${rows.length}` : ''} · Cliquez une ligne pour ouvrir le détail
        </p>
      </div>

      {/* Drawer */}
      {selected && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeDrawer(); }}
          className="fixed inset-0 bg-navy-deep/45 z-50 flex justify-end"
        >
          <div className="w-[460px] bg-cream h-screen overflow-y-auto shadow-2xl border-l border-sand-border flex flex-col">
            <header className="px-5 pt-5 bg-sand border-b border-sand-border">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex gap-2 items-center flex-wrap mb-0.5">
                    <span className="font-mono text-xs text-ink-muted">{selected.ref ?? '—'}</span>
                    {selected.priorite === 'urgente' && (
                      <span className="text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-2 py-0.5">
                        ⚡ URGENT
                      </span>
                    )}
                  </div>
                  <div className="text-base font-extrabold text-ink mt-0.5">{selected.acp?.nom ?? '—'}</div>
                  <div className="text-xs text-ink-mid">
                    {[selected.acp?.adresse, selected.acp?.ville].filter(Boolean).join(', ')}
                  </div>
                </div>
                <button
                  onClick={closeDrawer}
                  className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3"><Pipebar statut={selected.statut} /></div>
              <div className="flex justify-between items-center mt-2 pb-4">
                <Badge statut={selected.statut} big />
                <span className="text-[11px] text-ink-muted font-mono">{rel(selected.updated_at)}</span>
              </div>
            </header>

            <nav className="flex bg-cream px-5 border-b border-sand-border">
              {(['dossier','suivi','documents'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-2.5 px-4 text-xs font-medium capitalize border-b-2 transition-colors ${
                    tab === t ? 'text-navy border-navy font-bold' : 'text-ink-muted border-transparent hover:text-ink-mid'
                  }`}
                >
                  {t}
                </button>
              ))}
            </nav>

            <div className="px-5 py-4 flex-1 overflow-y-auto bg-sand">
              {tab === 'dossier' && (
                <>
                  <Block title="Problème">
                    <strong>{selected.type ?? '—'}</strong>
                    <p className="text-ink-mid mt-1.5">{selected.description ?? '—'}</p>
                  </Block>
                  <Block title="Demandeur">
                    <div className="font-bold text-[13px]">{selected.syndic?.nom ?? '—'}</div>
                    <div className="text-[11px] text-ink-muted mt-0.5">{selected.syndic?.type ?? ''}</div>
                  </Block>
                  <Block title="Technicien assigné">
                    {selected.technicien ? (
                      <span className="font-bold text-[13px]">
                        {selected.technicien.prenom} {selected.technicien.nom}
                      </span>
                    ) : (
                      <span className="text-terra font-semibold">⚠ Non assigné</span>
                    )}
                  </Block>
                  <Block title="Créneau">
                    {selected.creneau_debut
                      ? fmtDate(selected.creneau_debut, true)
                      : <span className="text-terra">Non confirmé</span>}
                  </Block>
                  {selected.statut === 'en_suspens' && selected.suspens_motif && (
                    <div className="bg-terra-light border border-terra-mid rounded-lg p-3.5 mb-3">
                      <div className="text-[10px] font-bold text-terra uppercase tracking-wider mb-2">
                        Motif suspension
                      </div>
                      <div className="text-[13px] text-terra">{selected.suspens_motif}</div>
                    </div>
                  )}
                </>
              )}

              {tab === 'suivi' && (
                <>
                  <Block title="Changer le statut">
                    <select
                      value={pendingStatut}
                      onChange={(e) => setPendingStatut(e.target.value as StatutIntervention)}
                      className="w-full px-3 py-2.5 rounded-lg border border-sand-border bg-sand text-xs"
                    >
                      {STATUT_PIPELINE.map((s) => (
                        <option key={s} value={s}>{STATUT_INFO[s].label}</option>
                      ))}
                      <option value="en_suspens">En suspens</option>
                    </select>
                    {pendingStatut === 'en_suspens' && (
                      <textarea
                        value={suspensMotif}
                        onChange={(e) => setSuspensMotif(e.target.value)}
                        placeholder="Motif de suspension…"
                        rows={3}
                        className="w-full mt-2 px-3 py-2 rounded-lg border border-sand-border bg-sand text-xs"
                      />
                    )}
                    <button
                      onClick={applyStatus}
                      disabled={pending || pendingStatut === selected.statut}
                      className="w-full mt-2.5 bg-navy text-white py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      {pending ? 'Mise à jour…' : 'Appliquer le statut'}
                    </button>
                    {statusMessage && (
                      <p className="text-xs mt-2 text-ok font-semibold">{statusMessage}</p>
                    )}
                  </Block>

                  {(selected.statut === 'rapport_disponible' || selected.statut === 'cloturee' || selected.statut === 'facturee') && (
                    <Block title="Rapport au syndic">
                      <p className="text-[12px] text-ink-mid mb-2">
                        Renvoie le PDF du rapport à l&apos;email enregistré du syndic.
                      </p>
                      <button
                        onClick={resendRapport}
                        disabled={emailPending}
                        className="w-full bg-navy text-white py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                      >
                        {emailPending ? 'Envoi…' : '✉ Envoyer le rapport au syndic'}
                      </button>
                      {emailMessage && (
                        <p className={
                          'text-xs mt-2 font-semibold ' +
                          (emailMessage.kind === 'ok' ? 'text-ok' : 'text-terra')
                        }>
                          {emailMessage.msg}
                        </p>
                      )}
                    </Block>
                  )}

                  <FactureBlock
                    interventionId={selected.id}
                    ref={selected.ref}
                    statut={selected.statut}
                  />
                </>
              )}

              {tab === 'documents' && (
                <Block title="Documents">
                  <p className="text-ink-muted text-center py-2">
                    Module documents à venir
                  </p>
                </Block>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({
  num, label, accent, muted, warning,
}: {
  num: number; label: string; accent?: boolean; muted?: boolean; warning?: boolean;
}) {
  let bg = 'bg-cream';
  let border = 'border-sand-border';
  let numColor = 'text-ink';
  if (accent) { bg = 'bg-navy-pale'; border = 'border-navy-light'; numColor = 'text-navy'; }
  if (muted) numColor = 'text-ink-mid';
  if (warning) { bg = 'bg-terra-light'; border = 'border-terra-mid'; numColor = 'text-terra'; }
  return (
    <div className={`${bg} ${border} border rounded-xl px-4 py-3.5`}>
      <div className={`text-[28px] font-extrabold leading-none ${numColor}`}>{num}</div>
      <div className="text-[11px] text-ink-muted mt-1 font-medium">{label}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-cream rounded-xl px-3.5 py-3 border border-sand-border mb-3">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="text-[13px] text-ink leading-relaxed">{children}</div>
    </div>
  );
}
