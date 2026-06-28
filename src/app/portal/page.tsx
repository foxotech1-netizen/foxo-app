import Link from 'next/link';
import { cookies } from 'next/headers';
import { Hand, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { buildOrgVisibilityFilter, getMandatedInterventionIds } from '@/lib/portal/org-visibility';
import { getMonthSlots } from '@/lib/portal/availability';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
import { vocabFor, type OrgType } from '@/lib/portal/vocab';
import { normalizeLang, PORTAL_LANG_COOKIE, tFor, localeFor } from '@/lib/portal/i18n';
import { SyndicMapWrapper } from '@/components/portal/SyndicMapWrapper';
import type { Intervention } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

export default async function PortalDashboard() {
  const session = await getCurrentSyndic();
  if (!session) return null; // proxy redirige déjà
  const { user, org } = session;

  // Langue du portail (cookie portal_lang, defaut fr) — composant serveur :
  // on lit la langue ici et on traduit via tFor / localeFor (pas de hook client).
  const lang = normalizeLang((await cookies()).get(PORTAL_LANG_COOKIE)?.value);
  const t = tFor(lang);
  const locale = localeFor(lang);

  if (!org) {
    return (
      <div className="premium-card p-8 text-center">
        <h1 className="fxs-title-sm mb-2">{t('accountNotLinkedTitle')}</h1>
        <p className="text-sm text-ink-mid leading-relaxed max-w-md mx-auto">
          {t('accountNotLinkedBody')}
        </p>
        <p className="text-xs text-ink-muted mt-3">
          <strong>{user.email}</strong> ·{' '}
          <a href="mailto:info@foxo.be" className="text-[#60A5FA] underline">info@foxo.be</a>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const mandatedIds = await getMandatedInterventionIds(supabase, org.id);
  const { data: interventionsData } = await supabase
    .from('interventions')
    .select('id, ref, statut, priorite, type, creneau_debut, updated_at, acp_id, adresse')
    .or(buildOrgVisibilityFilter(org.id, mandatedIds))
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const interventions: Pick<
    Intervention,
    'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'creneau_debut' | 'updated_at' | 'acp_id' | 'adresse'
  >[] = interventionsData ?? [];

  type AcpLite = { id: string; nom: string; lat: number | null; lng: number | null };
  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  let acps: AcpLite[] = [];
  let acpMap = new Map<string, string>();
  if (acpIds.length > 0) {
    const { data } = await supabase.from('acps').select('id, nom, lat, lng').in('id', acpIds);
    acps = (data ?? []) as AcpLite[];
    acpMap = new Map(acps.map((a) => [a.id, a.nom]));
  }

  const pins = interventions
    .filter((iv) => iv.statut !== 'cloturee')
    .map((iv) => {
      const acp = acps.find((a) => a.id === iv.acp_id);
      if (!acp?.lat || !acp?.lng) return null;
      return {
        id: iv.id,
        lat: Number(acp.lat),
        lng: Number(acp.lng),
        ref: iv.ref ?? null,
        acp_nom: acp.nom,
        statut: iv.statut,
        priorite: iv.priorite ?? undefined,
        type: iv.type ?? null,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const nowDate = new Date();
  const prochainRdv = interventions
    .filter((iv) =>
      iv.creneau_debut &&
      new Date(iv.creneau_debut) > nowDate &&
      ['confirmee', 'nouvelle'].includes(iv.statut),
    )
    .sort((a, b) =>
      new Date(a.creneau_debut!).getTime() - new Date(b.creneau_debut!).getTime(),
    )[0] ?? null;

  const stats = {
    enCours: interventions.filter((i) =>
      ['confirmee', 'realisee', 'attente'].includes(i.statut),
    ).length,
    enAttente: interventions.filter((i) => i.statut === 'nouvelle').length,
    rapports: interventions.filter((i) => i.statut === 'rapport').length,
    cloturees: interventions.filter((i) => i.statut === 'cloturee').length,
  };

  const now = new Date();
  const monthSlots = await getMonthSlots(now.getFullYear(), now.getMonth());
  const upcoming = monthSlots
    .filter((s) => s.status === 'libre' && new Date(s.iso).getTime() <= Date.now() + 14 * 24 * 3600_000)
    .slice(0, 5);

  const recent = interventions.slice(0, 4);

  const orgType: OrgType =
    org.type === 'courtier' ? 'courtier' :
    org.type === 'expert'   ? 'expert'   :
    'syndic';
  const v = vocabFor(orgType, lang);
  const accentBg = orgType === 'courtier'
    ? 'bg-[#1D6FA4] hover:bg-[#175E8E]'
    : orgType === 'expert'
      ? 'bg-[#F59E0B] hover:bg-[#D97706]'
      : 'bg-navy hover:bg-navy-mid';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1 inline-flex items-center gap-2">
            {t('greeting')}
            <Hand size={20} className="text-[var(--color-navy)]" />
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide capitalize">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_BRUSSELS })} · <span className="font-semibold normal-case">{org.nom}</span> · {org.type}
          </div>
        </div>
        {v.newRequestVerb && (
          <Link
            href="/portal/nouveau"
            className={`text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm ${accentBg}`}
          >
            {v.newRequestVerb}
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard num={stats.enCours} label={t('statInProgress')} />
        <StatCard num={stats.enAttente} label={t('statPending')} />
        <StatCard num={stats.rapports} label={t('statReportsAvailable')} accent />
        <StatCard num={stats.cloturees} label={t('statClosed')} muted />
      </div>

      {stats.rapports > 0 && (
        <Link
          href="/portal/interventions?statut=rapport"
          className="inline-flex items-center gap-1.5 bg-terra-light border border-terra-mid text-terra rounded-lg px-4 py-2.5 text-xs font-semibold hover:bg-[#F2DBC9]"
        >
          <FileText size={14} /> {stats.rapports} {t('reportsBannerSuffix')}
        </Link>
      )}

      {prochainRdv && (
        <section className="premium-card p-4">
          <h2 className="section-label mb-3">{t('nextAppointment')}</h2>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[15px] font-extrabold text-ink">
                {acpMap.get(prochainRdv.acp_id ?? '') ?? '—'}
              </div>
              {prochainRdv.creneau_debut && (() => {
                const d = new Date(prochainRdv.creneau_debut);
                return (
                  <div className="mt-1 text-[13px] font-bold capitalize" style={{ color: '#60A5FA' }}>
                    {d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ_BRUSSELS })}
                    {' · '}
                    {fmtTime(prochainRdv.creneau_debut)}
                  </div>
                );
              })()}
              <div className="text-[11px] text-ink-muted mt-0.5">{prochainRdv.type ?? v.interventionCap}</div>
            </div>
            <Link
              href={`/portal/interventions/${prochainRdv.id}`}
              className="shrink-0 bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90"
            >
              {t('see')} →
            </Link>
          </div>
        </section>
      )}

      {pins.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-label">{v.mapTitle}</h2>
          </div>
          <SyndicMapWrapper pins={pins} />
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <section>
          <h2 className="section-label mb-3">{v.recentTitle}</h2>
          {recent.length === 0 ? (
            <div className="premium-card p-4">
              {v.newRequestVerb ? (
                <p className="text-xs text-ink-muted">
                  {v.emptyList}.{' '}
                  <Link href="/portal/nouveau" className="text-[#60A5FA] underline">
                    {t('createFirst')}
                  </Link>.
                </p>
              ) : (
                <p className="text-xs text-ink-muted">
                  {v.emptyList}.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {recent.map((iv) => (
                <Link
                  key={iv.id}
                  href={`/portal/interventions/${iv.id}`}
                  className="block premium-card p-3"
                >
                  <div className="flex justify-between items-center gap-3">
                    <span className="font-mono text-[11px] font-semibold" style={{ color: '#60A5FA' }}>
                      {iv.ref ?? '—'}
                    </span>
                    <StatutBadge statut={iv.statut} />
                  </div>
                  <div className="font-semibold text-[13px] text-ink mt-1 truncate">
                    {acpMap.get(iv.acp_id ?? '') ?? '—'}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{iv.type ?? t('typeUnspecified')}</span>
                    {iv.creneau_debut && (() => {
                      const d = new Date(iv.creneau_debut);
                      const time = fmtTime(iv.creneau_debut);
                      const dateLabel = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ_BRUSSELS });
                      return (
                        <>
                          <span>·</span>
                          <span className="font-mono font-bold" style={{ color: '#60A5FA' }}>{time}</span>
                          <span>·</span>
                          <span className="font-mono">{dateLabel}</span>
                        </>
                      );
                    })()}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="section-label mb-3">{t('availabilitiesTitle')}</h2>
          {upcoming.length === 0 ? (
            <div className="premium-card p-4">
              <p className="text-xs text-ink-muted">
                {t('noSlots')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((s) => (
                <Link
                  key={s.iso}
                  href={`/portal/nouveau?date=${s.date}&heure=${s.hour}`}
                  className="flex justify-between items-center premium-card px-3.5 py-2.5"
                >
                  <div>
                    <div className="text-[13px] font-semibold capitalize">
                      {new Date(s.iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long', timeZone: TZ_BRUSSELS })}
                    </div>
                    <div className="text-[11px] font-bold" style={{ color: '#60A5FA' }}>{lang === 'fr' ? s.hour.replace(':', 'h') : s.hour}</div>
                  </div>
                  <span className="text-[10px] font-bold text-ok bg-ok-light border border-ok-mid rounded-full px-2 py-0.5">
                    {t('available')}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  num, label, accent, muted,
}: {
  num: number; label: string; accent?: boolean; muted?: boolean;
}) {
  let barColor = '#1B3A6B';
  if (accent) barColor = '#60A5FA';
  else if (muted) barColor = '#9A9690';
  return (
    <div className="premium-card px-4 py-3.5">
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, height: 3,
          background: barColor,
          borderTopLeftRadius: 'inherit',
          borderTopRightRadius: 'inherit',
        }}
      />
      <div className="kpi-value">{num}</div>
      <div className="text-[12px] font-semibold text-[var(--color-ink-mid)] mt-2">{label}</div>
    </div>
  );
}
