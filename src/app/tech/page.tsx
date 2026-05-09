import Link from 'next/link';
import { Check, Circle, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { StatutBadge } from '@/components/StatutBadge';
import { todayLong } from '@/lib/format';
import type { Acp, Intervention, Organisation } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

type Mission = Pick<
  Intervention,
  | 'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'description'
  | 'creneau_debut' | 'started_at' | 'ended_at' | 'updated_at'
  | 'acp_id' | 'syndic_id' | 'adresse'
> & {
  acp_nom: string | null;
  acp_adresse: string | null;
  acp_ville: string | null;
  syndic_nom: string | null;
};

export default async function TechHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Récupère l'utilisateur applicatif lié au tech connecté
  const { data: u } = await supabase
    .from('utilisateurs')
    .select('id, prenom, nom')
    .eq('email', (user?.email ?? '').toLowerCase())
    .maybeSingle();

  if (!u) {
    return (
      <div
        className="bg-[var(--color-cream)] rounded-xl p-6 text-center"
        style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
      >
        <h1 className="font-sora text-[20px] font-semibold text-[var(--color-ink)] mb-2">Compte non encodé</h1>
        <p className="text-[14px] text-[var(--color-ink-mid)] leading-relaxed">
          {user?.email} n&apos;existe pas dans la table utilisateurs.<br />
          Contacte l&apos;administrateur pour finaliser ton accès.
        </p>
      </div>
    );
  }

  // Aujourd'hui
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const endOfWeek = new Date(startOfDay);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  // Missions du tech : aujourd'hui + 7 jours à venir
  const { data: ivData } = await supabase
    .from('interventions')
    .select('id, ref, statut, priorite, type, description, creneau_debut, started_at, ended_at, updated_at, acp_id, syndic_id, adresse')
    .eq('technicien_id', u.id)
    .gte('creneau_debut', startOfDay.toISOString())
    .lt('creneau_debut', endOfWeek.toISOString())
    .order('creneau_debut', { ascending: true });

  const interventions = (ivData ?? []) as Pick<
    Intervention,
    | 'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'description'
    | 'creneau_debut' | 'started_at' | 'ended_at' | 'updated_at'
    | 'acp_id' | 'syndic_id' | 'adresse'
  >[];

  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  const syndicIds = Array.from(new Set(interventions.map((i) => i.syndic_id).filter(Boolean) as string[]));

  const [acpRes, orgRes] = await Promise.all([
    acpIds.length > 0
      ? supabase.from('acps').select('id, nom, adresse, ville').in('id', acpIds)
      : Promise.resolve({ data: [] as Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>[] }),
    syndicIds.length > 0
      ? supabase.from('organisations').select('id, nom').in('id', syndicIds)
      : Promise.resolve({ data: [] as Pick<Organisation, 'id' | 'nom'>[] }),
  ]);
  const acpMap = new Map(((acpRes.data ?? []) as Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>[]).map((a) => [a.id, a]));
  const orgMap = new Map(((orgRes.data ?? []) as Pick<Organisation, 'id' | 'nom'>[]).map((o) => [o.id, o.nom]));

  const missions: Mission[] = interventions.map((iv) => {
    const acp = iv.acp_id ? acpMap.get(iv.acp_id) ?? null : null;
    return {
      ...iv,
      acp_nom: acp?.nom ?? null,
      acp_adresse: acp?.adresse ?? null,
      acp_ville: acp?.ville ?? null,
      syndic_nom: iv.syndic_id ? orgMap.get(iv.syndic_id) ?? null : null,
    };
  });

  const aujourdhui = missions.filter((m) => {
    if (!m.creneau_debut) return false;
    const d = new Date(m.creneau_debut);
    return d >= startOfDay && d < endOfDay;
  });
  const aVenir = missions.filter((m) => {
    if (!m.creneau_debut) return false;
    const d = new Date(m.creneau_debut);
    return d >= endOfDay;
  });

  const enCoursCount = missions.filter((m) => m.started_at && !m.ended_at).length;

  return (
    <div className="space-y-4">
      {/* Hero — gradient sombre vert tech, identité PWA terrain. Hex
          conservés volontairement (identité visuelle hors palette FoxO,
          comme le launcher /admin/hub). */}
      <header
        className="-mx-4 px-6 py-7 mb-1 rounded-b-xl"
        style={{ background: 'linear-gradient(180deg, #0d2318 0%, #1a3d2a 100%)' }}
      >
        <h1 className="font-sora font-semibold text-[24px] text-[var(--color-cream)] tracking-tight">
          Bonjour {u.prenom ?? ''}
        </h1>
        <p className="text-[13px] text-[var(--color-cream)]/75 capitalize mt-1">{todayLong()}</p>
        <p className="text-[13px] text-[var(--color-cream)]/65 mt-2">
          {aujourdhui.length} mission{aujourdhui.length > 1 ? 's' : ''} aujourd&apos;hui · {aVenir.length} à venir
          {enCoursCount > 0 ? ` · ${enCoursCount} en cours` : ''}
        </p>
      </header>

      <Section title="Aujourd'hui" missions={aujourdhui} empty="Aucune mission programmée aujourd'hui." />
      <Section title="À venir" missions={aVenir} empty="Pas de mission planifiée dans les 7 jours." />
    </div>
  );
}

