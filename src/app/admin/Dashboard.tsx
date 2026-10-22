'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle, Zap, Inbox, RefreshCw, Mail, Check, X, Clipboard, Trash2,
  ArrowUpRight, type LucideIcon,
} from 'lucide-react';
import type { InterventionRow, Utilisateur } from '@/lib/types/database';
import { fmtTime } from '@/lib/format';
import type { DashboardData, FreeSlot, RecentOccupantResponse } from './page';
import { CreateInterventionModal, type SlotInfo } from './planning/CreateInterventionModal';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ChatIA } from '@/components/admin/ChatIA';
import { NextMissions } from '@/components/admin/NextMissions';
import { SyndicMapWrapper, type SyndicMapPin } from '@/components/portal/SyndicMapWrapper';

// Avatars techniciens — palette FoxO sémantique. Cycle 4 couleurs pour
// différencier visuellement chaque tech dans la grille DashboardTechs.
const TECH_AVATAR_COLORS = [
  { bg: 'var(--color-amber-ink)', soft: 'var(--color-amber-light)' },
  { bg: 'var(--color-navy)',       soft: 'var(--color-navy-pale)' },
  { bg: 'var(--color-ok)',         soft: 'var(--color-ok-light)' },
  { bg: 'var(--color-terra)',      soft: 'var(--color-terra-light)' },
];

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

  // Compteur Gmail "à traiter" (mails non lus). Best-effort : init 0, tout
  // échec (réseau / 403) laisse 0 sans crash. Réponse : { ok, count }.
  const [unreadMails, setUnreadMails] = useState(0);
  useEffect(() => {
    let active = true;
    fetch('/api/admin/mails/unread-count')
      .then((r) => r.json())
      .then((d) => { if (active && d?.ok) setUnreadMails(d.count ?? 0); })
      .catch((e) => console.warn('[mails] compteur non-lus indisponible', e));
    return () => { active = false; };
  }, []);

  // ── Section 1 : stats temps réel ────────────────────────────────────────
  const stats = useMemo(() => {
    const nouvelles = rows.filter((r) => r.statut === 'nouvelle').length;
    const enCours = rows.filter((r) => ['confirmee', 'realisee'].includes(r.statut)).length;
    const enSuspens = rows.filter((r) => r.statut === 'en_suspens').length;
    const aRelancer = rows.filter((r) => r.statut === 'attente' || r.statut === 'en_suspens').length;
    const rapports = rows.filter((r) => r.statut === 'rapport').length;
    const closedThisMonth = rows.filter(
      (r) => r.statut === 'cloturee' && isThisMonth(r.updated_at, today),
    ).length;
    const urgent = rows.filter((r) => r.priorite === 'urgente' && r.statut !== 'cloturee').length;
    return { nouvelles, enCours, enSuspens, aRelancer, rapports, closedThisMonth, urgent };
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
    // NB : les rapports à valider ne sont plus listés ici — même compteur
    // que la carte KPI « Rapports à valider » du haut (statut === 'rapport').
    const occupantsPending: { iv: InterventionRow; pending: { id: string; appartement: string | null; nom: string | null }[] }[] = [];
    for (const iv of rows) {
      if (iv.statut === 'cloturee') continue;
      const list = dashboard.occupantsPendingByIv[iv.id];
      if (list && list.length > 0) {
        occupantsPending.push({ iv, pending: list });
      }
    }
    return { confirmedToday, occupantsPending };
  }, [rows, today, dashboard.occupantsPendingByIv]);

  // ── Rapports à valider (statut 'rapport') — carte « À valider » ──────────
  const rapportsAValider = useMemo(
    () => rows
      .filter((r) => r.statut === 'rapport')
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')),
    [rows],
  );

  // Un seul agencement, responsive : KPI pleine largeur, puis « Aujourd'hui »
  // (3/5) + « À valider » (2/5), puis les sections existantes (réponses
  // occupants, demandes mail, confirmées du jour), le chat express et, sur
  // mobile, la carte des ACP (rendue côté serveur en desktop).
  return (
    <div className="flex flex-col gap-4">
      <div className="fx-kpi-grid">
        <StatCard
          num={unreadMails} label="Mails à traiter" Icon={Mail} teinte="amber"
          detail="Boîte Gmail partagée" href="/admin/mails" active={false}
        />
        <StatCard
          num={stats.nouvelles} label="Nouvelles demandes" Icon={Inbox} teinte="sky"
          detail={stats.urgent > 0 ? `${stats.urgent} urgente${stats.urgent > 1 ? 's' : ''}` : 'Aucune urgence'}
          detailTeinte={stats.urgent > 0 ? 'terra' : 'ok'}
          href="/admin?statut=nouvelle" active={statutFilter === 'nouvelle'}
        />
        <StatCard
          num={stats.aRelancer} label="À relancer" Icon={AlertTriangle} teinte="terra"
          detail={`${stats.enSuspens} en suspens`} detailTeinte={stats.enSuspens > 0 ? 'amber' : undefined}
          href="/admin?statut=a_relancer" active={statutFilter === 'a_relancer'}
        />
        <StatCard
          num={stats.rapports} label="Rapports à valider" Icon={Check} teinte="ok"
          detail={`${stats.closedThisMonth} clôturée${stats.closedThisMonth > 1 ? 's' : ''} ce mois`}
          href="/admin/validation" active={false}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-start">
        <NextMissions
          missions={todayMissions}
          limit={isMobile ? 4 : 6}
          onOpenIntervention={onOpenIntervention}
        />
        <AValiderCard
          rapports={rapportsAValider}
          occupantsPending={todoToday.occupantsPending}
          onOpenIntervention={onOpenIntervention}
        />
      </div>

      {dashboard.recentResponses.length > 0 && (
        <RecentResponsesCard
          responses={dashboard.recentResponses}
          onOpenIntervention={onOpenIntervention}
          nowMs={nowMs}
        />
      )}

      {newMailIvs.length > 0 && (
        <NewMailSection
          mails={newMailIvs}
          onOpenIntervention={onOpenIntervention}
        />
      )}

      {todoToday.confirmedToday.length > 0 && (
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
              className="w-full text-left bg-sand hover:bg-navy-pale border border-sand-mid rounded-lg px-3 py-2 min-h-[44px] flex items-center gap-3"
            >
              <span className="fx-time">{fmtTime(iv.creneau_debut)}</span>
              <span className="fx-body font-medium text-ink truncate flex-1">{iv.acp?.nom ?? '—'}</span>
              <span className="fx-meta">{iv.technicien ? initiales(iv.technicien.prenom, iv.technicien.nom) : '—'}</span>
            </button>
          ))}
        </TodoCard>
      )}

      <ChatIA compact={isMobile} />

      {isMobile && adminPins.length > 0 && (
        <SyndicMapWrapper pins={adminPins} basePath="/admin/interventions" />
      )}
    </div>
  );
}

