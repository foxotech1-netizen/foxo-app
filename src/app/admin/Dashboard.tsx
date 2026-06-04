'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, Zap, Inbox, RefreshCw, Mail, Check, X, Clipboard, Trash2,
  ArrowUpRight, type LucideIcon,
} from 'lucide-react';
import type { InterventionRow, Utilisateur } from '@/lib/types/database';
import type { DashboardData, FreeSlot, RecentOccupantResponse } from './page';
import { CreateInterventionModal, type SlotInfo } from './planning/CreateInterventionModal';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { BriefingIA } from '@/components/admin/BriefingIA';
import { ChatIA } from '@/components/admin/ChatIA';
import { NextMissions } from '@/components/admin/NextMissions';
import { Accordion } from '@/components/ui/Accordion';
import { SyndicMapWrapper, type SyndicMapPin } from '@/components/portal/SyndicMapWrapper';

// Avatars techniciens — palette FoxO sémantique. Cycle 4 couleurs pour
// différencier visuellement chaque tech dans la grille DashboardTechs.
const TECH_AVATAR_COLORS = [
  { bg: 'var(--color-amber-foxo)', soft: 'var(--color-amber-light)' },
  { bg: 'var(--color-navy)',       soft: 'var(--color-navy-pale)' },
  { bg: 'var(--color-ok)',         soft: 'var(--color-ok-light)' },
  { bg: 'var(--color-terra)',      soft: 'var(--color-terra-light)' },
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
  adminPins = [],
}: {
  rows: InterventionRow[];
  dashboard: DashboardData;
  onOpenIntervention: (id: string) => void;
  statutFilter?: string | null;
  nowMs: number;
  adminPins?: SyndicMapPin[];
}) {
  const today = useMemo(() => new Date(nowMs), [nowMs]);

  // Breakpoints — alignés sur Tailwind (sm=640, md=768, lg=1024).
  // Sur SSR/initial render tous renvoient false → on rend la variante
  // mobile comme fallback safe (DOM léger, accordéon fermé).
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTabletUp = useMediaQuery('(min-width: 768px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

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

  // ── Missions du jour (toutes statuts actifs sauf cloturee) ──────────────
  // Sert à NextMissions — distinct de todoToday.confirmedToday qui ne garde
  // que les confirmées strictes pour la TodoCard "Confirmées aujourd'hui".
  const todayMissions = useMemo(() => {
    return rows
      .filter((r) => r.statut !== 'cloturee' && isSameDay(r.creneau_debut, today))
      .sort((a, b) => (a.creneau_debut ?? '').localeCompare(b.creneau_debut ?? ''));
  }, [rows, today]);

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

  // ── Sections "détaillées" ─────────────────────────────────────────────
  // Bloc commun rendu : (a) inline en tablette, (b) dans la colonne
  // gauche en desktop, (c) dans l'accordéon en mobile. Un seul source
  // of truth pour ces sections legacy.
  const detailedSections = (
    <div className="space-y-5">
      {/* 1. Stats temps réel */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <StatCard num={stats.nouvelles} label="Nouvelles demandes" href="/admin?statut=nouvelle" active={statutFilter === 'nouvelle'} />
        <StatCard num={stats.enCours} label="En cours" accent href="/admin?statut=en_cours" active={statutFilter === 'en_cours'} />
        <StatCard num={stats.enSuspens} label="En suspens" warning={stats.enSuspens > 0} href="/admin?statut=en_suspens" active={statutFilter === 'en_suspens'} />
        <StatCard num={stats.rapports} label="Rapports à envoyer" amber={stats.rapports > 0} href="/admin?statut=rapport" active={statutFilter === 'rapport'} />
        <StatCard num={stats.closedThisMonth} label="Clôturées ce mois" muted href="/admin?statut=cloturee" active={statutFilter === 'cloturee'} />
      </div>

      {/* 2. Alertes prioritaires */}
      {stats.urgent > 0 && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-[var(--color-terra-light)] to-[rgba(247,237,229,0.3)] border border-[var(--color-terra-mid)] border-l-[3px] border-l-[var(--color-terra)] px-4 py-2.5 rounded-r-lg">
          <div className="w-[22px] h-[22px] rounded-md bg-[var(--color-terra)] text-[var(--color-cream)] flex items-center justify-center text-sm font-semibold font-sora flex-shrink-0">
            <Zap size={14} aria-hidden />
          </div>
          <div className="flex-1 text-[13px] text-[var(--color-terra)] font-medium">
            <strong className="text-[var(--color-ink)] font-semibold">{stats.urgent} intervention{stats.urgent > 1 ? 's' : ''} urgente{stats.urgent > 1 ? 's' : ''}</strong>
            {' '}en attente de traitement
          </div>
        </div>
      )}

      {/* 2bis. Réponses occupants récentes (< 48 h) */}
      {dashboard.recentResponses.length > 0 && (
        <RecentResponsesCard
          responses={dashboard.recentResponses}
          onOpenIntervention={onOpenIntervention}
          nowMs={nowMs}
        />
      )}

      {/* 3. Nouvelles demandes mail (cron analyse auto) */}
      {newMailIvs.length > 0 && (
        <NewMailSection
          mails={newMailIvs}
          onOpenIntervention={onOpenIntervention}
        />
      )}

      {/* 4. À faire aujourd'hui */}
      <section>
        <h3 className="section-label mb-2">À faire aujourd&apos;hui</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
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
                className="w-full text-left bg-[var(--color-sand)] hover:bg-navy-pale border border-[var(--color-sand-mid)] rounded-md px-2.5 py-1.5 flex items-center gap-2 text-[12px] transition-colors"
              >
                <span className="font-mono text-[11px] text-navy font-bold">{fmtTime(iv.creneau_debut)}</span>
                <span className="font-bold text-ink truncate flex-1">{iv.acp?.nom ?? '—'}</span>
                <span className="text-[10px] text-ink-muted">{iv.technicien ? initiales(iv.technicien.prenom, iv.technicien.nom) : '—'}</span>
              </button>
            ))}
          </TodoCard>

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
                className="w-full text-left bg-[var(--color-sand)] hover:bg-ok-light border border-[var(--color-sand-mid)] rounded-md px-2.5 py-1.5 flex items-center gap-2 text-[12px] transition-colors"
              >
                <span className="font-mono text-[11px] text-ok font-bold">{iv.ref ?? '?'}</span>
                <span className="font-bold text-ink truncate flex-1">{iv.acp?.nom ?? '—'}</span>
              </button>
            ))}
          </TodoCard>

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
                className="w-full text-left bg-[var(--color-sand)] hover:bg-amber-light border border-[var(--color-sand-mid)] rounded-md px-2.5 py-1.5 text-[12px] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-sora text-[11px] text-[var(--color-amber-foxo)] font-semibold tracking-[0.01em]">{iv.ref ?? '?'}</span>
                  <span className="font-bold text-ink truncate flex-1">{iv.acp?.nom ?? '—'}</span>
                </div>
                <div className="text-[10px] text-ink-muted mt-0.5">
                  {pending.length} occupant(s) sans réponse
                </div>
              </button>
            ))}
          </TodoCard>
        </div>
      </section>
    </div>
  );

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* Briefing du jour — texte réel généré par Claude (cache 1 h côté
          serveur). Masqué si la génération est indisponible (briefingText
          null) pour ne jamais afficher de carte vide. Pleine largeur, en
          tête du Dashboard. */}
      {dashboard.briefingText && (
        <BriefingIA briefingText={dashboard.briefingText} compact={isMobile} />
      )}

      {/* Mobile + Tablet : Missions du jour + Chat express en tête.
          En desktop ces composants migrent dans la colonne droite. */}
      {!isDesktop && (
        <>
          <NextMissions
            missions={todayMissions}
            limit={isMobile ? 3 : 5}
            onOpenIntervention={onOpenIntervention}
          />
          <ChatIA compact={isMobile} />
        </>
      )}

      {/* Desktop (≥1024px) : layout 2 colonnes. Gauche = sections legacy
          (KPIs / mails / todo). Droite = NextMissions + ChatIA. */}
      {isDesktop && (
        <div className="grid grid-cols-[1.4fr_1fr] gap-4 items-start">
          <div>{detailedSections}</div>
          <div className="flex flex-col gap-3">
            <NextMissions
              missions={todayMissions}
              limit={5}
              onOpenIntervention={onOpenIntervention}
            />
            <ChatIA compact={false} />
          </div>
        </div>
      )}

      {/* Tablet (768-1023px) : sections détaillées rendues directement
          (pas d'accordéon — assez d'espace pour tout afficher). */}
      {isTabletUp && !isDesktop && detailedSections}

      {/* Mobile (<768px) : sections détaillées + carte planquées
          dans un accordéon pour garder le focus sur le briefing/chat.
          Badge urgences en cas d'alerte pour pousser à l'ouvrir. */}
      {isMobile && (
        <Accordion
          title="Tableau de bord détaillé"
          defaultOpen={false}
          badge={stats.urgent > 0 ? stats.urgent : undefined}
        >
          <div className="space-y-3 pt-1">
            {adminPins.length > 0 && (
              <SyndicMapWrapper pins={adminPins} basePath="/admin/interventions" />
            )}
            {detailedSections}
          </div>
        </Accordion>
      )}
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

      <h3 className="section-label mb-2">
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
                style={{ background: color.bg, color: 'var(--color-cream)' }}
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
                      className="w-full text-left bg-[var(--color-sand)] hover:bg-navy-pale border border-[var(--color-sand-mid)] rounded-md px-2.5 py-1.5 flex items-center gap-2 text-[12px] transition-colors"
                    >
                      <span className="font-mono font-bold text-navy text-[11px]">
                        {fmtTime(iv.creneau_debut)}
                      </span>
                      <span className="font-bold text-ink truncate flex-1">
                        {iv.acp?.nom ?? iv.particulier_contact?.nom ?? '—'}
                      </span>
                      <span className="text-[10px] text-ink-muted truncate">{iv.type ?? ''}</span>
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
                      className="bg-[var(--color-ok-light)] text-[var(--color-ok)] border border-[var(--color-ok-mid)] rounded-md px-2 py-1 text-[11px] font-medium cursor-pointer transition-colors hover:bg-[var(--color-ok-mid)] hover:border-[var(--color-amber-foxo)]/30"
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
  // Couleur de la pastille accent en haut-droite, par type de KPI.
  // default → navy ; accent (en cours) → sky ; warning (suspens) → terra ;
  // amber (rapports) → amber-foxo ; muted (clôturées) → ink-muted.
  let dotColor = 'var(--color-navy)';
  let dotBg = 'var(--color-navy-pale)';
  let valueColor = 'var(--color-ink)';
  if (accent) { dotColor = 'var(--color-sky-foxo)'; dotBg = 'var(--color-sky-light-foxo)'; }
  else if (warning) { dotColor = 'var(--color-terra)'; dotBg = 'var(--color-terra-light)'; valueColor = 'var(--color-terra)'; }
  else if (amber) { dotColor = 'var(--color-amber-foxo)'; dotBg = 'var(--color-amber-light)'; }
  else if (muted) { dotColor = 'var(--color-ink-muted)'; dotBg = 'var(--color-sand-mid)'; valueColor = 'var(--color-ink-mid)'; }

  // Filtre actif : ring navy autour de la card.
  const activeRing = active ? 'ring-2 ring-[var(--color-amber-foxo)]/40' : '';

  const content = (
    <div
      className={`relative bg-[var(--color-cream)] rounded-[10px] p-4 transition-all hover:-translate-y-0.5 ${activeRing}`}
      style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
    >
      <div className="text-[10px] font-medium tracking-[0.12em] uppercase text-[var(--color-ink-muted)] mb-2.5">
        {label}
      </div>
      <div
        aria-hidden
        className="absolute top-4 right-4 w-[22px] h-[22px] rounded-md flex items-center justify-center"
        style={{ background: dotBg }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }}></span>
      </div>
      <div
        className="font-sora text-3xl font-semibold leading-none mb-1.5"
        style={{ color: valueColor, letterSpacing: '-0.04em' }}
      >
        {num}
      </div>
      {href && (
        <div className="text-[10px] font-medium mt-2 text-[var(--color-navy-mid)]">
          Voir tout →
        </div>
      )}
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
  // Palettes par colonne — design tokens FoxO.
  const swatchColor =
    color === 'navy' ? 'var(--color-navy)'
    : color === 'ok' ? 'var(--color-ok)'
    : 'var(--color-amber-foxo)';
  const badgeBg =
    color === 'navy' ? 'var(--color-navy-pale)'
    : color === 'ok' ? 'var(--color-ok-light)'
    : 'var(--color-amber-light)';
  const badgeFg = swatchColor;

  return (
    <div
      className="bg-[var(--color-cream)] rounded-[10px] overflow-hidden"
      style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
    >
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[var(--color-sand-mid)]">
        <span className="w-[3px] h-3.5 rounded-sm" style={{ background: swatchColor }}></span>
        <span className="font-sora text-[13px] font-medium text-[var(--color-ink)] flex-1">
          {title}
        </span>
        <span
          className="font-sora text-[11px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: badgeBg, color: badgeFg }}
        >
          {count}
        </span>
      </div>
      <div className="p-3 space-y-1.5 max-h-[240px] overflow-y-auto">
        {count === 0 ? (
          <div className="text-[12px] text-[var(--color-ink-muted)] text-center py-4">{empty}</div>
        ) : children}
      </div>
    </div>
  );
}