function Section({ title, missions, empty }: { title: string; missions: Mission[]; empty: string }) {
  return (
    <section>
      <h2 className="text-[11px] font-medium tracking-[0.12em] uppercase text-[var(--color-ink-mid)] mb-3">
        {title}
      </h2>
      {missions.length === 0 ? (
        <div
          className="bg-[var(--color-cream)] rounded-xl p-5"
          style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
        >
          <p className="text-[14px] text-[var(--color-ink-mid)]">{empty}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {missions.map((m) => (
            <MissionCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </section>
  );
}

function MissionCard({ m }: { m: Mission }) {
  const inProgress = Boolean(m.started_at && !m.ended_at);
  const done = Boolean(m.ended_at);
  // Split date / heure pour mettre l'heure en accent vert tech (--accent-tech).
  const dt = m.creneau_debut ? new Date(m.creneau_debut) : null;
  const time = dt ? dt.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : null;
  const dateLabel = dt
    ? dt.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' })
    : null;
  return (
    <Link
      href={`/tech/interventions/${m.id}`}
      className="block bg-[var(--color-cream)] rounded-xl p-4 transition-all active:scale-[0.99] min-h-[44px]"
      style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-sora text-[12px] font-semibold tracking-[0.01em] text-[var(--accent-tech)]">
            {m.ref ?? '—'}
          </span>
          {m.priorite === 'urgente' && (
            <span className="text-[11px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-2.5 py-1 inline-flex items-center gap-1">
              <Zap size={11} />URGENT
            </span>
          )}
          {inProgress && (
            <span className="text-[11px] font-semibold text-[var(--color-amber-foxo)] bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 rounded-full px-2.5 py-1 inline-flex items-center gap-1">
              <Circle size={9} fill="currentColor" />EN COURS
            </span>
          )}
          {done && (
            <span className="text-[11px] font-semibold text-[var(--color-ok)] bg-[var(--color-ok-light)] border border-[var(--color-ok-mid)] rounded-full px-2.5 py-1 inline-flex items-center gap-1">
              <Check size={11} />TERMINÉE
            </span>
          )}
        </div>
        <StatutBadge statut={m.statut} />
      </div>
      <div className="font-semibold text-[15px] text-[var(--color-ink)]">{m.acp_nom ?? '—'}</div>
      <div className="text-[12px] text-[var(--color-ink)] mt-1">
        {[m.acp_adresse, m.acp_ville].filter(Boolean).join(', ') || '—'}
        {m.adresse ? <> · <span className="text-[var(--color-ink)] font-semibold">{m.adresse}</span></> : null}
      </div>
      <div className="text-[12px] text-[var(--color-ink-mid)] mt-2 flex items-center gap-2 font-mono">
        {time && (
          <span className="font-semibold text-[var(--accent-tech)]">{time}</span>
        )}
        {time && dateLabel && <span>·</span>}
        {dateLabel && <span>{dateLabel}</span>}
        {!time && !dateLabel && <span>—</span>}
        {m.type && <><span>·</span><span className="font-sans text-[var(--color-ink)]">{m.type}</span></>}
      </div>
      {m.syndic_nom && (
        <div className="text-[12px] text-[var(--color-ink-mid)] mt-1">{m.syndic_nom}</div>
      )}
    </Link>
  );
}