// ─── Carte « À valider » : rapports à valider + occupants sans réponse ──────
// Données déjà présentes (lignes du tableau, occupantsPendingByIv) ; la file
// complète reste /admin/validation.
function AValiderCard({
  rapports, occupantsPending, onOpenIntervention,
}: {
  rapports: InterventionRow[];
  occupantsPending: { iv: InterventionRow; pending: { id: string; appartement: string | null; nom: string | null }[] }[];
  onOpenIntervention: (id: string) => void;
}) {
  const items: { key: string; teinte: 'ok' | 'amber'; Icon: LucideIcon; titre: string; meta: string; id: string }[] = [
    ...rapports.slice(0, 4).map((iv) => ({
      key: `r-${iv.id}`, teinte: 'ok' as const, Icon: Check,
      titre: iv.acp?.nom ?? iv.particulier_contact?.nom ?? iv.ref ?? '—',
      meta: `Rapport à valider · ${iv.ref ?? ''}`, id: iv.id,
    })),
    ...occupantsPending.slice(0, 4).map(({ iv, pending }) => ({
      key: `o-${iv.id}`, teinte: 'amber' as const, Icon: Inbox,
      titre: iv.acp?.nom ?? '—',
      meta: `${pending.length} occupant${pending.length > 1 ? 's' : ''} sans réponse · ${iv.ref ?? ''}`, id: iv.id,
    })),
  ];
  const total = rapports.length + occupantsPending.length;
  return (
    <section className="fx-card overflow-hidden" aria-label="À valider">
      <div className="fx-card-head">
        <h2 className="fx-h2">À valider</h2>
        <Link href="/admin/validation" className="fx-link">Tout voir →</Link>
      </div>
      {items.length === 0 ? (
        <div className="fx-card-row fx-meta text-center py-6">Rien à valider pour l&apos;instant.</div>
      ) : (
        items.map((it) => (
          <div key={it.key} className="fx-card-row flex items-center gap-3">
            <span className={`fx-ico fx-ico-md fx-ico-light-${it.teinte}`}><it.Icon size={15} aria-hidden /></span>
            <div className="flex-1 min-w-0">
              <div className="fx-body font-medium truncate">{it.titre}</div>
              <div className="fx-meta truncate">{it.meta}</div>
            </div>
            <button type="button" onClick={() => onOpenIntervention(it.id)} className="fx-btn-small">Ouvrir</button>
          </div>
        ))
      )}
      {total > items.length && (
        <div className="fx-card-row fx-meta">
          +{total - items.length} autre{total - items.length > 1 ? 's' : ''} dans la <Link href="/admin/validation" className="fx-link">file de validation</Link>.
        </div>
      )}
    </section>
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

      <h3 className="fx-eyebrow mb-2">
        Vue par technicien
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {techData.length === 0 && (
          <div className="fx-body bg-cream border border-sand-border rounded-modal p-4 text-ink-mid">
            Aucun technicien encodé.
          </div>
        )}
        {techData.map(({ tech, todayIvs, monthRealisees, monthRapports, slots, color }) => (
          <div key={tech.id} className="bg-cream border border-sand-border rounded-modal p-4">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="fx-body w-10 h-10 rounded-full flex items-center justify-center font-semibold flex-shrink-0"
                style={{ background: color.bg, color: 'var(--color-cream)' }}
              >
                {initiales(tech.prenom, tech.nom)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="fx-body font-semibold text-ink truncate">
                  {[tech.prenom, tech.nom].filter(Boolean).join(' ') || tech.email}
                </div>
                <div className="fx-small flex items-center gap-1.5 text-ok">
                  <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                  En ligne
                </div>
              </div>
              <Link
                href={`/admin?tech=${tech.id}`}
                className="fx-link whitespace-nowrap"
              >
                Filtrer →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <MiniStat num={monthRealisees} label="Réalisées ce mois" />
              <MiniStat num={monthRapports} label="Rapports ce mois" accent />
            </div>

            <div className="mb-3">
              <div className="fx-eyebrow font-semibold text-ink-mid mb-1.5">
                Aujourd&apos;hui ({todayIvs.length})
              </div>
              {todayIvs.length === 0 ? (
                <div className="fx-meta text-ink-mid bg-sand rounded-lg px-2.5 py-2">
                  Aucune intervention prévue.
                </div>
              ) : (
                <div className="space-y-1">
                  {todayIvs.map((iv) => (
                    <button
                      key={iv.id}
                      type="button"
                      onClick={() => onOpenIntervention(iv.id)}
                      className="fx-meta w-full min-h-[44px] text-left bg-sand hover:bg-navy-pale border border-sand-mid rounded-lg px-3 py-2 flex items-center gap-2 transition-colors"
                    >
                      <span className="fx-small fx-ref font-semibold text-navy">
                        {fmtTime(iv.creneau_debut)}
                      </span>
                      <span className="font-semibold text-ink truncate flex-1">
                        {iv.acp?.nom ?? iv.particulier_contact?.nom ?? '—'}
                      </span>
                      <span className="fx-small text-ink-mid truncate">{iv.type ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="fx-eyebrow font-semibold text-ink-mid mb-1.5">
                Prochains créneaux libres
              </div>
              {slots.length === 0 ? (
                <div className="fx-meta text-ink-mid bg-sand rounded-lg px-2.5 py-2">
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
                      className="fx-small bg-[var(--color-ok-light)] text-[var(--color-ok)] border border-[var(--color-ok-mid)] rounded-lg px-2 py-1 font-medium cursor-pointer transition-colors hover:bg-[var(--color-ok-mid)] hover:border-[var(--color-amber-foxo)]/30"
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
  num, label, Icon, teinte, detail, detailTeinte, href, active,
}: {
  num: number;
  label: string;
  Icon: LucideIcon;
  teinte: 'sky' | 'amber' | 'terra' | 'ok';
  detail?: string;
  detailTeinte?: 'ok' | 'amber' | 'terra';
  href?: string;
  active?: boolean;
}) {
  const couleurDetail =
    detailTeinte === 'ok' ? 'text-ok'
    : detailTeinte === 'amber' ? 'text-amber-ink'
    : detailTeinte === 'terra' ? 'text-terra-ink'
    : '';
  const content = (
    <div className={`fx-card h-full p-4 flex flex-col gap-3 ${active ? 'ring-2 ring-[var(--color-amber-foxo)]/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="fx-label">{label}</span>
        <span className={`fx-ico fx-ico-lg fx-ico-light-${teinte}`}><Icon size={17} aria-hidden /></span>
      </div>
      <div className="fx-kpi">{num}</div>
      {detail && <div className={`fx-meta ${couleurDetail}`}>{detail}</div>}
    </div>
  );
  if (!href) return content;
  return (
    <Link href={href} className="block h-full rounded-[14px]">
      {content}
    </Link>
  );
}

function MiniStat({ num, label, accent }: { num: number; label: string; accent?: boolean }) {
  return (
    <div className={(accent ? 'bg-navy-pale border-navy-light' : 'bg-sand border-sand-border') + ' border rounded-lg px-2.5 py-2'}>
      <div className={'fx-num-md ' + (accent ? 'text-navy' : '')}>
        {num}
      </div>
      <div className="fx-label mt-1">
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
      className="bg-[var(--color-cream)] rounded-card overflow-hidden"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[var(--color-sand-mid)]">
        <span className="w-[3px] h-3.5 rounded-sm" style={{ background: swatchColor }}></span>
        <span className="fx-body font-sora font-medium text-[var(--color-ink)] flex-1">
          {title}
        </span>
        <span
          className="fx-badge font-semibold px-2 py-0.5 rounded-full"
          style={{ background: badgeBg, color: badgeFg }}
        >
          {count}
        </span>
      </div>
      <div className="p-3 space-y-1.5 max-h-[240px] overflow-y-auto">
        {count === 0 ? (
          <div className="fx-meta text-ink-mid text-center py-4">{empty}</div>
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
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function ackResponse(occupantId: string) {
    // Optimiste : on retire tout de suite la ligne de l'écran.
    setDismissed((prev) => new Set(prev).add(occupantId));
    try {
      const res = await fetch(`/api/admin/occupants/manage/${occupantId}/ack-response`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('ack failed');
      // Re-synchronise les données serveur (carte + pastille sidebar).
      router.refresh();
    } catch {
      // Échec : on remet la ligne et on prévient.
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(occupantId);
        return next;
      });
      alert('La réponse n’a pas pu être retirée. Réessaie dans un instant.');
    }
  }

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
      return { Icon: X, label: 'Décline', cls: 'bg-terra-light text-terra-ink border-terra-mid' };
    }
    return { Icon: null, label: 'En attente', cls: 'bg-sand-mid text-ink-mid border-sand-border' };
  }

  // Lignes déjà acquittées ("vu") dans cette session : retirées de l'affichage.
  // Après router.refresh(), les données serveur ne les renverront plus.
  const visible = responses.filter((r) => !dismissed.has(r.occupant_id));
  if (visible.length === 0) return null;

  return (
    <section>
      <h3 className="fx-eyebrow mb-2 flex items-center gap-1.5">
        <Inbox size={14} aria-hidden /> Réponses occupants reçues (&lt; 48 h)
        <span className="fx-badge fx-badge-terra-solid ml-2">
          {visible.length}
        </span>
      </h3>
      <div
        className="border rounded-modal divide-y divide-sand-mid overflow-hidden"
        style={{ background: 'var(--color-cream)', borderColor: 'var(--color-sand-border)' }}
      >
        {visible.slice(0, 8).map((r) => {
          const tag = reponseLabel(r);
          const fullName = [r.prenom, r.nom].filter(Boolean).join(' ') || 'Occupant';
          return (
            <div
              key={r.occupant_id}
              className="px-4 py-2.5 hover:bg-sand-hover flex items-center gap-2"
            >
              <button
                type="button"
                onClick={() => onOpenIntervention(r.intervention_id)}
                className="flex-1 min-w-0 min-h-[44px] text-left flex items-center gap-3"
              >
                <span className={'fx-badge font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap inline-flex items-center gap-1 ' + tag.cls}>
                  {tag.Icon && <tag.Icon size={11} aria-hidden />}
                  {tag.label}
                </span>
                <span className="flex-1 min-w-0 block">
                  <span className="fx-body block font-semibold text-ink truncate">
                    {fullName}
                    {r.appartement && (
                      <span className="text-ink-mid font-normal ml-1.5">apt. {r.appartement}</span>
                    )}
                  </span>
                  <span className="fx-small block text-ink-mid truncate">
                    <span className="fx-ref text-navy">{r.iv_ref ?? '?'}</span>
                    {r.iv_acp_nom && <span> · {r.iv_acp_nom}</span>}
                  </span>
                </span>
                <span className="fx-small text-ink-mid whitespace-nowrap">
                  {relativeTime(r.confirmed_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => ackResponse(r.occupant_id)}
                title="Marquer comme vu"
                aria-label="Marquer comme vu"
                className="shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-full text-ink-mid hover:text-ink hover:bg-sand-mid transition-colors"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
          );
        })}
        {visible.length > 8 && (
          <div className="fx-small px-4 py-2 text-ink-mid italic text-center">
            +{visible.length - 8} autres réponses récentes — utilise le filtre Tableau de bord pour les voir.
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
        <h3 className="fx-eyebrow flex items-center gap-1.5">
          <Mail size={14} aria-hidden /> Nouvelles demandes mail ({mails.length})
        </h3>
        {mails.length > 1 && (
          <button
            type="button"
            onClick={batchReanalyze}
            disabled={Boolean(batchState?.running)}
            className="fx-small bg-navy text-cream px-2 py-1 rounded font-semibold disabled:opacity-50 inline-flex items-center gap-1"
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
        <div className="mb-2 bg-[var(--color-navy-pale)] border border-[var(--color-navy-light)] rounded-lg px-2.5 py-1.5">
          <div className="fx-small text-[var(--color-navy)] font-medium mb-1">
            Analyse en cours… {batchState.current}/{batchState.total}
            {batchState.updated > 0 && <span className="text-amber-ink ml-2">· {batchState.updated} avec diff</span>}
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
        <div className={'fx-small mb-2 px-3 py-2 font-medium rounded-lg border ' +
          (toast.kind === 'ok'
            ? 'bg-[var(--color-ok-light)] border-[var(--color-ok-mid)] text-[var(--color-ok)]'
            : toast.kind === 'warn'
              ? 'bg-[var(--color-amber-light)] border-[var(--color-amber-foxo)]/30 text-amber-ink'
              : 'bg-[var(--color-terra-light)] border-[var(--color-terra-mid)] text-terra-ink')
        }>
          {toast.msg}
        </div>
      )}

      <div
        className="border rounded-modal p-3"
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
                className="fx-meta row-hover relative bg-[var(--color-cream)] border border-[var(--color-sand-border)] rounded-lg flex items-center gap-2 px-2.5 py-2"
              >
                <button
                  type="button"
                  onClick={() => onOpenIntervention(iv.id)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0 min-h-[44px]"
                >
                  <span className="fx-eyebrow inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-amber-ink font-semibold flex-shrink-0">
                    <Mail size={11} aria-hidden /> Mail
                  </span>
                  <span className="fx-label font-sora font-semibold flex-shrink-0 text-[var(--color-navy)] tracking-[0.01em]">
                    {iv.ref ?? '?'}
                  </span>
                  <span className="font-semibold text-ink truncate flex-1">
                    {fullName}
                  </span>
                  <span className="fx-small text-ink-mid truncate">
                    {iv.type ?? ''}
                  </span>
                  {iv.priorite === 'urgente' && (
                    <Zap size={12} className="text-terra-ink flex-shrink-0" aria-hidden />
                  )}
                  {hasDiff && (
                    <span
                      className="fx-eyebrow inline-flex items-center gap-1 font-semibold px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-amber-ink border border-[var(--color-amber-foxo)]/30"
                      title="Différences détectées par la dernière réanalyse"
                    >
                      <AlertTriangle size={11} aria-hidden /> À vérifier
                    </span>
                  )}
                  {reanalyzing && (
                    <span className="fx-small text-ink-mid">…</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId((cur) => cur === iv.id ? null : iv.id);
                  }}
                  className="fx-body flex-shrink-0 w-11 h-11 inline-flex items-center justify-center rounded-lg text-ink-mid hover:text-navy hover:bg-sand-hover leading-none"
                  aria-label="Actions"
                  aria-expanded={showMenu}
                >
                  ⋯
                </button>

                {showMenu && (
                  <div
                    ref={menuRef}
                    className="absolute top-full right-0 mt-1 z-20 border rounded-card shadow-raised min-w-[200px]"
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
            className="fx-small w-full mt-2 font-semibold text-navy hover:underline"
          >
            {showAll
              ? `— Réduire`
              : `+ Voir ${mails.length - 4} de plus`}
          </button>
        )}
        <p className="fx-small text-ink-mid mt-2 italic">
          Créées automatiquement par le cron à partir de mails entrants. Aucune action n&apos;a été envoyée au client — c&apos;est à toi de planifier.
        </p>
      </div>

      {confirmDeleteId && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setConfirmDeleteId(null); }}
          className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
        >
          <div
            className="border border-terra rounded-modal p-5 w-full max-w-[420px]"
            style={{ background: 'var(--color-cream)'}}
          >
            <h2 className="fxs-block-title text-terra-ink mb-2 flex items-center gap-1.5">
              <Trash2 size={16} aria-hidden /> Supprimer cette intervention
            </h2>
            <p className="fx-body text-ink-mid leading-relaxed">
              Êtes-vous sûr de vouloir supprimer l&apos;intervention{' '}
              <strong className="tabular-nums text-ink">
                {mails.find((m) => m.id === confirmDeleteId)?.ref ?? '?'}
              </strong> ?{' '}
              <strong className="text-terra-ink">Action irréversible.</strong>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="fx-label px-3 py-2 rounded-lg font-semibold border border-[var(--color-sand-mid)] bg-[var(--color-sand)] text-ink-mid disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleting}
                className="fx-label px-3 py-2 rounded-lg font-medium text-[var(--color-cream)] disabled:opacity-50 transition-colors"
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
      className={'fx-label w-full text-left px-3 py-2 font-semibold flex items-center gap-2 disabled:opacity-50 ' +
        (danger
          ? 'text-terra-ink hover:bg-terra-light'
          : 'text-ink hover:bg-sand-hover')
      }
    >
      <Icon size={16} aria-hidden />
      {label}
    </button>
  );
}
