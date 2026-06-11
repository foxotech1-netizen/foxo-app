import { notFound } from 'next/navigation';
import Link from 'next/link';
import { MapPin, MessageCircle, MessageSquare, Phone, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
import type { Acp, Intervention, Occupant, Organisation, Rapport } from '@/lib/types/database';
import { TimerPanel } from './TimerPanel';
import { PhotosPanel } from './PhotosPanel';
import { DocumentsPanel } from './DocumentsPanel';
import { ObservationsPanel } from './ObservationsPanel';
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
      <Link href="/tech" className="inline-flex items-center text-[14px] hover:underline font-medium text-[var(--accent-tech)] min-h-[44px]">
        ← Mes missions
      </Link>

      {/* En-tête */}
      <header
        className="bg-[var(--color-cream)] rounded-xl p-5"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="font-sora text-[12px] font-semibold tracking-[0.01em] text-[var(--accent-tech)]">{iv.ref ?? '—'}</span>
          {iv.priorite === 'urgente' && (
            <span className="text-[11px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-2.5 py-1 inline-flex items-center gap-1">
              <Zap size={11} />URGENT
            </span>
          )}
        </div>
        <h1 className="font-sora text-[22px] font-semibold tracking-tight text-[var(--color-ink)]">{acp?.nom ?? '—'}</h1>
        <div className="text-[13px] text-[var(--color-ink)] mt-1.5">
          {[acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ') || '—'}
        </div>
        {iv.adresse && (
          <div className="text-[13px] font-semibold mt-1.5 inline-flex items-center gap-1.5 text-[var(--accent-tech)]">
            <MapPin size={14} />{iv.adresse}
          </div>
        )}
        {iv.creneau_debut && (() => {
          const d = new Date(iv.creneau_debut);
          const time = fmtTime(iv.creneau_debut);
          const dateLabel = d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ_BRUSSELS });
          return (
            <div className="text-[12px] text-[var(--color-ink-mid)] mt-2.5 font-mono flex items-center gap-2">
              <span className="font-semibold text-[var(--accent-tech)]">{time}</span>
              <span>·</span>
              <span className="capitalize">{dateLabel}</span>
            </div>
          );
        })()}
      </header>

      {/* Problème déclaré */}
      <Block title="Problème déclaré">
        <strong className="text-[var(--color-ink)] text-[14px]">{iv.type ?? '—'}</strong>
        {iv.description && (
          <p className="text-[var(--color-ink)] mt-2 whitespace-pre-wrap text-[14px] leading-relaxed">{iv.description}</p>
        )}
      </Block>

      {/* Contact syndic */}
      {syndic && (
        <Block title="Demandeur">
          <div className="flex justify-between items-center gap-2">
            <div>
              <div className="font-semibold text-[var(--color-ink)] text-[14px]">{syndic.nom}</div>
              {syndic.telephone && (
                <div className="text-[12px] text-[var(--color-ink-mid)] font-mono mt-0.5">{syndic.telephone}</div>
              )}
            </div>
            {syndic.telephone && (
              <a
                href={`tel:${syndic.telephone}`}
                className="bg-[var(--color-navy)] text-[var(--color-cream)] px-4 py-2.5 rounded-md text-[13px] font-semibold hover:bg-[var(--color-navy-dark)] min-h-[44px] inline-flex items-center gap-1.5 transition-colors"
              >
                <Phone size={14} />Appeler
              </a>
            )}
          </div>
        </Block>
      )}

      {/* Occupants */}
      {occupants.length > 0 && (
        <Block title={`Occupants (${occupants.length})`}>
          <div className="divide-y divide-[var(--color-sand-mid)]">
            {occupants.map((o) => {
              const retard = o.telephone ? buildRetardLinks(o.telephone, iv) : null;
              return (
                <div key={o.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-[var(--color-ink)]">{o.nom ?? '—'}</div>
                      <div className="text-[12px] text-[var(--color-ink)] mt-0.5">
                        Apt. {o.appartement ?? '—'}
                        {o.telephone ? <> · <span className="font-mono">{o.telephone}</span></> : null}
                      </div>
                    </div>
                    {o.telephone && (
                      <a
                        href={`tel:${o.telephone}`}
                        className="bg-[var(--color-sand-mid)] text-[var(--accent-tech)] px-3 py-2.5 rounded-md text-[13px] font-semibold hover:bg-[var(--color-sand-border)] inline-flex items-center min-h-[44px] min-w-[44px] justify-center transition-colors"
                        aria-label="Appeler"
                      >
                        <Phone size={16} />
                      </a>
                    )}
                  </div>
                  {retard && (
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-[var(--color-ink-mid)] font-medium">Prévenir d&apos;un retard :</span>
                      <a
                        href={retard.smsHref}
                        className="bg-[var(--color-sand-mid)] text-[var(--accent-tech)] px-3 py-2 rounded-md text-[12px] font-semibold hover:bg-[var(--color-sand-border)] inline-flex items-center gap-1.5 min-h-[44px] transition-colors"
                        aria-label="Prévenir l'occupant d'un retard par SMS"
                      >
                        <MessageSquare size={14} />SMS
                      </a>
                      <a
                        href={retard.waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-[var(--color-sand-mid)] text-[var(--accent-tech)] px-3 py-2 rounded-md text-[12px] font-semibold hover:bg-[var(--color-sand-border)] inline-flex items-center gap-1.5 min-h-[44px] transition-colors"
                        aria-label="Prévenir l'occupant d'un retard par WhatsApp"
                      >
                        <MessageCircle size={14} />WhatsApp
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* Documents du dossier Drive (Mails V2 P2 U4) */}
      <DocumentsPanel interventionId={iv.id} />

      {/* Observations terrain */}
      <ObservationsPanel
        interventionId={iv.id}
        disabled={iv.statut === 'rapport' || iv.statut === 'cloturee'}
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
            statut: 'brouillon',
            valide_par: null,
            valide_at: null,
            transmis_at: null,
            transmis_a: null,
            docx_drive_url: null,
            docx_drive_file_id: null,
            pdf_drive_url: null,
            pdf_drive_file_id: null,
            genere_par_agent: true,
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
    <section
      className="bg-[var(--color-cream)] rounded-xl p-4"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
        <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">
          {title}
        </div>
      </div>
      {children}
    </section>
  );
}

function cleanDialNumber(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

function normalizeWaNumber(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = '32' + digits.slice(1);
  return digits;
}

function buildRetardMessage(iv: Intervention): string {
  let phrase = 'je suis le technicien en charge de votre rendez-vous';
  if (iv.ref) phrase += ` (réf. ${iv.ref})`;
  if (iv.creneau_debut) {
    const t = fmtTime(iv.creneau_debut);
    phrase += ` prévu à ${t}`;
  }
  return `Bonjour, ${phrase}. Je vais avoir un peu de retard et j’arriverai dès que possible. Merci de votre compréhension.`;
}

function buildRetardLinks(phone: string, iv: Intervention): { smsHref: string; waHref: string } {
  const enc = encodeURIComponent(buildRetardMessage(iv));
  return {
    smsHref: `sms:${cleanDialNumber(phone)}?&body=${enc}`,
    waHref: `https://wa.me/${normalizeWaNumber(phone)}?text=${enc}`,
  };
}
