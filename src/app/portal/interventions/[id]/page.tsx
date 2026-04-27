import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { StatutBadge } from '@/components/StatutBadge';
import { DownloadButton } from '@/components/DownloadButton';
import { fmtDateTime, relTime } from '@/lib/format';
import type { Acp, Intervention, Occupant, Utilisateur } from '@/lib/types/database';

export const dynamic = 'force-dynamic';

const CONF_INFO: Record<NonNullable<Occupant['conf']>, { label: string; fg: string; bg: string }> = {
  confirme:   { label: 'Confirmé',  fg: '#1F6B45', bg: '#D4EDE2' },
  en_attente: { label: 'En attente', fg: '#B8830A', bg: '#FBF3E0' },
  decline:    { label: 'Décliné',   fg: '#C4622D', bg: '#F7EDE5' },
};

export default async function InterventionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getCurrentSyndic();
  if (!session?.org) notFound();
  const { org } = session;

  const supabase = await createClient();

  const { data: iv } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', id)
    .eq('syndic_id', org.id) // sécurité : on ne sert qu'une intervention du syndic connecté
    .maybeSingle();

  if (!iv) notFound();
  const intervention = iv as Intervention;

  const [acpRes, occRes, techRes] = await Promise.all([
    intervention.acp_id
      ? supabase.from('acps').select('*').eq('id', intervention.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('occupants').select('*').eq('intervention_id', intervention.id),
    intervention.technicien_id
      ? supabase.from('utilisateurs').select('id, prenom, nom').eq('id', intervention.technicien_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const acp: Acp | null = (acpRes.data as Acp | null) ?? null;
  const occupants: Occupant[] = (occRes.data as Occupant[] | null) ?? [];
  const tech: Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null =
    (techRes.data as Pick<Utilisateur, 'id' | 'prenom' | 'nom'> | null) ?? null;

  const confirmedCount = occupants.filter((o) => o.conf === 'confirme').length;

  const hasReport = ['rapport', 'cloturee'].includes(intervention.statut);

  return (
    <div className="space-y-5">
      <Link href="/portal/interventions" className="text-xs text-navy hover:underline">
        ← Retour à la liste
      </Link>

      <header className="bg-cream border border-sand-border rounded-2xl p-5">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="font-mono text-xs text-ink-muted">{intervention.ref ?? '—'}</span>
          {intervention.priorite === 'urgente' && (
            <span className="text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-2 py-0.5">
              ⚡ URGENT
            </span>
          )}
          <StatutBadge statut={intervention.statut} big />
        </div>
        <h1 className="text-xl font-extrabold text-ink">{acp?.nom ?? '—'}</h1>
        <div className="text-xs text-ink-mid mt-1">
          {[acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ') || '—'}
        </div>
        <div className="text-[11px] text-ink-muted mt-2 font-mono">
          Mise à jour {relTime(intervention.updated_at)}
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        <Block title="Problème">
          <strong className="block">{intervention.type ?? '—'}</strong>
          {intervention.description && (
            <p className="text-ink-mid mt-1.5 whitespace-pre-wrap">{intervention.description}</p>
          )}
        </Block>

        <Block title="Créneau">
          {intervention.creneau_debut ? (
            <div className="font-semibold capitalize">{fmtDateTime(intervention.creneau_debut, true)}</div>
          ) : (
            <span className="text-terra">Non confirmé</span>
          )}
        </Block>

        <Block title="Technicien">
          {tech ? (
            <span className="font-semibold">
              {tech.prenom} {tech.nom}
            </span>
          ) : (
            <span className="text-ink-muted">Non encore assigné</span>
          )}
        </Block>

        <Block title="Adresse précise">
          {intervention.adresse ?? <span className="text-ink-muted">—</span>}
        </Block>
      </div>

      {intervention.statut === 'en_suspens' && intervention.suspens_motif && (
        <div className="bg-terra-light border border-terra-mid rounded-2xl p-4">
          <div className="text-[10px] font-bold text-terra uppercase tracking-wider mb-2">
            Motif de suspension
          </div>
          <p className="text-[13px] text-terra">{intervention.suspens_motif}</p>
        </div>
      )}

      {/* Occupants */}
      <section>
        <h2 className="text-sm font-bold text-ink mb-3">
          Occupants — {confirmedCount}/{occupants.length} confirmé(s)
        </h2>
        {occupants.length === 0 ? (
          <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-4">
            Aucun occupant enregistré.
          </p>
        ) : (
          <div className="bg-cream rounded-xl border border-sand-border divide-y divide-sand-mid">
            {occupants.map((o) => {
              const ci = o.conf ? CONF_INFO[o.conf] : CONF_INFO.en_attente;
              return (
                <div key={o.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{o.nom ?? '—'}</div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      Apt. {o.appartement ?? '—'}
                      {o.email ? <> · <span className="font-mono">{o.email}</span></> : null}
                      {o.telephone ? <> · {o.telephone}</> : null}
                    </div>
                  </div>
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
                    style={{ color: ci.fg, background: ci.bg }}
                  >
                    {ci.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Documents */}
      <section>
        <h2 className="text-sm font-bold text-ink mb-3">Documents</h2>
        <div className="bg-cream border border-sand-border rounded-xl px-4 py-4 text-[13px] space-y-3">
          {hasReport ? (
            <DownloadButton
              href={`/api/rapport/${intervention.id}`}
              filename={`rapport-${intervention.ref ?? intervention.id}.pdf`}
              label="Télécharger le rapport PDF"
            />
          ) : (
            <p className="text-ink-muted text-[12px]">Rapport pas encore publié.</p>
          )}

          {intervention.statut === 'cloturee' && (
            <DownloadButton
              href={`/api/facture/${intervention.id}`}
              filename={`facture-${intervention.ref ?? intervention.id}.pdf`}
              label="Télécharger la facture"
            />
          )}
        </div>
      </section>

      {/* Facturation (récap) */}
      {(intervention.nom_facturation || intervention.email_facturation || intervention.bce_facturation || intervention.ref_bon_commande) && (
        <section>
          <h2 className="text-sm font-bold text-ink mb-3">Facturation</h2>
          <div className="bg-cream border border-sand-border rounded-xl p-4 text-[13px] grid grid-cols-1 sm:grid-cols-2 gap-2">
            {intervention.nom_facturation && (
              <div><span className="text-ink-muted text-[11px]">Destinataire</span><br />{intervention.nom_facturation}</div>
            )}
            {intervention.email_facturation && (
              <div><span className="text-ink-muted text-[11px]">Email</span><br /><span className="font-mono text-xs">{intervention.email_facturation}</span></div>
            )}
            {intervention.bce_facturation && (
              <div><span className="text-ink-muted text-[11px]">BCE</span><br /><span className="font-mono text-xs">{intervention.bce_facturation}</span></div>
            )}
            {intervention.ref_bon_commande && (
              <div><span className="text-ink-muted text-[11px]">Bon de commande</span><br /><span className="font-mono text-xs">{intervention.ref_bon_commande}</span></div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-cream rounded-xl px-4 py-3 border border-sand-border">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">
        {title}
      </div>
      <div className="text-[13px] text-ink leading-relaxed">{children}</div>
    </div>
  );
}
