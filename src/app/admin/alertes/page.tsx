import Link from 'next/link';
import { Pause, Circle, FileText, type LucideIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { StatutBadge } from '@/components/StatutBadge';
import { CollapsedSection } from '@/components/admin/CollapsedSection';
import { fmtDateTime, relTime } from '@/lib/format';
import type { Acp, Intervention, Organisation } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

type AlertItem = Pick<
  Intervention, 'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'creneau_debut' | 'updated_at' | 'acp_id' | 'syndic_id' | 'technicien_id'
> & {
  acp_nom: string | null;
  acp_adresse: string | null;
  syndic_nom: string | null;
};

export default async function AlertesPage() {
  const supabase = await createClient();

  const { data: ivData } = await supabase
    .from('interventions')
    .select('id, ref, statut, priorite, type, creneau_debut, updated_at, acp_id, syndic_id, technicien_id')
    .is('deleted_at', null)
    .or('statut.eq.en_suspens,statut.eq.nouvelle,statut.eq.rapport')
    .order('updated_at', { ascending: false });

  const interventions = (ivData ?? []) as Pick<Intervention, 'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'creneau_debut' | 'updated_at' | 'acp_id' | 'syndic_id' | 'technicien_id'
  >[];

  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  const orgIds = Array.from(new Set(interventions.map((i) => i.syndic_id).filter(Boolean) as string[]));

  const [acpRes, orgRes] = await Promise.all([
    acpIds.length
      ? supabase.from('acps').select('id, nom, adresse').in('id', acpIds)
      : Promise.resolve({ data: [] }),
    orgIds.length
      ? supabase.from('organisations').select('id, nom').in('id', orgIds)
      : Promise.resolve({ data: [] }),
  ]);
  const acpMap = new Map(((acpRes.data ?? []) as Pick<Acp, 'id' | 'nom' | 'adresse'>[]).map((a) => [a.id, a]));
  const orgMap = new Map(((orgRes.data ?? []) as Pick<Organisation, 'id' | 'nom'>[]).map((o) => [o.id, o.nom]));

  const items: AlertItem[] = interventions.map((iv) => {
    const acp = iv.acp_id ? acpMap.get(iv.acp_id) ?? null : null;
    return {
      ...iv,
      acp_nom: acp?.nom ?? null,
      acp_adresse: acp?.adresse ?? null,
      syndic_nom: iv.syndic_id ? orgMap.get(iv.syndic_id) ?? null : null,
    };
  });

  const enSuspens = items.filter((i) => i.statut === 'en_suspens');
  const nonAssignees = items.filter((i) => i.statut === 'nouvelle' && !i.technicien_id);
  const rapportsAEnvoyer = items.filter((i) => i.statut === 'rapport');

  const totalAlertes = enSuspens.length + nonAssignees.length + rapportsAEnvoyer.length;

  // Sections dans l'ordre métier d'origine ; à l'affichage, celles qui ont
  // des éléments passent devant, les vides sont repliées en lignes compactes.
  const sections = [
    {
      key: 'en-suspens',
      title: 'En suspens',
      subtitle: 'Dossiers bloqués nécessitant une action',
      icon: Pause,
      color: 'terra' as const,
      items: enSuspens,
    },
    {
      key: 'non-assignees',
      title: 'Nouvelles non assignées',
      subtitle: 'Demandes reçues sans technicien attribué',
      icon: Circle,
      color: 'amber' as const,
      items: nonAssignees,
    },
    {
      key: 'rapports',
      title: 'Rapports prêts à envoyer',
      subtitle: 'Rapports publiés en attente de transmission au syndic',
      icon: FileText,
      color: 'navy' as const,
      items: rapportsAEnvoyer,
    },
  ];
  const actives = sections.filter((s) => s.items.length > 0);
  const vides = sections.filter((s) => s.items.length === 0);

  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Alertes
          </h1>
          <div className="fx-small flex items-center gap-2 text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-terra)]"></span>
            {totalAlertes} alerte{totalAlertes > 1 ? 's' : ''} en attente
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {actives.map((s) => (
          <Section
            key={s.key}
            title={s.title}
            subtitle={s.subtitle}
            icon={s.icon}
            color={s.color}
            items={s.items}
          />
        ))}
        {vides.length > 0 && (
          <div className="space-y-2">
            {vides.map((s) => (
              <CollapsedSection key={s.key} icon={s.icon} title={s.title} tone={s.color} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Rendue uniquement quand items.length > 0 — l'état vide est porté par
// CollapsedSection dans la page.
function Section({
  title, subtitle, icon: Icon, color, items,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  color: 'terra' | 'amber' | 'navy';
  items: AlertItem[];
}) {
  // Light : pastille pâle + texte assorti.
  // Dark : fond solide + texte blanc, ratio AA garanti même sur fond sombre.
  const accentBg =
    color === 'terra'
      ? 'bg-terra-light border-terra-mid'
      : color === 'amber'
      ? 'bg-amber-light border-[var(--color-amber-foxo)]/30'
      : 'bg-navy-pale border-navy-light';
  const accentFg =
    color === 'terra'
      ? 'text-terra-ink'
      : color === 'amber'
      ? 'text-amber-ink'
      : 'text-navy';

  return (
    <section>
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${accentBg} mb-3`}>
        <Icon size={18} className={accentFg} aria-hidden />
        <div className="flex-1">
          <h2 className={`fx-h3 font-semibold ${accentFg}`}>{title}</h2>
          <p className="fx-small text-ink-mid">{subtitle}</p>
        </div>
        <span className={`fx-body font-semibold ${accentFg}`}>{items.length}</span>
      </div>

      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sand">
                {['Réf.', 'ACP', 'Type', 'Syndic', 'Créneau', 'Statut', 'Màj'].map((h) => (
                  <th key={h} className="fx-eyebrow px-3.5 py-2.5 text-left font-semibold text-ink-mid border-b border-sand-border whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((iv) => (
                <tr key={iv.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-3">
                    <Link href={`/admin?id=${iv.id}`} className="fx-label fx-ref font-semibold text-navy hover:underline">
                      {iv.ref ?? '—'}
                    </Link>
                  </td>
                  <td className="fx-body-dense px-3.5 py-3 font-semibold">{iv.acp_nom ?? '—'}</td>
                  <td className="fx-small px-3.5 py-3 text-ink-mid whitespace-nowrap">{iv.type ?? '—'}</td>
                  <td className="fx-body-dense px-3.5 py-3">{iv.syndic_nom ?? '—'}</td>
                  <td className="fx-small px-3.5 py-3 text-ink-mid tabular-nums whitespace-nowrap">{fmtDateTime(iv.creneau_debut)}</td>
                  <td className="px-3.5 py-3"><StatutBadge statut={iv.statut} /></td>
                  <td className="fx-small px-3.5 py-3 text-ink-mid tabular-nums">{relTime(iv.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>
    </section>
  );
}