// ─── Carte Réponses occupants récentes (< 48 h) ─────────────────────
//
// Affichée seulement si > 0. Chaque ligne ouvre le drawer de l'intervention
// concernée. La requête source filtre déjà sur intervention.statut actif
// (cf. /admin/page.tsx).
function RecentResponsesCard({
  responses,
  onOpenIntervention,
  nowMs,
}: {
  responses: RecentOccupantResponse[];
  onOpenIntervention: (id: string) => void;
  nowMs: number;
}) {
  function relativeTime(iso: string): string {
    const minutes = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return 'à l\'instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
  }

  function reponseLabel(r: RecentOccupantResponse): { Icon: LucideIcon | null; label: string; cls: string } {
    if (r.proposed_creneau_debut) {
      return { Icon: RefreshCw, label: 'Autre créneau', cls: 'bg-navy-pale text-navy border-navy-light' };
    }
    if (r.conf === 'confirme') {
      return { Icon: Check, label: 'Présent', cls: 'bg-ok-light text-ok border-ok-mid' };
    }
    if (r.conf === 'decline') {
      return { Icon: X, label: 'Décline', cls: 'bg-terra-light text-terra border-terra-mid' };
    }
    return { Icon: null, label: 'En attente', cls: 'bg-sand-mid text-ink-mid border-sand-border' };
  }

  return (
    <section>
      <h3 className="section-label mb-2 flex items-center gap-1.5">
        <Inbox size={14} aria-hidden /> Réponses occupants reçues (&lt; 48 h)
        <span className="ml-2 inline-block px-2 py-0.5 bg-terra text-white rounded-full text-[10px] font-extrabold">
          {responses.length}
        </span>
      </h3>
      <div
        className="border rounded-2xl divide-y divide-sand-mid overflow-hidden"
        style={{ background: 'var(--color-cream)', borderColor: 'var(--color-sand-border)' }}
      >
        {responses.slice(0, 8).map((r) => {
          const tag = reponseLabel(r);
          const fullName = [r.prenom, r.nom].filter(Boolean).join(' ') || 'Occupant';
          return (
            <button
              key={r.occupant_id}
              type="button"
              onClick={() => onOpenIntervention(r.intervention_id)}
              className="w-full text-left px-4 py-2.5 hover:bg-sand-hover flex items-center gap-3"
            >
              <span className={'text-[10px] font-bold border rounded-full px-2 py-0.5 whitespace-nowrap inline-flex items-center gap-1 ' + tag.cls}>
                {tag.Icon && <tag.Icon size={11} aria-hidden />}
                {tag.label}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink truncate">
                  {fullName}
                  {r.appartement && (
                    <span className="text-ink-mid font-normal ml-1.5">apt. {r.appartement}</span>
                  )}
                </div>
                <div className="text-[11px] text-ink-muted truncate">
                  <span className="font-mono text-navy">{r.iv_ref ?? '?'}</span>
                  {r.iv_acp_nom && <span> · {r.iv_acp_nom}</span>}
                </div>
              </div>
              <span className="text-[10px] text-ink-muted whitespace-nowrap">
                {relativeTime(r.confirmed_at)}
              </span>
            </button>
          );
        })}
        {responses.length > 8 && (
          <div className="px-4 py-2 text-[11px] text-ink-muted italic text-center">
            +{responses.length - 8} autres réponses récentes — utilise le filtre Tableau de bord pour les voir.
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Section Nouvelles demandes mail — kebab menu + batch reanalyze ───
//
// Pour chaque ligne :
//   • Clic = ouvre le drawer (comportement legacy)
//   • Bouton ⋯ = menu avec Réanalyser / Ouvrir / Supprimer
// En haut de section :
//   • Bouton "Tout réanalyser" si > 1 mail (séquentiel pour éviter
//     le rate limit Anthropic)
//   • Progress bar pendant batch
//   • Toast inline avec résultat

interface ReanalysisAnalysis {
  est_demande_intervention: boolean;
  nom_client: string | null;
  adresse: string | null;
  type_probleme: string | null;
  telephone: string | null;
  email: string | null;
  priorite: 'normale' | 'urgente' | null;
  resume: string | null;
  langue: 'fr' | 'nl' | 'en' | null;
  type_demandeur: 'syndic' | 'courtier' | 'particulier' | null;
  nom_societe: string | null;
  nom_immeuble: string | null;
  reference_externe: string | null;
  occupants: { prenom: string; nom: string; email: string; appartement: string; telephone: string }[];
}

function computeDifferences(iv: InterventionRow, analysis: ReanalysisAnalysis): boolean {
  const pc = iv.particulier_contact;
  const currentNom = pc ? `${pc.prenom ?? ''} ${pc.nom ?? ''}`.trim() : '';
  const checks: [string | null, string | null][] = [
    [analysis.nom_client, currentNom || null],
    [analysis.email, pc?.email ?? null],
    [analysis.telephone, pc?.telephone ?? null],
    [analysis.type_probleme, iv.type],
    [analysis.priorite, iv.priorite ?? null],
  ];
  for (const [a, b] of checks) {
    const av = (a ?? '').trim().toLowerCase();
    const bv = (b ?? '').trim().toLowerCase();
    if (a !== null && av !== bv) return true;
  }
  return false;
}

function shortSummary(analysis: ReanalysisAnalysis): string {
  const parts: string[] = [];
  if (analysis.type_demandeur) {
    const icon = analysis.type_demandeur === 'syndic' ? 'Syndic'
      : analysis.type_demandeur === 'courtier' ? 'Courtier'
      : 'Particulier';
    parts.push(analysis.nom_societe ? `${icon} ${analysis.nom_societe}` : icon);
  }
  if (analysis.type_probleme) parts.push(analysis.type_probleme);
  if (analysis.occupants?.length) parts.push(`${analysis.occupants.length} occupant${analysis.occupants.length > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

function NewMailSection({
  mails, onOpenIntervention,
}: {
  mails: InterventionRow[];
  onOpenIntervention: (id: string) => void;
}) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [reanalyzingIds, setReanalyzingIds] = useState<Set<string>>(new Set());
  const [diffIds, setDiffIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [batchState, setBatchState] = useState<{
    running: boolean; current: number; total: number; updated: number; errors: number;
  } | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'warn'; msg: string } | null>(null);
  // Au-delà de 4 mails non traités, on tronque la liste pour ne pas
  // saturer le dashboard. Le bouton "Voir N de plus" déplie tout.
  const [showAll, setShowAll] = useState(false);
  const visibleMails = showAll ? mails : mails.slice(0, 4);

  // Auto-dismiss toast après 5s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Ferme le menu sur clic extérieur
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMenuId) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [openMenuId]);

  async function reanalyzeOne(iv: InterventionRow): Promise<{ ok: boolean; updated: boolean; analysis?: ReanalysisAnalysis }> {
    setReanalyzingIds((s) => new Set(s).add(iv.id));
    try {
      const r = await fetch(`/api/admin/interventions/${iv.id}/reanalyze`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) {
        setToast({
          kind: 'err',
          msg: data.code === 'google_not_connected'
            ? 'Google non connecté — connecte le compte dans /admin/parametres.'
            : `Échec analyse ${iv.ref}: ${data.error ?? '?'}`,
        });
        return { ok: false, updated: false };
      }
      const analysis = data.analysis as ReanalysisAnalysis;
      const diff = computeDifferences(iv, analysis);
      if (diff) {
        setDiffIds((s) => new Set(s).add(iv.id));
      }
      return { ok: true, updated: diff, analysis };
    } catch (e) {
      setToast({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      return { ok: false, updated: false };
    } finally {
      setReanalyzingIds((s) => {
        const next = new Set(s);
        next.delete(iv.id);
        return next;
      });
    }
  }

  async function handleReanalyze(iv: InterventionRow) {
    setOpenMenuId(null);
    const result = await reanalyzeOne(iv);
    if (!result.ok || !result.analysis) return;
    if (result.updated) {
      setToast({
        kind: 'warn',
        msg: `Différences détectées sur ${iv.ref} — drawer ouvert pour validation.`,
      });
      onOpenIntervention(iv.id);
    } else {
      setToast({
        kind: 'ok',
        msg: `Analyse terminée${result.analysis ? ' : ' + shortSummary(result.analysis) : ''}.`,
      });
    }
  }

  async function batchReanalyze() {
    if (mails.length === 0) return;
    setBatchState({ running: true, current: 0, total: mails.length, updated: 0, errors: 0 });
    let updated = 0;
    let errors = 0;
    for (let i = 0; i < mails.length; i++) {
      setBatchState({ running: true, current: i + 1, total: mails.length, updated, errors });
      const r = await reanalyzeOne(mails[i]);
      if (!r.ok) errors++;
      else if (r.updated) updated++;
    }
    setBatchState(null);
    setToast({
      kind: errors > 0 ? 'warn' : 'ok',
      msg: `${mails.length} analysée${mails.length > 1 ? 's' : ''}, ${updated} avec différences${errors ? `, ${errors} erreur${errors > 1 ? 's' : ''}` : ''}.`,
    });
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const r = await fetch(`/api/admin/interventions/${id}`, { method: 'DELETE' });
      const data = await r.json();
      if (!data.ok) {
        setToast({ kind: 'err', msg: data.error ?? 'Échec suppression.' });
        return;
      }
      setToast({ kind: 'ok', msg: `${data.deleted_ref ?? 'Intervention'} supprimée.` });
      setConfirmDeleteId(null);
      // Refresh server data pour retirer la ligne du tableau
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h3 className="section-label flex items-center gap-1.5">
          <Mail size={14} aria-hidden /> Nouvelles demandes mail ({mails.length})
        </h3>
        {mails.length > 1 && (
          <button
            type="button"
            onClick={batchReanalyze}
            disabled={Boolean(batchState?.running)}
            className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold disabled:opacity-50 inline-flex items-center gap-1"
          >
            {batchState?.running ? (
              `Analyse ${batchState.current}/${batchState.total}…`
            ) : (
              <>
                <RefreshCw size={12} aria-hidden /> Tout réanalyser
              </>
            )}
          </button>
        )}
      </div>

      {batchState?.running && (
        <div className="mb-2 bg-[var(--color-navy-pale)] border border-[var(--color-navy-light)] rounded-md px-2.5 py-1.5">
          <div className="text-[11px] text-[var(--color-navy)] font-medium mb-1">
            Analyse en cours… {batchState.current}/{batchState.total}
            {batchState.updated > 0 && <span className="text-[var(--color-amber-foxo)] ml-2">· {batchState.updated} avec diff</span>}
          </div>
          <div className="h-1.5 bg-[var(--color-sand-mid)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-navy)] transition-all"
              style={{ width: `${Math.round((batchState.current / batchState.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {toast && (
        <div className={
          'mb-2 px-3 py-2 text-[11px] font-medium rounded-md border ' +
          (toast.kind === 'ok'
            ? 'bg-[var(--color-ok-light)] border-[var(--color-ok-mid)] text-[var(--color-ok)]'
            : toast.kind === 'warn'
              ? 'bg-[var(--color-amber-light)] border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)]'
              : 'bg-[var(--color-terra-light)] border-[var(--color-terra-mid)] text-[var(--color-terra)]')
        }>
          {toast.msg}
        </div>
      )}

      <div
        className="border rounded-2xl p-3"
        style={{ background: 'var(--color-cream)', borderColor: 'var(--color-sand-border)' }}
      >
        <div className="space-y-1.5">
          {visibleMails.map((iv) => {
            const reanalyzing = reanalyzingIds.has(iv.id);
            const hasDiff = diffIds.has(iv.id);
            const fullName = iv.particulier_contact
              ? `${iv.particulier_contact.prenom ?? ''} ${iv.particulier_contact.nom ?? ''}`.trim()
              : '—';
            const showMenu = openMenuId === iv.id;
            return (
              <div
                key={iv.id}
                className="row-hover relative bg-[var(--color-cream)] border border-[var(--color-sand-border)] rounded-md flex items-center gap-2 px-2.5 py-2 text-[12px]"
              >
                <button
                  type="button"
                  onClick={() => onOpenIntervention(iv.id)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                >
                  <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)] font-semibold flex-shrink-0">
                    <Mail size={11} aria-hidden /> Mail
                  </span>
                  <span className="font-sora text-[12px] font-semibold flex-shrink-0 text-[var(--color-navy)] tracking-[0.01em]">
                    {iv.ref ?? '?'}
                  </span>
                  <span className="font-bold text-ink truncate flex-1">
                    {fullName}
                  </span>
                  <span className="text-[10px] text-ink-muted truncate">
                    {iv.type ?? ''}
                  </span>
                  {iv.priorite === 'urgente' && (
                    <Zap size={12} className="text-terra flex-shrink-0" aria-hidden />
                  )}
                  {hasDiff && (
                    <span
                      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)] border border-[var(--color-amber-foxo)]/30"
                      title="Différences détectées par la dernière réanalyse"
                    >
                      <AlertTriangle size={11} aria-hidden /> À vérifier
                    </span>
                  )}
                  {reanalyzing && (
                    <span className="text-[10px] text-ink-muted">…</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId((cur) => cur === iv.id ? null : iv.id);
                  }}
                  className="flex-shrink-0 px-1.5 py-0.5 text-ink-mid hover:text-navy text-[14px] leading-none"
                  aria-label="Actions"
                  aria-expanded={showMenu}
                >
                  ⋯
                </button>

                {showMenu && (
                  <div
                    ref={menuRef}
                    className="absolute top-full right-0 mt-1 z-20 border rounded-md shadow-lg min-w-[200px]"
                    style={{ background: 'var(--color-cream)', borderColor: 'var(--color-sand-border)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MenuItem
                      Icon={RefreshCw}
                      label={reanalyzing ? 'Analyse en cours…' : 'Réanalyser le mail'}
                      onClick={() => handleReanalyze(iv)}
                      disabled={reanalyzing}
                    />
                    <MenuItem
                      Icon={Clipboard}
                      label="Ouvrir le dossier"
                      onClick={() => { setOpenMenuId(null); onOpenIntervention(iv.id); }}
                    />
                    <MenuItem
                      Icon={ArrowUpRight}
                      label="Ouvrir dans un nouvel onglet"
                      onClick={() => { setOpenMenuId(null); window.open(`/admin/interventions/${iv.id}`, '_blank'); }}
                    />
                    <MenuItem
                      Icon={Trash2}
                      label="Supprimer"
                      danger
                      onClick={() => { setOpenMenuId(null); setConfirmDeleteId(iv.id); }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {mails.length > 4 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full mt-2 text-[11px] font-bold text-navy hover:underline"
          >
            {showAll
              ? `— Réduire`
              : `+ Voir ${mails.length - 4} de plus`}
          </button>
        )}
        <p className="text-[10px] text-ink-muted mt-2 italic">
          Créées automatiquement par le cron à partir de mails entrants. Aucune action n&apos;a été envoyée au client — c&apos;est à toi de planifier.
        </p>
      </div>

      {confirmDeleteId && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDeleteId(null); }}
          className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
        >
          <div
            className="border border-terra rounded-2xl p-5 w-full max-w-[420px]"
            style={{ background: 'var(--color-cream)'}}
          >
            <h2 className="text-[14px] font-extrabold text-terra mb-2 flex items-center gap-1.5">
              <Trash2 size={16} aria-hidden /> Supprimer cette intervention
            </h2>
            <p className="text-[13px] text-ink-mid leading-relaxed">
              Êtes-vous sûr de vouloir supprimer l&apos;intervention{' '}
              <strong className="font-mono text-ink">
                {mails.find((m) => m.id === confirmDeleteId)?.ref ?? '?'}
              </strong> ?{' '}
              <strong className="text-terra">Action irréversible.</strong>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="px-3 py-2 rounded-lg text-[12px] font-bold border border-[var(--color-sand-mid)] bg-[var(--color-sand)] text-ink-mid disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleting}
                className="px-3 py-2 rounded-md text-[12px] font-medium text-[var(--color-cream)] disabled:opacity-50 transition-colors"
                style={{ background: 'var(--color-terra)' }}
              >
                {deleting ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MenuItem({
  Icon, label, onClick, disabled, danger,
}: {
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'w-full text-left px-3 py-2 text-[12px] font-semibold flex items-center gap-2 disabled:opacity-50 ' +
        (danger
          ? 'text-terra hover:bg-terra-light'
          : 'text-ink hover:bg-sand-hover')
      }
    >
      <Icon size={16} aria-hidden />
      {label}
    </button>
  );
}
