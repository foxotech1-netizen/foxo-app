import { notFound } from 'next/navigation';
import { MessageCircle, MessageSquare, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
import type { Acp, Intervention, Occupant, Organisation, Rapport } from '@/lib/types/database';
import { InterventionShell } from './InterventionShell';
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

  // Données d'en-tête et d'actions rapides de la coquille — uniquement des
  // valeurs sérialisables dérivées des données DÉJÀ chargées ci-dessus.
  const occupantPrincipal = occupants.find((o) => o.telephone) ?? occupants[0] ?? null;
  const adresseAcp = [acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ');
  const retardPrincipal = occupantPrincipal?.telephone
    ? buildRetardLinks(occupantPrincipal.telephone, iv)
    : null;
  const creneau = iv.creneau_debut
    ? {
        time: fmtTime(iv.creneau_debut),
        dateLabel: new Date(iv.creneau_debut).toLocaleDateString('fr-BE', {
          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ_BRUSSELS,
        }),
      }
    : null;

  return (
    // data-tech-dark : écran nativement sombre — la feuille claire des
    // sections est gérée par InterventionShell, pas par .tech-main.
    <div data-tech-dark>
      <InterventionShell
        header={{
          ref: iv.ref,
          type: iv.type,
          statut: iv.statut,
          urgent: iv.priorite === 'urgente',
          acpNom: acp?.nom ?? null,
          adresse: adresseAcp || null,
          adresseComplement: iv.adresse ?? null,
          creneau,
          occupant: occupantPrincipal
            ? {
                nom: occupantPrincipal.nom,
                appartement: occupantPrincipal.appartement,
                telephone: occupantPrincipal.telephone,
              }
            : null,
        }}
        actions={{
          tel: occupantPrincipal?.telephone
            ? `tel:${cleanDialNumber(occupantPrincipal.telephone)}`
            : null,
          maps: adresseAcp
            ? `https://maps.google.com/?q=${encodeURIComponent(adresseAcp)}`
            : null,
          sms: retardPrincipal?.smsHref ?? null,
        }}
        photoCount={photos.length}
        timer={
          <TimerPanel
            interventionId={iv.id}
            startedAt={iv.started_at}
            endedAt={iv.ended_at}
            statut={iv.statut}
          />
        }
        sections={{
          photos: (
            <PhotosPanel
              interventionId={iv.id}
              initialPhotos={photos}
            />
          ),
          // Documents du dossier Drive — liste chargée côté client (latence Drive)
          documents: (
            <Block title="Documents du dossier">
              <DocumentsPanel interventionId={iv.id} />
            </Block>
          ),
          observations: (
            <ObservationsPanel
              interventionId={iv.id}
              disabled={iv.statut === 'rapport' || iv.statut === 'cloturee'}
            />
          ),
          rapport: <RapportSlot iv={iv} acp={acp} rapport={rapport} />,
          notes: (
            <NotesPanel
              interventionId={iv.id}
              initial={iv.notes_tech ?? null}
            />
          ),
          // Paiement sur place — QR EPC virement européen
          paiement: <PaiementPanel interventionId={iv.id} />,
        }}
        details={<DossierDetails iv={iv} syndic={syndic} occupants={occupants} />}
      />
    </div>
  );
}

// Slot rapport isolé pour garder l'appel principal lisible — props du
// panneau strictement identiques à l'ancien empilement.
function RapportSlot({
  iv,
  acp,
  rapport,
}: {
  iv: Intervention;
  acp: Acp | null;
  rapport: Rapport | null;
}) {
  return (
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
            date_rapport: null,
          }
        }
        canPublish={Boolean(iv.ended_at)}
        alreadyPublished={iv.statut === 'rapport' || iv.statut === 'cloturee'}
      />
  );
}

