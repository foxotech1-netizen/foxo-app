import Link from 'next/link';
import { ArrowRight, CalendarOff, Check, Circle, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtTime, todayLong, TZ_BRUSSELS } from '@/lib/format';
import type { Acp, Intervention, Organisation } from '@/lib/types/database';
import { TechTile } from './TechTile';

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
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <h1 className="fxs-title-sm mb-2">Compte non encodé</h1>
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

  // Mise en avant : la prochaine mission du jour, sinon la prochaine tout
  // court. Les listes sont déjà triées par créneau croissant côté requête.
  const prochaine = aujourdhui[0] ?? aVenir[0] ?? null;
  const prochaineEstAujourdhui = aujourdhui.length > 0;
  const prenom = u.prenom?.trim() || null;

  return (
    <div className="space-y-5">
      {/* Hero — gradient navy FoxO (cohérence avec hero RDV public).
          L'ancien gradient vert tech a été retiré pour aligner l'identité
          principale du portail tech sur la palette navy/sand/cream. Le
          vert --accent-tech reste utilisé en accents secondaires (refs,
          swatches panels, focus inputs, bottom-nav PWA). */}
      <header
        className="-mx-4 px-6 pt-6 pb-7 rounded-b-xl"
        style={{ background: 'linear-gradient(135deg, var(--color-navy) 0%, var(--color-navy-dark) 100%)' }}
      >
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--color-cream)]/55">
          {todayLong()}
        </p>
        <h1 className="font-sora font-semibold text-[26px] leading-[1.1] tracking-[-0.02em] text-[var(--color-cream)] mt-2">
          {prenom ? `Salut ${prenom}` : 'Salut'}
        </h1>
        <p className="text-[13px] text-[var(--color-cream)]/70 mt-2 tabular-nums">
          {aujourdhui.length} mission{aujourdhui.length > 1 ? 's' : ''} aujourd&apos;hui
          {enCoursCount > 0 ? ` · ${enCoursCount} en cours` : ''}
        </p>
      </header>

      {prochaine ? (
        <ProchaineMission m={prochaine} aujourdhui={prochaineEstAujourdhui} />
      ) : (
        <AucuneMission />
      )}

      {/* Couche de navigation rapide posée au-dessus des listes : les tuiles
          d'ancrage font défiler jusqu'aux sections ci-dessous, qui restent la
          source de vérité fonctionnelle. */}
      <nav aria-label="Accès rapides">
        <h2 className="section-label mb-3">Accès rapide</h2>
        <div className="grid grid-cols-3 justify-items-center gap-x-[10px] gap-y-[18px]">
          <TechTile
            href="#missions-jour"
            label="Aujourd'hui"
            icon="calendar-check"
            variant="navy"
            badge={aujourdhui.length}
          />
          <TechTile
            href="#missions-avenir"
            label="À venir"
            icon="calendar-clock"
            variant="amber"
            badge={aVenir.length}
            badgeVariant="amber"
          />
          <TechTile href="/tech/assistant" label="Assistant IA" icon="sparkles" variant="tech" />
          <TechTile href="/tech/historique" label="Historique" icon="clipboard-list" variant="slate" />
          <TechTile href="/tech/notes-frais" label="Notes de frais" icon="receipt" variant="light" />
        </div>
      </nav>

      <Section
        id="missions-jour"
        title="Aujourd'hui"
        missions={aujourdhui}
        empty="Aucune mission programmée aujourd'hui."
      />
      <Section
        id="missions-avenir"
        title="À venir"
        missions={aVenir}
        empty="Pas de mission planifiée dans les 7 jours."
      />
    </div>
  );
}

/* Carte de tête — la mission à ouvrir maintenant, avec un chemin unique et
   très large vers la fiche intervention (usage terrain, une main, gants). */
