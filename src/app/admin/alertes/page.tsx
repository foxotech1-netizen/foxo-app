import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { StatutBadge } from '@/components/StatutBadge';
import { fmtDateTime, relTime } from '@/lib/format';
import type { Acp, Intervention, Organisation } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

type AlertItem = Pick<
  Intervention,
  'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'creneau_debut' | 'updated_at' | 'acp_id' | 'syndic_id' | 'technicien_id'
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
    .or('statut.eq.en_suspens,statut.eq.nouvelle,statut.eq.rapport')
    .order('updated_at', { ascending: false });

  const interventions = (ivData ?? []) as Pick<Intervention,
    'id' | 'ref' | 'statut' | 'priorite' | 'type' | 'creneau_debut' | 'updated_at' | 'acp_id' | 'syndic_id' | 'technicien_id'
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

  return (
    <>
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Alertes</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {totalAlertes} alerte(s) en attente de traitement
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
        <Section
          title="En suspens"
          subtitle="Dossiers bloqués nécessitant une action"
          icon="⏸"
          color="terra"
          items={enSuspens}
          empty="Aucun dossier en suspens."
        />
        <Section
          title="Nouvelles non assignées"
          subtitle="Demandes reçues sans technicien attribué"
          icon="◉"
          color="amber"
          items={nonAssignees}
          empty="Toutes les nouvelles demandes ont un technicien."
        />
        <Section
          title="Rapports prêts à envoyer"
          subtitle="Rapports publiés en attente de transmission au syndic"
          icon="📄"
          color="navy"
          items={rapportsAEnvoyer}
          empty="Aucun rapport en attente."
        />
      </div>
    </>
  );
}

function Section({
  title, subtitle, icon, color, items, empty,
}: {
  title: string;
  subtitle: string;
  icon: string;
  color: 'terra' | 'amber' | 'navy';
  items: AlertItem[];
  empty: string;
}) {
  // Light : pastille pâle + texte assorti.
  // Dark : fond solide + texte blanc, ratio AA garanti même sur fond sombre.
  const accentBg =
    color === 'terra'
      ? 'bg-terra-light border-terra-mid dark:bg-[#C4622D] dark:border-[#D87A45]'
      : color === 'amber'
      ? 'bg-amber-light border-[#E8C896] dark:bg-[#A17244] dark:border-[#C4904F]'
      : 'bg-navy-pale border-navy-light dark:bg-[#1B3A6B] dark:border-[#2A5298]';
  const accentFg =
    color === 'terra'
      ? 'text-terra dark:text-white'
      : color === 'amber'
      ? 'text-[#8A5A1A] dark:text-white'
      : 'text-navy dark:text-white';

  return (
    <section>
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${accentBg} mb-3`}>
        <span className="text-xl leading-none">{icon}</span>
        <div className="flex-1">
          <h2 className={`text-sm font-bold ${accentFg} dark:text-[#F0ECE4]`}>{title}</h2>
          <p className="text-[11px] text-ink-mid dark:text-[#C8C2B8]">{subtitle}</p>
        </div>
        <span className={`text-sm font-extrabold ${accentFg} dark:text-white`}>{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-4 text-center">
          {empty}
        </p>
      ) : (
        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-sand">
                {['Réf.', 'ACP', 'Type', 'Syndic', 'Créneau', 'Statut', 'Màj'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((iv) => (
                <tr key={iv.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-3">
                    <Link href={`/admin?id=${iv.id}`} className="font-mono text-xs font-semibold text-navy hover:underline">
                      {iv.ref ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[13px] font-bold">{iv.acp_nom ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[11px] text-ink-mid whitespace-nowrap">{iv.type ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[12px]">{iv.syndic_nom ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">{fmtDateTime(iv.creneau_debut)}</td>
                  <td className="px-3.5 py-3"><StatutBadge statut={iv.statut} /></td>
                  <td className="px-3.5 py-3 text-[10px] text-ink-muted font-mono">{relTime(iv.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
