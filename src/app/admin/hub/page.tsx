import Link from 'next/link';
import {
  Building2,
  CalendarDays,
  LayoutDashboard,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/Logo';
import { getValidationTotal } from '@/lib/admin/validation-queue';

export const dynamic = 'force-dynamic';

type Tile = {
  href: string;
  external?: boolean;
  icon: LucideIcon;
  label: string;
  subtitle: string;
  accent: string;
  badge?: number;
};

export default async function HubPage() {
  // Auth gate géré par /admin/layout.tsx parent — on s'appuie dessus.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Prénom — best-effort depuis utilisateurs, fallback sur la part locale
  // de l'email avec capitalisation. Évite "Bonjour, undefined".
  let prenom: string | null = null;
  if (user?.email) {
    const { data: u } = await supabase
      .from('utilisateurs')
      .select('prenom')
      .eq('email', user.email)
      .maybeSingle();
    prenom = (u as { prenom?: string | null } | null)?.prenom ?? null;
  }
  if (!prenom && user?.email) {
    const local = user.email.split('@')[0];
    prenom = local.charAt(0).toUpperCase() + local.slice(1);
  }

  const today = new Date().toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Compteurs badges — chaque requête isolée (allSettled) car la table
  // messages peut ne pas être encore appliquée en prod (migration
  // 2026-05-27). Un échec isolé ne casse pas le rendu de la page.
  const todayIso = new Date().toISOString().slice(0, 10);
  const safeCount = async (p: PromiseLike<{ count: number | null }>): Promise<number> => {
    try {
      const r = await p;
      return r.count ?? 0;
    } catch {
      return 0;
    }
  };
  const [urgentCount, overdueCount, unreadCount, aValiderCount] = await Promise.all([
    safeCount(
      supabase
        .from('interventions')
        .select('id', { count: 'exact', head: true })
        .eq('priorite', 'urgente')
        .not('statut', 'in', '(cloturee)')
        .is('deleted_at', null),
    ),
    safeCount(
      supabase
        .from('factures')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'facture')
        .eq('statut', 'envoyee')
        .lt('date_echeance', todayIso)
        .is('deleted_at', null),
    ),
    safeCount(
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('lu_admin', false)
        .in('auteur_type', ['syndic', 'courtier', 'expert']),
    ),
    // File de validation (5 sources) — module partagé ; tolérant comme safeCount.
    getValidationTotal(supabase).catch(() => 0),
  ]);
  const totalNotifs = urgentCount + overdueCount + unreadCount;

  const tiles: Tile[] = [
    {
      // /admin/home a été retiré au Sprint 1 (Tableau de bord adaptive
      // remplace l'écran d'accueil tuiles). On pointe directement vers
      // le dashboard, qui héberge maintenant le briefing IA.
      href: '/admin',
      icon: LayoutDashboard,
      label: 'Administration',
      subtitle: 'Interventions, facturation, clients',
      accent: 'var(--color-amber-foxo)',
      badge: totalNotifs,
    },
    {
      href: 'https://tech.foxo.be',
      external: true,
      icon: Wrench,
      label: 'App Terrain',
      subtitle: 'Rapports, photos, paiements',
      accent: 'var(--color-ok)',
    },
    {
      href: 'https://portal.foxo.be',
      external: true,
      icon: Building2,
      label: 'Portail Syndic',
      subtitle: 'Dossiers, documents, RDV',
      accent: 'var(--color-navy-mid)',
    },
    {
      href: 'https://portal.foxo.be/rdv',
      external: true,
      icon: CalendarDays,
      label: 'RDV Public',
      subtitle: 'Formulaire clients particuliers',
      accent: 'var(--color-terra)',
    },
  ];

  return (
    <div className="flex-1 overflow-auto">
      {/* Header dégradé sombre — hardcodé volontairement (identité
          launcher), indépendant du thème actif. */}
      <header className="fx-sidebar-bg px-6 py-10 text-center">
        <div className="flex justify-center mb-4">
          <Logo size={56} variant="blanc" priority />
        </div>
        <h1 className="fx-h1 font-semibold text-cream">
          Bonjour, {prenom ?? 'Admin'}
        </h1>
        <p className="fx-body text-[var(--sb-text-dim)] mt-1 capitalize">
          {today}
        </p>
      </header>

      {/* Grille 2x2 centrée */}
      <div className="px-6 py-10 flex justify-center">
        <div className="grid grid-cols-2 gap-4 sm:gap-6">
          {tiles.map((t) => {
            const Icon = t.icon;
            const tileClass = 'relative w-[140px] sm:w-[160px] aspect-square bg-cream border border-card-border rounded-2xl overflow-hidden flex flex-col items-center justify-center gap-1.5 transition-all hover:scale-[1.03] hover:shadow-raised';
            const inner = (
              <>
                {/* Barre couleur accent en haut (4px) */}
                <div
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{ background: t.accent }}
                />
                <Icon size={40} style={{ color: t.accent }} />
                <div className="fx-h2 font-semibold text-ink text-center px-2">
                  {t.label}
                </div>
                <div className="fx-meta text-ink-mid text-center px-3 leading-tight">
                  {t.subtitle}
                </div>
                {t.badge && t.badge > 0 ? (
                  <div className="fx-badge absolute top-2 right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-terra text-cream font-semibold flex items-center justify-center">
                    {t.badge > 99 ? '99+' : t.badge}
                  </div>
                ) : null}
              </>
            );
            return t.external ? (
              <a
                key={t.href}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className={tileClass}
              >
                {inner}
              </a>
            ) : (
              <Link key={t.href} href={t.href} className={tileClass}>
                {inner}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Détail des notifications (visible si > 0) — chips cliquables
          vers le module concerné. */}
      {(totalNotifs > 0 || aValiderCount > 0) && (
        <div className="px-6 pb-10">
          <div className="max-w-[400px] mx-auto bg-cream border border-sand-border rounded-xl p-4">
            <div className="fx-eyebrow font-semibold text-ink-mid mb-2">
              À traiter
            </div>
            <div className="fx-body space-y-1.5">
              {urgentCount > 0 && (
                <Link
                  href="/admin?priorite=urgente"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="text-ink">Interventions urgentes</span>
                  <span className="text-terra font-semibold">{urgentCount}</span>
                </Link>
              )}
              {overdueCount > 0 && (
                <Link
                  href="/admin/facturation"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="text-ink">Factures en retard</span>
                  <span className="text-terra font-semibold">{overdueCount}</span>
                </Link>
              )}
              {unreadCount > 0 && (
                <Link
                  href="/admin"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="text-ink">Messages non lus</span>
                  <span className="text-terra font-semibold">{unreadCount}</span>
                </Link>
              )}
              {aValiderCount > 0 && (
                <Link
                  href="/admin/validation"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="text-ink">À valider</span>
                  <span className="text-terra font-semibold">{aValiderCount}</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