function ProchaineMission({ m, aujourdhui }: { m: Mission; aujourdhui: boolean }) {
  const heure = m.creneau_debut ? fmtTime(m.creneau_debut) : null;
  const jour = !aujourdhui && m.creneau_debut
    ? new Date(m.creneau_debut).toLocaleDateString('fr-BE', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ_BRUSSELS,
      })
    : null;
  const creneau = [jour, heure].filter(Boolean).join(' · ');
  const adresse = [
    [m.acp_adresse, m.acp_ville].filter(Boolean).join(', '),
    m.adresse,
  ].filter(Boolean).join(' · ');

  return (
    <section
      className="bg-[var(--color-cream)] rounded-xl p-5"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="fx-pulse-dot w-[7px] h-[7px] rounded-full shrink-0"
          style={{ background: 'var(--color-ok)' }}
        />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ok)]">
          Prochaine mission{creneau ? ` · ${creneau}` : ''}
        </span>
      </div>

      <h2 className="fxs-title-sm text-[var(--color-ink)] mt-3">
        {m.ref ?? '—'}
        {m.type && (
          <span className="font-normal text-[var(--color-ink-mid)]"> · {m.type}</span>
        )}
      </h2>

      {m.priorite === 'urgente' && (
        <span className="mt-2 text-[11px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-2.5 py-1 inline-flex items-center gap-1">
          <Zap size={11} aria-hidden />URGENT
        </span>
      )}

      <p className="text-[14px] font-semibold text-[var(--color-ink)] mt-2">{m.acp_nom ?? '—'}</p>
      <p className="text-[13px] text-[var(--color-ink-mid)] mt-0.5 leading-relaxed">
        {adresse || '—'}
      </p>

      <Link href={`/tech/interventions/${m.id}`} className="fx-btn-3d mt-4">
        Ouvrir la mission
        <ArrowRight size={18} aria-hidden />
      </Link>
    </section>
  );
}

/* Aucune mission sur la fenêtre chargée (aujourd'hui + 7 jours) : on ne
   laisse pas un trou à la place de la carte de tête. */
function AucuneMission() {
  return (
    <section
      className="bg-[var(--color-cream)] rounded-xl p-6 text-center"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <span
        aria-hidden
        className="mx-auto mb-3 w-11 h-11 rounded-full flex items-center justify-center"
        style={{ background: 'var(--color-sand-mid)' }}
      >
        <CalendarOff size={20} className="text-[var(--color-ink-mid)]" />
      </span>
      <h2 className="fxs-title-sm text-[var(--color-ink)]">Aucune mission planifiée</h2>
      <p className="text-[14px] text-[var(--color-ink-mid)] mt-2 leading-relaxed">
        Rien n&apos;est programmé pour les 7 prochains jours. Tu peux relire tes
        interventions passées ou déclarer une note de frais.
      </p>
      <div className="flex gap-2 mt-4">
        <Link
          href="/tech/historique"
          className="flex-1 min-h-[44px] flex items-center justify-center rounded-ctl text-[14px] font-semibold text-[var(--color-navy)] bg-[var(--color-navy-pale)] border border-[var(--color-navy-light)]"
        >
          Historique
        </Link>
        <Link
          href="/tech/notes-frais"
          className="flex-1 min-h-[44px] flex items-center justify-center rounded-ctl text-[14px] font-semibold text-[var(--color-navy)] bg-[var(--color-navy-pale)] border border-[var(--color-navy-light)]"
        >
          Notes de frais
        </Link>
      </div>
    </section>
  );
}

function Section({ id, title, missions, empty }: { id: string; title: string; missions: Mission[]; empty: string }) {
  return (
    // scroll-mt : la bannière du layout est sticky sur 64px — sans marge de
    // défilement, l'ancre déposerait le titre de section dessous.
    <section id={id} className="scroll-mt-20">
      <h2 className="section-label mb-3">
        {title}
      </h2>
      {missions.length === 0 ? (
        <div
          className="bg-[var(--color-cream)] rounded-xl p-5"
          style={{ boxShadow: 'var(--shadow-card)' }}
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
  const time = dt ? fmtTime(m.creneau_debut) : null;
  const dateLabel = dt
    ? dt.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ_BRUSSELS })
    : null;
  return (
    <Link
      href={`/tech/interventions/${m.id}`}
      className="block bg-[var(--color-cream)] rounded-xl p-4 transition-all active:scale-[0.99] min-h-[44px]"
      style={{ boxShadow: 'var(--shadow-card)' }}
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
