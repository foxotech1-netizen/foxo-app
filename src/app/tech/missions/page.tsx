import Link from 'next/link';
import { Check, ChevronLeft, Circle, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
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

// Liste des missions du tech — vue "jour" (aujourd'hui) ou "avenir" (J+1 à
// J+7), sélectionnée par ?vue=. La fenêtre de données est VOLONTAIREMENT
// dupliquée depuis l'accueil (src/app/tech/page.tsx, requête gelée par
// consigne chantier — ne pas factoriser tant qu'elle l'est) : toute
// évolution doit être répercutée des deux côtés.
export default async function TechMissions({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string }>;
}) {
  const sp = await searchParams;
  const vue: 'jour' | 'avenir' = sp.vue === 'avenir' ? 'avenir' : 'jour';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: u } = await supabase
    .from('utilisateurs')
    .select('id, prenom, nom')
    .eq('email', (user?.email ?? '').toLowerCase())
    .maybeSingle();

  if (!u) {
    return (
      <div data-tech-dark>
        <div className="tech-glass-card p-6 text-center">
          <h1
            className="font-sora font-semibold text-[20px] mb-2"
            style={{ color: 'var(--tech-text-1)' }}
          >
            Compte non encodé
          </h1>
          <p
            className="text-[14px] leading-relaxed"
            style={{ color: 'var(--tech-text-2)' }}
          >
            {user?.email} n&apos;existe pas dans la table utilisateurs.<br />
            Contacte l&apos;administrateur pour finaliser ton accès.
          </p>
        </div>
      </div>
    );
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const endOfWeek = new Date(startOfDay);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

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

  const list = missions.filter((m) => {
    if (!m.creneau_debut) return false;
    const d = new Date(m.creneau_debut);
    return vue === 'jour' ? d >= startOfDay && d < endOfDay : d >= endOfDay;
  });

  return (
    // data-tech-dark : page nativement sombre — sans lui, .tech-main
    // appliquerait la feuille claire transitoire (cf. globals.css).
    <div data-tech-dark className="space-y-4">
      <header>
        <Link
          href="/tech"
          className="inline-flex items-center gap-0.5 min-h-[44px] text-[13px] font-semibold"
          style={{ color: 'var(--tech-text-2)' }}
        >
          <ChevronLeft size={16} aria-hidden />
          Accueil
        </Link>
        <h1
          className="font-sora font-semibold text-[22px] tracking-[-0.02em]"
          style={{ color: 'var(--tech-text-1)' }}
        >
          {vue === 'jour' ? 'Missions du jour' : 'Missions à venir'}
        </h1>
      </header>

      {list.length === 0 ? (
        <EmptyState vue={vue} />
      ) : (
        <div className="space-y-3">
          {list.map((m) => (
            <MissionCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ vue }: { vue: 'jour' | 'avenir' }) {
  return (
    <div className="tech-glass-card p-6 text-center">
      <p
        className="text-[15px] font-semibold"
        style={{ color: 'var(--tech-text-1)' }}
      >
        {vue === 'jour'
          ? 'Aucune mission aujourd’hui'
          : 'Aucune mission planifiée cette semaine'}
      </p>
      <p
        className="text-[14px] mt-2 leading-relaxed"
        style={{ color: 'var(--tech-text-2)' }}
      >
        {vue === 'jour'
          ? 'Ton planning du jour est libre.'
          : 'Rien sur les 7 prochains jours.'}{' '}
        Consulte{' '}
        <Link
          href={vue === 'jour' ? '/tech/missions?vue=avenir' : '/tech/historique'}
          className="font-semibold underline underline-offset-2"
          style={{ color: 'var(--tech-cta-2)' }}
        >
          {vue === 'jour' ? 'les missions à venir' : 'ton historique'}
        </Link>{' '}
        ou l&apos;assistant en cas de doute sur ton planning.
      </p>
    </div>
  );
}

// Carte mission — markup hérité des listes de l'ancien accueil (commit
// 2c423db), adapté au thème sombre : verre, ref ambre, heure vert tech.
// Les pastilles URGENT / EN COURS / TERMINÉE et le StatutBadge portent
// leurs propres fonds clairs — lisibles tels quels sur le verre.
function MissionCard({ m }: { m: Mission }) {
  const inProgress = Boolean(m.started_at && !m.ended_at);
  const done = Boolean(m.ended_at);
  const dt = m.creneau_debut ? new Date(m.creneau_debut) : null;
  const time = dt ? fmtTime(m.creneau_debut) : null;
  const dateLabel = dt
    ? dt.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ_BRUSSELS })
    : null;
  return (
    <Link
      href={`/tech/interventions/${m.id}`}
      className="tech-glass-card block p-4 transition-all active:scale-[0.99] min-h-[44px]"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="font-sora text-[12px] font-semibold tracking-[0.01em]"
            style={{ color: 'var(--tech-cta-2)' }}
          >
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
      <div className="font-semibold text-[15px]" style={{ color: 'var(--tech-text-1)' }}>
        {m.acp_nom ?? '—'}
      </div>
      <div className="text-[12px] mt-1" style={{ color: 'var(--tech-text-2)' }}>
        {[m.acp_adresse, m.acp_ville].filter(Boolean).join(', ') || '—'}
        {m.adresse ? (
          <>
            {' '}·{' '}
            <span className="font-semibold" style={{ color: 'var(--tech-text-1)' }}>
              {m.adresse}
            </span>
          </>
        ) : null}
      </div>
      <div
        className="text-[12px] mt-2 flex items-center gap-2 font-mono"
        style={{ color: 'var(--tech-text-2)' }}
      >
        {time && (
          <span className="font-semibold" style={{ color: 'var(--accent-tech)' }}>
            {time}
          </span>
        )}
        {time && dateLabel && <span>·</span>}
        {dateLabel && <span>{dateLabel}</span>}
        {!time && !dateLabel && <span>—</span>}
        {m.type && (
          <>
            <span>·</span>
            <span className="font-sans" style={{ color: 'var(--tech-text-1)' }}>{m.type}</span>
          </>
        )}
      </div>
      {m.syndic_nom && (
        <div className="text-[12px] mt-1" style={{ color: 'var(--tech-text-2)' }}>
          {m.syndic_nom}
        </div>
      )}
    </Link>
  );
}