// "Infos dossier" du hub — reprend le contenu des anciens blocs Problème
// déclaré / Demandeur / Occupants (aucune donnée perdue par le passage au
// hub), adapté au verre sombre. Les liens tel/sms/WhatsApp par occupant
// sont conservés tels quels côté logique (mêmes helpers).
function DossierDetails({
  iv,
  syndic,
  occupants,
}: {
  iv: Intervention;
  syndic: Pick<Organisation, 'id' | 'nom' | 'telephone'> | null;
  occupants: Occupant[];
}) {
  return (
    <>
      <div>
        <DetailLabel>Problème déclaré</DetailLabel>
        <strong className="text-[14px]" style={{ color: 'var(--tech-text-1)' }}>
          {iv.type ?? '—'}
        </strong>
        {iv.description && (
          <p
            className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed"
            style={{ color: 'var(--tech-text-2)' }}
          >
            {iv.description}
          </p>
        )}
      </div>

      {syndic && (
        <div>
          <DetailLabel>Demandeur</DetailLabel>
          <div className="flex justify-between items-center gap-2">
            <div>
              <div className="font-semibold text-[14px]" style={{ color: 'var(--tech-text-1)' }}>
                {syndic.nom}
              </div>
              {syndic.telephone && (
                <div className="text-[12px] font-mono mt-0.5" style={{ color: 'var(--tech-text-2)' }}>
                  {syndic.telephone}
                </div>
              )}
            </div>
            {syndic.telephone && (
              <a
                href={`tel:${syndic.telephone}`}
                className="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold min-h-[44px] inline-flex items-center gap-1.5"
                style={{
                  background: 'var(--tech-glass-bright)',
                  border: '1px solid var(--tech-line)',
                  color: 'var(--tech-text-1)',
                }}
              >
                <Phone size={14} />Appeler
              </a>
            )}
          </div>
        </div>
      )}

      {occupants.length > 0 && (
        <div>
          <DetailLabel>Occupants ({occupants.length})</DetailLabel>
          <div className="divide-y" style={{ borderColor: 'var(--tech-line)' }}>
            {occupants.map((o) => {
              const retard = o.telephone ? buildRetardLinks(o.telephone, iv) : null;
              return (
                <div
                  key={o.id}
                  className="py-3 first:pt-0 last:pb-0"
                  style={{ borderColor: 'var(--tech-line)' }}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold" style={{ color: 'var(--tech-text-1)' }}>
                        {o.nom ?? '—'}
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: 'var(--tech-text-2)' }}>
                        Apt. {o.appartement ?? '—'}
                        {o.telephone ? <> · <span className="font-mono">{o.telephone}</span></> : null}
                      </div>
                    </div>
                    {o.telephone && (
                      <a
                        href={`tel:${o.telephone}`}
                        className="px-3 py-2.5 rounded-[10px] text-[13px] font-semibold inline-flex items-center min-h-[44px] min-w-[44px] justify-center"
                        style={{
                          background: 'var(--tech-glass-bright)',
                          border: '1px solid var(--tech-line)',
                          color: 'var(--accent-tech)',
                        }}
                        aria-label="Appeler"
                      >
                        <Phone size={16} />
                      </a>
                    )}
                  </div>
                  {retard && (
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--tech-text-2)' }}>
                        Prévenir d&apos;un retard :
                      </span>
                      <a
                        href={retard.smsHref}
                        className="px-3 py-2 rounded-[10px] text-[12px] font-semibold inline-flex items-center gap-1.5 min-h-[44px]"
                        style={{
                          background: 'var(--tech-glass-bright)',
                          border: '1px solid var(--tech-line)',
                          color: 'var(--accent-tech)',
                        }}
                        aria-label="Prévenir l'occupant d'un retard par SMS"
                      >
                        <MessageSquare size={14} />SMS
                      </a>
                      <a
                        href={retard.waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 rounded-[10px] text-[12px] font-semibold inline-flex items-center gap-1.5 min-h-[44px]"
                        style={{
                          background: 'var(--tech-glass-bright)',
                          border: '1px solid var(--tech-line)',
                          color: 'var(--accent-tech)',
                        }}
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
        </div>
      )}
    </>
  );
}

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-sora text-[11px] font-medium uppercase tracking-[0.12em] mb-2"
      style={{ color: 'var(--tech-text-2)' }}
    >
      {children}
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
