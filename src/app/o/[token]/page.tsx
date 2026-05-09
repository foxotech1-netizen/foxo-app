import { CheckCircle2, Hourglass, RefreshCw, X } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase/admin';
import { Logo } from '@/components/Logo';
import { DownloadButton } from '@/components/DownloadButton';
import { fmtDateTime } from '@/lib/format';
import type { Acp, Intervention, Occupant, Organisation } from '@/lib/types/database';
import { ConfirmActions } from './ConfirmActions';

export const dynamic = 'force-dynamic';

const STATUTS_ACCEPTANT_REPONSE = [
  'nouvelle', 'attente', 'confirmee',
];

const TOKEN_TTL_DAYS = 30;

export default async function OccupantPortal({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Public — pas de session. Service-role car RLS bloque les anonymes.
  // Le token (16 bytes hex = 128 bits) dans l'URL est l'authentification.
  const supabase = createAdminClient();

  const { data: occData } = await supabase
    .from('occupants')
    .select('*')
    .eq('confirmation_token', token)
    .maybeSingle();

  if (!occData) {
    return <NotFoundCard />;
  }
  const occupant = occData as Occupant;

  const sentAt = occupant.token_sent_at ? new Date(occupant.token_sent_at).getTime() : null;
  if (!sentAt || Date.now() - sentAt > TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return <NotFoundCard />;
  }

  const { data: ivData } = await supabase
    .from('interventions')
    .select('id, ref, statut, type, description, creneau_debut, acp_id, syndic_id, technicien_id')
    .eq('id', occupant.intervention_id)
    .maybeSingle();

  if (!ivData) return <NotFoundCard />;
  const iv = ivData as Pick<Intervention,
    'id' | 'ref' | 'statut' | 'type' | 'description' | 'creneau_debut' | 'acp_id' | 'syndic_id' | 'technicien_id'>;

  const [acpRes, syndicRes, techRes] = await Promise.all([
    iv.acp_id ? supabase.from('acps').select('id, nom, adresse, ville, code_postal').eq('id', iv.acp_id).maybeSingle() : Promise.resolve({ data: null }),
    iv.syndic_id ? supabase.from('organisations').select('id, nom').eq('id', iv.syndic_id).maybeSingle() : Promise.resolve({ data: null }),
    iv.technicien_id ? supabase.from('utilisateurs').select('id, prenom, nom').eq('id', iv.technicien_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const acp = acpRes.data as Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville' | 'code_postal'> | null;
  const syndic = syndicRes.data as Pick<Organisation, 'id' | 'nom'> | null;
  const tech = techRes.data as { id: string; prenom: string | null; nom: string | null } | null;

  const acceptsResponse = STATUTS_ACCEPTANT_REPONSE.includes(iv.statut);
  const currentConf = occupant.conf ?? 'en_attente';
  const rapportPublie = ['rapport', 'cloturee'].includes(iv.statut);

  return (
    <div className="min-h-screen bg-[var(--color-sand)] py-10 px-4 flex items-start justify-center">
      <div className="w-full max-w-[520px]">
        <div className="flex flex-col items-center mb-6">
          <Logo size={64} variant="noir" />
          <div className="font-sora text-[11px] text-[var(--color-ink-mid)] uppercase tracking-[0.12em] font-medium mt-3">
            Confirmation de présence
          </div>
        </div>

        <div
          className="bg-[var(--color-cream)] rounded-[10px] p-5 sm:p-7 space-y-5"
          style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
        >
          {/* Statut courant */}
          <StatusBanner
            conf={currentConf}
            acceptsResponse={acceptsResponse}
            proposedDebut={occupant.proposed_creneau_debut}
          />

          <header className="border-b border-[var(--color-sand-mid)] pb-4">
            <div className="font-sora text-[12px] text-[var(--color-navy)] font-semibold tracking-[0.01em]">
              Réf. {iv.ref ?? '—'}
            </div>
            <h1 className="font-sora text-[22px] font-semibold text-[var(--color-ink)] mt-1.5 tracking-tight">
              {acp?.nom ?? '—'}
            </h1>
            <div className="text-[13px] text-[var(--color-ink)] mt-1">
              {[acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ') || '—'}
            </div>
          </header>

          <Field label="Votre appartement">
            <span className="font-semibold text-[15px]">{occupant.appartement ?? '—'}</span>
            {occupant.nom && <span className="text-[var(--color-ink-mid)]"> · {occupant.nom}</span>}
          </Field>

          <Field label="Date d'intervention">
            {iv.creneau_debut ? (
              <span className="capitalize font-medium">{fmtDateTime(iv.creneau_debut, true)}</span>
            ) : (
              <span className="text-[var(--color-terra)] font-semibold">À confirmer</span>
            )}
          </Field>

          <Field label="Type d'intervention">
            {iv.type ?? 'Détection de fuite'}
          </Field>

          {tech && (
            <Field label="Technicien FoxO">
              {tech.prenom} {tech.nom}
            </Field>
          )}

          {syndic && (
            <Field label="Demandé par">
              {syndic.nom}
            </Field>
          )}

          {acceptsResponse ? (
            <ConfirmActions token={token} currentConf={currentConf} />
          ) : (
            <div className="bg-[var(--color-sand-mid)] border border-[var(--color-sand-border)] rounded-lg px-4 py-3 text-[13px] text-[var(--color-ink-mid)]">
              Cette intervention n&apos;accepte plus de modifications de présence.
            </div>
          )}

          {/* Documents */}
          <div className="pt-3 border-t border-[var(--color-sand-mid)]">
            <div className="font-sora text-[11px] text-[var(--color-ink-mid)] uppercase tracking-[0.12em] font-medium mb-2">
              Documents
            </div>
            {rapportPublie ? (
              <DownloadButton
                href={`/api/rapport/${iv.id}?occupant=${occupant.id}`}
                filename={`rapport-${iv.ref ?? iv.id}.pdf`}
                label="Télécharger le rapport"
              />
            ) : (
              <p className="text-[13px] text-[var(--color-ink-mid)]">
                Le rapport sera disponible après l&apos;intervention.
              </p>
            )}
          </div>

          <p className="text-[11px] text-[var(--color-ink-mid)] leading-relaxed pt-3 border-t border-[var(--color-sand-mid)]">
            Ce lien vous est strictement personnel. Pour toute question, contactez votre
            syndic{syndic?.nom ? ` (${syndic.nom})` : ''} ou{' '}
            <a href="mailto:info@foxo.be" className="text-[var(--color-navy)] font-semibold underline hover:no-underline">info@foxo.be</a>.
          </p>
        </div>

        <p className="text-center text-[11px] text-[var(--color-ink-mid)] mt-4">
          Fox Group SRL — Détection de fuites non destructive
        </p>
      </div>
    </div>
  );
}

function StatusBanner({
  conf,
  acceptsResponse,
  proposedDebut,
}: {
  conf: 'confirme' | 'en_attente' | 'decline';
  acceptsResponse: boolean;
  proposedDebut: string | null;
}) {
  if (conf === 'confirme') {
    return (
      <div className="bg-[var(--color-ok-light)] border border-[var(--color-ok-mid)] text-[var(--color-ok)] rounded-lg px-4 py-3 text-[14px] font-semibold">
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 size={16} /> Présence confirmée — merci !
        </span>
        {acceptsResponse && (
          <p className="text-[12px] font-normal mt-1 opacity-80">
            Vous pouvez modifier votre réponse ci-dessous.
          </p>
        )}
      </div>
    );
  }
  if (conf === 'decline') {
    return (
      <div className="bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] text-[var(--color-terra)] rounded-lg px-4 py-3 text-[14px] font-semibold">
        <span className="inline-flex items-center gap-2">
          <X size={16} /> Vous avez décliné cette intervention.
        </span>
        {acceptsResponse && (
          <p className="text-[12px] font-normal mt-1 opacity-80">
            Vous pouvez encore changer d&apos;avis ci-dessous.
          </p>
        )}
      </div>
    );
  }
  // conf === 'en_attente' : peut être un vrai pending OU une contre-proposition.
  if (proposedDebut) {
    return (
      <div className="bg-[var(--color-navy-pale)] border border-[var(--color-navy-light)] text-[var(--color-navy)] rounded-lg px-4 py-3 text-[14px] font-semibold">
        <span className="inline-flex items-center gap-2">
          <RefreshCw size={16} /> Vous avez proposé un autre créneau ({fmtDateTime(proposedDebut, true)}). Le syndic vous reviendra.
        </span>
        {acceptsResponse && (
          <p className="text-[12px] font-normal mt-1 opacity-80">
            Vous pouvez encore changer votre réponse ci-dessous.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg px-4 py-3 text-[14px] font-semibold inline-flex items-center gap-2">
      <Hourglass size={16} /> En attente de votre réponse
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-sora text-[11px] text-[var(--color-ink-mid)] uppercase tracking-[0.12em] font-medium mb-1">
        {label}
      </div>
      <div className="text-[14px] text-[var(--color-ink)]">{children}</div>
    </div>
  );
}

function NotFoundCard() {
  return (
    <div className="min-h-screen bg-[var(--color-sand)] py-10 px-4 flex items-start justify-center">
      <div className="w-full max-w-[440px] mt-12">
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} variant="noir" />
        </div>
        <div
          className="bg-[var(--color-cream)] rounded-[10px] p-7 text-center"
          style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
        >
          <h1 className="font-sora text-[20px] font-semibold text-[var(--color-ink)] mb-2 tracking-tight">Lien invalide</h1>
          <p className="text-[14px] text-[var(--color-ink-mid)] leading-relaxed">
            Ce lien de confirmation n&apos;est plus valide ou n&apos;existe pas.
            <br />
            Pour toute question, contactez{' '}
            <a href="mailto:info@foxo.be" className="text-[var(--color-navy)] font-semibold underline hover:no-underline">info@foxo.be</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
