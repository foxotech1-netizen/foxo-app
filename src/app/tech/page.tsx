import Link from 'next/link';
import { ArrowRight, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
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

// Identifiant d'affichage dérivé de l'email de connexion : partie locale
// avant le @, première lettre capitalisée, chiffres finaux détachés par une
// espace ("tech1" → "Tech 1", "j.dupont" → "J.dupont"). Règle générique —
// aucun mapping de comptes en dur, tout futur email de technicien passe.
function techIdFromEmail(email: string | null | undefined): string | null {
  const local = (email ?? '').split('@')[0]?.trim();
  if (!local) return null;
  const m = local.match(/^(.*?)(\d+)$/);
  const base = m ? m[1] : local;
  const digits = m ? m[2] : '';
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  return [cap, digits].filter(Boolean).join(' ') || null;
}

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

  // Mise en avant : la prochaine mission du jour, sinon la prochaine tout
  // court. Les listes sont déjà triées par créneau croissant côté requête.
  const prochaine = aujourdhui[0] ?? aVenir[0] ?? null;
  const prochaineEstAujourdhui = aujourdhui.length > 0;
  const techId = techIdFromEmail(user?.email) ?? u.prenom ?? 'Technicien';

  return (
    // data-tech-dark : déclare la page nativement sombre — sans cet
    // attribut, .tech-main l'envelopperait dans la feuille claire
    // transitoire réservée aux pages pas encore refondues (globals.css).
    <div data-tech-dark className="space-y-5">
      {/* En-tête minimaliste centré, posé directement sur le fond marine.
          Pas de logo ici : la bannière sticky du layout porte déjà le seul
          logo FoxO de l'écran (retour client iPhone). */}
      <header className="text-center pt-3">
        <p
          className="text-[11px] uppercase tracking-[0.18em]"
          style={{ color: 'var(--tech-text-3)' }}
        >
          {todayLong()}
        </p>
        <h1
          className="font-display font-bold text-[22px] mt-1"
          style={{ color: 'var(--tech-text-1)' }}
        >
          {techId}
        </h1>
        <div
          aria-hidden
          className="mx-auto my-3 h-px w-14"
          style={{ background: 'var(--tech-line-strong)' }}
        />
        <p
          className="text-[10.5px] uppercase tracking-[0.32em]"
          style={{ color: 'var(--tech-text-3)' }}
        >
          App terrain
        </p>
      </header>

      {prochaine ? (
        <ProchaineMission m={prochaine} aujourdhui={prochaineEstAujourdhui} />
      ) : (
        // État vide volontairement discret (retour client) : les tuiles et
        // la bottom nav offrent déjà toutes les actions — pas de carte.
        <p
          className="text-center text-[13px] py-5"
          style={{ color: 'var(--tech-text-3)' }}
        >
          Aucune mission planifiée
        </p>
      )}

      <nav aria-label="Navigation rapide" className="space-y-[11px]">
        <TechTile
          href="/tech/missions?vue=jour"
          label="Aujourd'hui"
          subtitle="Missions du jour"
          icon="calendar-check"
          variant="violet"
          badge={aujourdhui.length}
        />
        <TechTile
          href="/tech/missions?vue=avenir"
          label="À venir"
          subtitle="7 prochains jours"
          icon="calendar-clock"
          variant="sky"
          badge={aVenir.length}
          badgeVariant="amber"
        />
        <TechTile
          href="/tech/assistant"
          label="Assistant IA"
          subtitle="Pose tes questions"
          icon="sparkles"
          variant="green"
        />
        <TechTile
          href="/tech/historique"
          label="Historique"
          subtitle="Missions terminées"
          icon="clipboard-list"
          variant="amber"
        />
        <TechTile
          href="/tech/notes-frais"
          label="Notes de frais"
          subtitle="Km & dépenses"
          icon="receipt"
          variant="orange"
        />
      </nav>
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
    <section className="tech-glass-card p-5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="fx-pulse-dot w-[7px] h-[7px] rounded-full shrink-0"
          style={{ background: 'var(--accent-tech)' }}
        />
        <span
          className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: 'var(--accent-tech)' }}
        >
          Prochaine mission{creneau ? ` · ${creneau}` : ''}
        </span>
      </div>

      <h2
        className="font-sora font-semibold text-[19px] tracking-[-0.01em] mt-3"
        style={{ color: 'var(--tech-text-1)' }}
      >
        <span style={{ color: 'var(--tech-cta-2)' }}>{m.ref ?? '—'}</span>
        {m.type && (
          <span className="font-normal" style={{ color: 'var(--tech-text-2)' }}>
            {' '}· {m.type}
          </span>
        )}
      </h2>

      {m.priorite === 'urgente' && (
        <span className="mt-2 text-[11px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-2.5 py-1 inline-flex items-center gap-1">
          <Zap size={11} aria-hidden />URGENT
        </span>
      )}

      <p
        className="text-[14px] font-semibold mt-2"
        style={{ color: 'var(--tech-text-1)' }}
      >
        {m.acp_nom ?? '—'}
      </p>
      <p
        className="text-[13px] mt-0.5 leading-relaxed"
        style={{ color: 'var(--tech-text-2)' }}
      >
        {adresse || '—'}
      </p>

      <Link href={`/tech/interventions/${m.id}`} className="tech-cta-3d mt-4">
        Ouvrir la mission
        <ArrowRight size={18} aria-hidden />
      </Link>
    </section>
  );
}
