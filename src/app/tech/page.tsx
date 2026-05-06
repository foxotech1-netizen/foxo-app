import Link from 'next/link';
import { Check, Circle, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtDateTime, todayLong } from '@/lib/format';
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
      <div className="bg-cream border border-sand-border rounded-2xl p-6 text-center">
        <h1 className="text-lg font-extrabold text-ink mb-2">Compte non encodé</h1>
        <p className="text-sm text-ink-mid">
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
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-extrabold text-ink">
          Bonjour {u.prenom ?? ''}
        </h1>
        <p className="text-[11px] text-ink-muted capitalize mt-1">{todayLong()}</p>
        <p className="text-xs text-ink-mid mt-1">
          {aujourdhui.length} mission(s) aujourd&apos;hui · {aVenir.length} à venir
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
      <h2 className="text-[11px] uppercase tracking-widest text-ink-muted font-bold mb-2.5">
        {title}
      </h2>
      {missions.length === 0 ? (
        <p className="text-xs text-ink-mid bg-cream border border-sand-border rounded-xl p-4">
          {empty}
        </p>
      ) : (
        <div className="space-y-2.5">
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
  return (
    <Link
      href={`/tech/interventions/${m.id}`}
      className="block bg-cream border border-sand-border rounded-xl p-3.5 hover:bg-sand-hover active:bg-sand-hover transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] font-semibold text-navy">
            {m.ref ?? '—'}
          </span>
          {m.priorite === 'urgente' && (
            <span className="text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-1.5 py-0.5 inline-flex items-center gap-1">
              <Zap size={10} />URGENT
            </span>
          )}
          {inProgress && (
            <span className="text-[9px] font-bold text-ok bg-ok-light border border-ok-mid rounded-full px-1.5 py-0.5 inline-flex items-center gap-1">
              <Circle size={8} fill="currentColor" />EN COURS
            </span>
          )}
          {done && (
            <span className="text-[9px] font-bold text-navy bg-navy-pale border border-navy-light rounded-full px-1.5 py-0.5 inline-flex items-center gap-1">
              <Check size={10} />TERMINÉE
            </span>
          )}
        </div>
        <StatutBadge statut={m.statut} />
      </div>
      <div className="font-bold text-[14px] text-ink">{m.acp_nom ?? '—'}</div>
      <div className="text-[11px] text-ink-mid mt-0.5">
        {[m.acp_adresse, m.acp_ville].filter(Boolean).join(', ') || '—'}
        {m.adresse ? <> · <span className="text-navy font-semibold">{m.adresse}</span></> : null}
      </div>
      <div className="text-[11px] text-ink-muted mt-1.5 flex items-center gap-2 font-mono">
        <span>{fmtDateTime(m.creneau_debut)}</span>
        {m.type && <><span>·</span><span className="font-sans">{m.type}</span></>}
      </div>
      {m.syndic_nom && (
        <div className="text-[11px] text-ink-muted mt-1">{m.syndic_nom}</div>
      )}
    </Link>
  );
}
