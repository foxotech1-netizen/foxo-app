import Link from 'next/link';
import { Hand, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { getMonthSlots } from '@/lib/portal/availability';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtDate, todayLong } from '@/lib/format';
import { vocabFor, type OrgType } from '@/lib/portal/vocab';
import type { Intervention } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

export default async function PortalDashboard() {
  const session = await getCurrentSyndic();
  if (!session) return null; // proxy redirige déjà
  const { user, org } = session;

  // Si l'utilisateur n'est lié à aucune org, pas d'interventions à montrer.
  // Affichage explicite plutôt que fallback "voir tout" comme dans le legacy.
  if (!org) {
    return (
      <div className="premium-card p-8 text-center">
        <h1 className="text-xl font-extrabold text-ink mb-2">Compte non lié</h1>
        <p className="text-sm text-ink-mid leading-relaxed max-w-md mx-auto">
          L&apos;adresse <strong>{user.email}</strong> n&apos;est pas encore associée
          à un syndic, un courtier ou un expert dans nos fichiers. Contactez{' '}
          <a href="mailto:info@foxo.be" className="text-[#60A5FA] underline">info@foxo.be</a>{' '}
          pour finaliser l&apos;ouverture de votre compte.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  // Filtre par syndic_id (legacy) OU organisation_id (nouveau lien).
  const { data: interventionsData } = await supabase
    .from('interventions')
    .select('id, ref, statut, priorite, type, creneau_debut, updated_at, acp_id')
    .or(`syndic_id.eq.${org.id},organisation_id.eq.${org.id}`)
    .order('created_at', { ascending: false });

  const interventions: Pick<
    Intervention,
    'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'creneau_debut' | 'updated_at' | 'acp_id'
  >[] = interventionsData ?? [];

  // Joindre nom des ACPs (light)
  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  let acpMap = new Map<string, string>();
  if (acpIds.length > 0) {
    const { data: acps } = await supabase.from('acps').select('id, nom').in('id', acpIds);
    acpMap = new Map((acps ?? []).map((a) => [a.id, a.nom]));
  }

  // Stats
  const stats = {
    enCours: interventions.filter((i) =>
      ['confirmee', 'realisee', 'attente'].includes(i.statut),
    ).length,
    enAttente: interventions.filter((i) => i.statut === 'nouvelle').length,
    rapports: interventions.filter((i) => i.statut === 'rapport').length,
    cloturees: interventions.filter((i) => i.statut === 'cloturee').length,
  };

  // Prochaines dispos (slots libres dans les 14 jours)
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
  const v = vocabFor(orgType);
  const accentBg = orgType === 'courtier'
    ? 'bg-[#1D6FA4] hover:bg-[#175E8E]'
    : orgType === 'expert'
      ? 'bg-[#F59E0B] hover:bg-[#D97706]'
      : 'bg-navy hover:bg-navy-mid';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-display font-extrabold text-[var(--text-primary)]">Bonjour <Hand size={22} /></h1>
          <p className="text-[12px] text-[var(--text-3)] capitalize mt-1">{todayLong()}</p>
          <p className="text-[12px] text-[var(--text-2)] mt-0.5">
            <span className="font-semibold">{org.nom}</span> · {org.type}
          </p>
        </div>
        {v.newRequestVerb && (
          <Link
            href="/portal/nouveau"
            className={`text-white px-4 py-2.5 rounded-lg text-xs font-bold ${accentBg}`}
          >
            {v.newRequestVerb}
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard num={stats.enCours} label="En cours" />
        <StatCard num={stats.enAttente} label="En attente" />
        <StatCard num={stats.rapports} label="Rapports dispo." accent />
        <StatCard num={stats.cloturees} label="Clôturées" muted />
      </div>

      {/* Banner rapport */}
      {stats.rapports > 0 && (
        <Link
          href="/portal/interventions?statut=rapport"
          className="inline-flex items-center gap-1.5 bg-terra-light border border-terra-mid text-terra rounded-lg px-4 py-2.5 text-xs font-semibold hover:bg-[#F2DBC9]"
        >
          <FileText size={14} /> {stats.rapports} rapport(s) disponible(s) — consulter
        </Link>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {/* Récentes */}
        <section>
          <h2 className="section-label mb-3">{v.interventionsCap} récent{orgType === 'syndic' ? 'es' : 's'}</h2>
          {recent.length === 0 ? (
            <div className="premium-card p-4">
              <p className="text-xs text-ink-muted">
                {v.emptyList} pour l&apos;instant.{' '}
                <Link href="/portal/nouveau" className="text-[#60A5FA] underline">
                  Créer le premier
                </Link>
                .
              </p>
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
                    <span>{iv.type ?? 'Type non précisé'}</span>
                    {iv.creneau_debut && (() => {
                      const d = new Date(iv.creneau_debut);
                      const time = d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
                      const dateLabel = d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
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

        {/* Prochaines dispos */}
        <section>
          <h2 className="section-label mb-3">Prochaines disponibilités FoxO</h2>
          {upcoming.length === 0 ? (
            <div className="premium-card p-4">
              <p className="text-xs text-ink-muted">
                Aucun créneau libre sur les 14 prochains jours.
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
                      {fmtDate(s.iso)}
                    </div>
                    <div className="text-[11px] font-bold" style={{ color: '#60A5FA' }}>{s.hour.replace(':', 'h')}</div>
                  </div>
                  <span className="text-[10px] font-bold text-ok bg-ok-light border border-ok-mid rounded-full px-2 py-0.5">
                    Disponible
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
  // Couleur de la barre 3px en haut. default → navy ; accent
  // (rapports dispo) → bleu portal ; muted (clôturées) → gris.
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
      <div className="text-[12px] font-semibold text-[var(--text-secondary)] mt-2">{label}</div>
    </div>
  );
}
