'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { InterventionRow, Utilisateur } from '@/lib/types/database';
import type { DashboardData, FreeSlot } from './page';
import { CreateInterventionModal, type SlotInfo } from './planning/CreateInterventionModal';

const TECH_AVATAR_COLORS = [
  { bg: '#A17244', soft: '#F0DCC4' },
  { bg: '#1B3A6B', soft: '#D6E4F7' },
  { bg: '#1F6B45', soft: '#D4EDE2' },
  { bg: '#C4622D', soft: '#F7EDE5' },
];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

function isSameDay(iso: string | null, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear()
    && d.getMonth() === ref.getMonth()
    && d.getDate() === ref.getDate();
}

function isThisMonth(iso: string | null, ref: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function initiales(prenom: string | null, nom: string | null): string {
  return ((prenom ?? '')[0] ?? '').toUpperCase() + ((nom ?? '')[0] ?? '').toUpperCase() || '??';
}

export function Dashboard({
  rows,
  dashboard,
  onOpenIntervention,
  statutFilter,
  nowMs,
}: {
  rows: InterventionRow[];
  dashboard: DashboardData;
  onOpenIntervention: (id: string) => void;
  statutFilter?: string | null;
  nowMs: number;
}) {
  const today = useMemo(() => new Date(nowMs), [nowMs]);

  // ── Section 1 : stats temps réel ────────────────────────────────────────
  const stats = useMemo(() => {
    const nouvelles = rows.filter((r) => r.statut === 'nouvelle').length;
    const enCours = rows.filter((r) => ['confirmee', 'realisee'].includes(r.statut)).length;
    const enSuspens = rows.filter((r) => r.statut === 'en_suspens').length;
    const rapports = rows.filter((r) => r.statut === 'rapport').length;
    const closedThisMonth = rows.filter(
      (r) => r.statut === 'cloturee' && isThisMonth(r.updated_at, today),
    ).length;
    const urgent = rows.filter((r) => r.priorite === 'urgente' && r.statut !== 'cloturee').length;
    return { nouvelles, enCours, enSuspens, rapports, closedThisMonth, urgent };
  }, [rows, today]);

  // ── Nouvelles demandes mail (cron analyse auto) ────────────────────────
  const newMailIvs = useMemo(
    () => rows.filter((r) => r.source === 'mail' && r.statut === 'nouvelle'),
    [rows],
  );

  // ── Section 3 : à faire aujourd'hui ─────────────────────────────────────
  const todoToday = useMemo(() => {
    const confirmedToday = rows.filter(
      (r) => r.statut === 'confirmee' && isSameDay(r.creneau_debut, today),
    );
    const rapportToSend = rows.filter((r) => r.statut === 'rapport');
    const occupantsPending: { iv: InterventionRow; pending: { id: string; appartement: string | null; nom: string | null }[] }[] = [];
    for (const iv of rows) {
      if (iv.statut === 'cloturee') continue;
      const list = dashboard.occupantsPendingByIv[iv.id];
      if (list && list.length > 0) {
        occupantsPending.push({ iv, pending: list });
      }
    }
    return { confirmedToday, rapportToSend, occupantsPending };
  }, [rows, today, dashboard.occupantsPendingByIv]);

  return (
    <div className="space-y-5">
      {/* ── 1. Stats temps réel ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <StatCard
          num={stats.nouvelles}
          label="Nouvelles demandes"
          href="/admin?statut=nouvelle"
          active={statutFilter === 'nouvelle'}
        />
        <StatCard
          num={stats.enCours}
          label="En cours"
          accent
          href="/admin?statut=en_cours"
          active={statutFilter === 'en_cours'}
        />
        <StatCard
          num={stats.enSuspens}
          label="⚠ En suspens"
          warning={stats.enSuspens > 0}
          href="/admin?statut=en_suspens"
          active={statutFilter === 'en_suspens'}
        />
        <StatCard
          num={stats.rapports}
          label="Rapports à envoyer"
          amber={stats.rapports > 0}
          href="/admin?statut=rapport"
          active={statutFilter === 'rapport'}
        />
        <StatCard
          num={stats.closedThisMonth}
          label="Clôturées ce mois"
          muted
          href="/admin?statut=cloturee"
          active={statutFilter === 'cloturee'}
        />
      </div>

      {/* ── 2. Alertes prioritaires ──────────────────────────────────────── */}
      {stats.urgent > 0 && (
        <div className="px-4 py-2.5 bg-terra-light border border-terra-mid text-terra rounded-lg text-xs font-semibold">
          ⚡ {stats.urgent} intervention(s) urgente(s) en attente de traitement
        </div>
      )}

      {/* ── 3. Nouvelles demandes mail (cron analyse auto) ───────────────── */}
      {newMailIvs.length > 0 && (
        <section>
          <h3 className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-2 dark:text-[#C8C2B8]">
            📧 Nouvelles demandes mail ({newMailIvs.length})
          </h3>
          <div className="bg-cream border border-sand-border rounded-2xl p-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
            <div className="space-y-1.5">
              {newMailIvs.map((iv) => (
                <button
                  key={iv.id}
                  type="button"
                  onClick={() => onOpenIntervention(iv.id)}
                  className="w-full text-left bg-white hover:bg-navy-pale border border-sand-border rounded-md px-2.5 py-2 flex items-center gap-2 text-[12px] transition-colors dark:bg-[#221E1A] dark:border-[#3D3A32] dark:hover:bg-[#2A2520]"
                >
                  <span className="inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#A17244] text-white font-bold flex-shrink-0">
                    📧 Mail
                  </span>
                  <span className="font-mono text-[11px] text-navy font-bold flex-shrink-0 dark:text-[#A8C4F2]">
                    {iv.ref ?? '?'}
                  </span>
                  <span className="font-bold text-ink truncate flex-1 dark:text-[#F0ECE4]">
                    {iv.particulier_contact
                      ? `${iv.particulier_contact.prenom ?? ''} ${iv.particulier_contact.nom ?? ''}`.trim()
                      : '—'}
                  </span>
                  <span className="text-[10px] text-ink-muted truncate dark:text-[#C8C2B8]">
                    {iv.type ?? ''}
                  </span>
                  {iv.priorite === 'urgente' && (
                    <span className="text-[10px] font-bold text-terra">⚡</span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-ink-muted mt-2 italic dark:text-[#C8C2B8]">
              Créées automatiquement par le cron à partir de mails entrants. Aucune action n&apos;a été envoyée au client — c&apos;est à toi de planifier.
            </p>
          </div>
        </section>
      )}

      {/* ── 4. À faire aujourd'hui ───────────────────────────────────────── */}
      <section>
        <h3 className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-2">
          À faire aujourd&apos;hui
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Confirmées du jour */}
          <TodoCard
            title="Confirmées aujourd'hui"
            count={todoToday.confirmedToday.length}
            color="navy"
            empty="Aucune intervention confirmée pour aujourd'hui."
          >
            {todoToday.confirmedToday.map((iv) => (
              <button
                key={iv.id}
                type="button"
                onClick={() => onOpenIntervention(iv.id)}
                className="w-full text-left bg-white hover:bg-navy-pale border border-sand-border rounded-md px-2.5 py-1.5 flex items-center gap-2 text-[12px] transition-colors dark:bg-[#221E1A] dark:border-[#3D3A32] dark:hover:bg-[#2A2520]"
              >
                <span className="font-mono text-[11px] text-navy font-bold dark:text-[#A8C4F2]">
                  {fmtTime(iv.creneau_debut)}
                </span>
                <span className="font-bold text-ink truncate flex-1 dark:text-[#F0ECE4]">
                  {iv.acp?.nom ?? '—'}
                </span>
                <span className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">
                  {iv.technicien ? initiales(iv.technicien.prenom, iv.technicien.nom) : '—'}
                </span>
              </button>
            ))}
          </TodoCard>

          {/* Rapports à envoyer */}
          <TodoCard
            title="Rapports à valider/envoyer"
            count={todoToday.rapportToSend.length}
            color="ok"
            empty="Aucun rapport en attente d'envoi."
          >
            {todoToday.rapportToSend.map((iv) => (
              <button
                key={iv.id}
                type="button"
                onClick={() => onOpenIntervention(iv.id)}
                className="w-full text-left bg-white hover:bg-ok-light border border-sand-border rounded-md px-2.5 py-1.5 flex items-center gap-2 text-[12px] transition-colors dark:bg-[#221E1A] dark:border-[#3D3A32] dark:hover:bg-[#2A2520]"
              >
                <span className="font-mono text-[11px] text-ok font-bold dark:text-[#7AC9A0]">{iv.ref ?? '?'}</span>
                <span className="font-bold text-ink truncate flex-1 dark:text-[#F0ECE4]">
                  {iv.acp?.nom ?? '—'}
                </span>
              </button>
            ))}
          </TodoCard>

          {/* Occupants en attente */}
          <TodoCard
            title="Occupants à relancer"
            count={todoToday.occupantsPending.length}
            color="amber"
            empty="Tous les occupants ont confirmé."
          >
            {todoToday.occupantsPending.map(({ iv, pending }) => (
              <button
                key={iv.id}
                type="button"
                onClick={() => onOpenIntervention(iv.id)}
                className="w-full text-left bg-white hover:bg-amber-light border border-sand-border rounded-md px-2.5 py-1.5 text-[12px] transition-colors dark:bg-[#221E1A] dark:border-[#3D3A32] dark:hover:bg-[#2A2520]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-[#8A5A1A] font-bold dark:text-[#E8C896]">{iv.ref ?? '?'}</span>
                  <span className="font-bold text-ink truncate flex-1 dark:text-[#F0ECE4]">{iv.acp?.nom ?? '—'}</span>
                </div>
                <div className="text-[10px] text-ink-muted mt-0.5 dark:text-[#C8C2B8]">
                  {pending.length} occupant(s) sans réponse
                </div>
              </button>
            ))}
          </TodoCard>
        </div>
      </section>
    </div>
  );
}

// ── 6. Vue par technicien (rendue tout en bas par InterventionsClient) ────
export function DashboardTechs({
  rows,
  techs,
  dashboard,
  onOpenIntervention,
  nowMs,
}: {
  rows: InterventionRow[];
  techs: Utilisateur[];
  dashboard: DashboardData;
  onOpenIntervention: (id: string) => void;
  nowMs: number;
}) {
  const today = useMemo(() => new Date(nowMs), [nowMs]);
  const router = useRouter();
  const [creatingSlot, setCreatingSlot] = useState<SlotInfo | null>(null);

  const techData = useMemo(() => {
    return techs.map((t, idx) => {
      const todayIvs = rows.filter(
        (r) => r.technicien_id === t.id && isSameDay(r.creneau_debut, today),
      ).sort((a, b) => (a.creneau_debut ?? '').localeCompare(b.creneau_debut ?? ''));
      const monthRealisees = rows.filter(
        (r) => r.technicien_id === t.id
          && ['realisee', 'rapport', 'cloturee'].includes(r.statut)
          && isThisMonth(r.updated_at, today),
      ).length;
      const monthRapports = rows.filter(
        (r) => r.technicien_id === t.id
          && ['rapport', 'cloturee'].includes(r.statut)
          && isThisMonth(r.updated_at, today),
      ).length;
      const slots: FreeSlot[] = (dashboard.freeSlotsByTech[t.id] ?? []).slice(0, 3);
      const color = TECH_AVATAR_COLORS[idx % TECH_AVATAR_COLORS.length];
      return { tech: t, todayIvs, monthRealisees, monthRapports, slots, color };
    });
  }, [techs, rows, dashboard.freeSlotsByTech, today]);

  return (
    <section>
      {creatingSlot && (
        <CreateInterventionModal
          slot={creatingSlot}
          techs={techs}
          onClose={() => setCreatingSlot(null)}
          onCreated={() => router.refresh()}
        />
      )}

      <h3 className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-2">
        Vue par technicien
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {techData.length === 0 && (
          <div className="bg-cream border border-sand-border rounded-2xl p-4 text-[13px] text-ink-muted">
            Aucun technicien encodé.
          </div>
        )}
        {techData.map(({ tech, todayIvs, monthRealisees, monthRapports, slots, color }) => (
          <div key={tech.id} className="bg-cream border border-sand-border rounded-2xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0"
                style={{ background: color.bg, color: '#fff' }}
              >
                {initiales(tech.prenom, tech.nom)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-[14px] text-ink truncate">
                  {[tech.prenom, tech.nom].filter(Boolean).join(' ') || tech.email}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-ok">
                  <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                  En ligne
                </div>
              </div>
              <Link
                href={`/admin?tech=${tech.id}`}
                className="text-[10px] text-navy underline hover:no-underline whitespace-nowrap"
              >
                Filtrer →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <MiniStat num={monthRealisees} label="Réalisées ce mois" />
              <MiniStat num={monthRapports} label="Rapports ce mois" accent />
            </div>

            <div className="mb-3">
              <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                Aujourd&apos;hui ({todayIvs.length})
              </div>
              {todayIvs.length === 0 ? (
                <div className="text-[12px] text-ink-muted bg-sand rounded-md px-2.5 py-2">
                  Aucune intervention prévue.
                </div>
              ) : (
                <div className="space-y-1">
                  {todayIvs.map((iv) => (
                    <button
                      key={iv.id}
                      type="button"
                      onClick={() => onOpenIntervention(iv.id)}
                      className="w-full text-left bg-white hover:bg-navy-pale border border-sand-border rounded-md px-2.5 py-1.5 flex items-center gap-2 text-[12px] transition-colors dark:bg-[#221E1A] dark:border-[#3D3A32] dark:hover:bg-[#2A2520]"
                    >
                      <span className="font-mono font-bold text-navy text-[11px] dark:text-[#A8C4F2]">
                        {fmtTime(iv.creneau_debut)}
                      </span>
                      <span className="font-bold text-ink truncate flex-1 dark:text-[#F0ECE4]">
                        {iv.acp?.nom ?? iv.particulier_contact?.nom ?? '—'}
                      </span>
                      <span className="text-[10px] text-ink-muted truncate dark:text-[#C8C2B8]">{iv.type ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">
                Prochains créneaux libres
              </div>
              {slots.length === 0 ? (
                <div className="text-[12px] text-ink-muted bg-sand rounded-md px-2.5 py-2">
                  Aucun créneau libre.{' '}
                  <Link href="/admin/planning?tab=manage" className="text-navy underline">
                    Générer
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setCreatingSlot({
                        id: s.id,
                        date: s.date,
                        heure_debut: s.heure_debut,
                        heure_fin: s.heure_fin,
                        technicien_id: s.technicien_id,
                      })}
                      title="Cliquer pour planifier une intervention sur ce créneau"
                      className="bg-ok-light text-ok border border-ok-mid rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors hover:bg-ok-mid hover:border-[#E2C9A1] dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A] dark:hover:bg-[#2A8A5A] dark:hover:border-[#E2C9A1]"
                    >
                      {new Date(s.date + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })}
                      {' · '}
                      {s.heure_debut}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatCard({
  num, label, accent, muted, warning, amber, href, active,
}: {
  num: number; label: string;
  accent?: boolean; muted?: boolean; warning?: boolean; amber?: boolean;
  href?: string; active?: boolean;
}) {
  let bg = 'bg-cream';
  let border = 'border-sand-border';
  let numColor = 'text-ink';
  if (accent) { bg = 'bg-navy-pale'; border = 'border-navy-light'; numColor = 'text-navy'; }
  if (amber)  { bg = 'bg-amber-light'; border = 'border-[#E8C896]'; numColor = 'text-[#8A5A1A]'; }
  if (muted) numColor = 'text-ink-mid';
  if (warning) { bg = 'bg-terra-light'; border = 'border-terra-mid'; numColor = 'text-terra'; }
  const useStatNum = !accent && !amber && !warning;

  // Filtre actif : bordure ambre #E2C9A1, bordure 2px pour effet visible
  const activeRing = active ? 'border-2 border-[#E2C9A1] shadow-sm' : '';
  const interactive = href ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md active:translate-y-0' : '';

  const content = (
    <div className={`${bg} ${active ? '' : border} ${active ? '' : 'border'} ${activeRing} ${interactive} rounded-xl px-4 py-3.5`}>
      <div className={`text-[26px] font-extrabold leading-none ${useStatNum ? 'stat-num' : numColor}`}>{num}</div>
      <div className="text-[10px] text-ink-muted mt-1 font-semibold">{label}</div>
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}

function MiniStat({ num, label, accent }: { num: number; label: string; accent?: boolean }) {
  return (
    <div className={(accent ? 'bg-navy-pale border-navy-light' : 'bg-sand border-sand-border') + ' border rounded-lg px-2.5 py-2'}>
      <div className={'text-[18px] font-extrabold leading-none ' + (accent ? 'text-navy' : 'stat-num')}>
        {num}
      </div>
      <div className="text-[9px] text-ink-muted mt-0.5 font-semibold uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function TodoCard({
  title, count, color, empty, children,
}: {
  title: string;
  count: number;
  color: 'navy' | 'ok' | 'amber';
  empty: string;
  children: React.ReactNode;
}) {
  // Mode clair : pastille pâle assortie. Mode sombre : on bascule sur un
  // fond plus opaque + texte blanc pour atteindre le ratio AA WCAG.
  const headerStyle = {
    navy:  'bg-navy-pale text-navy border-navy-light dark:bg-[#1B3A6B] dark:text-white dark:border-[#2A5298]',
    ok:    'bg-ok-light text-ok border-ok-mid dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A]',
    amber: 'bg-amber-light text-[#8A5A1A] border-[#E8C896] dark:bg-[#A17244] dark:text-white dark:border-[#C4904F]',
  }[color];
  return (
    <div className="bg-cream border border-sand-border rounded-2xl overflow-hidden dark:bg-[#1C1A16] dark:border-[#3D3A32]">
      <div className={'px-4 py-2.5 flex items-center justify-between border-b ' + headerStyle}>
        <span className="text-[11px] font-bold uppercase tracking-wider dark:text-white">{title}</span>
        <span className="text-[12px] font-extrabold dark:text-white">{count}</span>
      </div>
      <div className="p-3 space-y-1.5 max-h-[240px] overflow-y-auto">
        {count === 0 ? (
          <div className="text-[12px] text-ink-muted text-center py-4 dark:text-[#C8C2B8]">{empty}</div>
        ) : children}
      </div>
    </div>
  );
}
