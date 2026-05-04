import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { fmtDateTime } from '@/lib/format';
import type { Acp, Intervention, Occupant, Organisation, Rapport } from '@/lib/types/database';
import { TimerPanel } from './TimerPanel';
import { PhotosPanel } from './PhotosPanel';
import { RapportPanel } from './RapportPanel';
import { NotesPanel } from './NotesPanel';
import { PaiementPanel } from './PaiementPanel';
import { getPhotoSignedUrls } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function TechInterventionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  // Récup user app
  const { data: u } = await supabase
    .from('utilisateurs')
    .select('id')
    .eq('email', (user.email ?? '').toLowerCase())
    .maybeSingle();
  if (!u) notFound();

  // Intervention assignée à ce tech uniquement
  const { data: ivData } = await supabase
    .from('interventions')
    .select('*')
    .eq('id', id)
    .eq('technicien_id', u.id)
    .maybeSingle();
  if (!ivData) notFound();
  const iv = ivData as Intervention;

  const [acpRes, syndicRes, occRes, rapRes] = await Promise.all([
    iv.acp_id
      ? supabase.from('acps').select('*').eq('id', iv.acp_id).maybeSingle()
      : Promise.resolve({ data: null }),
    iv.syndic_id
      ? supabase.from('organisations').select('id, nom, telephone').eq('id', iv.syndic_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('occupants').select('*').eq('intervention_id', iv.id),
    supabase.from('rapports').select('*').eq('intervention_id', iv.id).maybeSingle(),
  ]);

  const acp = (acpRes.data as Acp | null) ?? null;
  const syndic = syndicRes.data as Pick<Organisation, 'id' | 'nom' | 'telephone'> | null;
  const occupants = (occRes.data as Occupant[] | null) ?? [];
  const rapport = (rapRes.data as Rapport | null) ?? null;

  const photosRes = await getPhotoSignedUrls(iv.id);
  const photos = photosRes.ok ? (photosRes.data ?? []) : [];

  return (
    <div className="space-y-4">
      <Link href="/tech" className="text-xs text-navy hover:underline font-semibold">
        ← Mes missions
      </Link>

      {/* En-tête */}
      <header className="bg-cream border border-sand-border rounded-2xl p-4">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          <span className="font-mono text-[11px] text-ink-muted">{iv.ref ?? '—'}</span>
          {iv.priorite === 'urgente' && (
            <span className="text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-1.5 py-0.5">
              ⚡ URGENT
            </span>
          )}
        </div>
        <h1 className="text-lg font-extrabold text-ink">{acp?.nom ?? '—'}</h1>
        <div className="text-xs text-ink-mid mt-1">
          {[acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ') || '—'}
        </div>
        {iv.adresse && (
          <div className="text-xs text-navy font-semibold mt-1">📍 {iv.adresse}</div>
        )}
        {iv.creneau_debut && (
          <div className="text-[11px] text-ink-muted mt-2 font-mono capitalize">
            {fmtDateTime(iv.creneau_debut, true)}
          </div>
        )}
      </header>

      {/* Problème déclaré */}
      <Block title="Problème déclaré">
        <strong className="text-ink">{iv.type ?? '—'}</strong>
        {iv.description && (
          <p className="text-ink-mid mt-1.5 whitespace-pre-wrap text-[13px]">{iv.description}</p>
        )}
      </Block>

      {/* Contact syndic */}
      {syndic && (
        <Block title="Demandeur">
          <div className="flex justify-between items-center gap-2">
            <div>
              <div className="font-semibold text-ink text-[13px]">{syndic.nom}</div>
              {syndic.telephone && (
                <div className="text-[11px] text-ink-mid font-mono">{syndic.telephone}</div>
              )}
            </div>
            {syndic.telephone && (
              <a
                href={`tel:${syndic.telephone}`}
                className="bg-navy text-white px-3 py-1.5 rounded-md text-[11px] font-bold hover:bg-navy-mid"
              >
                Appeler
              </a>
            )}
          </div>
        </Block>
      )}

      {/* Occupants */}
      {occupants.length > 0 && (
        <Block title={`Occupants (${occupants.length})`}>
          <div className="divide-y divide-sand-mid">
            {occupants.map((o) => (
              <div key={o.id} className="py-2 first:pt-0 last:pb-0 flex justify-between items-center gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-ink">{o.nom ?? '—'}</div>
                  <div className="text-[11px] text-ink-mid">
                    Apt. {o.appartement ?? '—'}
                    {o.telephone ? <> · <span className="font-mono">{o.telephone}</span></> : null}
                  </div>
                </div>
                {o.telephone && (
                  <a
                    href={`tel:${o.telephone}`}
                    className="bg-sand-mid text-navy px-2.5 py-1 rounded-md text-[11px] font-bold hover:bg-sand-border"
                  >
                    📞
                  </a>
                )}
              </div>
            ))}
          </div>
        </Block>
      )}

      {/* Timer */}
      <TimerPanel
        interventionId={iv.id}
        startedAt={iv.started_at}
        endedAt={iv.ended_at}
        statut={iv.statut}
      />

      {/* Photos */}
      <PhotosPanel
        interventionId={iv.id}
        initialPhotos={photos}
      />

      {/* Rapport */}
      <RapportPanel
        interventionId={iv.id}
        interventionRef={iv.ref}
        acpNom={acp?.nom ?? null}
        initial={
          rapport ?? {
            intervention_id: iv.id,
            degats: '',
            inspection: '',
            conclusion: '',
            recommandations: '',
            updated_at: '',
          }
        }
        canPublish={Boolean(iv.ended_at)}
        alreadyPublished={iv.statut === 'rapport' || iv.statut === 'cloturee'}
      />

      {/* Notes internes du technicien */}
      <NotesPanel
        interventionId={iv.id}
        initial={iv.notes_tech ?? null}
      />

      {/* Paiement sur place — QR EPC virement européen */}
      <PaiementPanel interventionId={iv.id} />
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest mb-2">
        {title}
      </div>
      {children}
    </section>
  );
}
