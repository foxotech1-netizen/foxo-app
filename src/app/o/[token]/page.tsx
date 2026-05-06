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
    <div className="min-h-screen bg-[var(--main-bg)] py-8 px-4 flex items-start justify-center">
      <div className="w-full max-w-[480px]">
        <div className="flex flex-col items-center mb-6">
          <Logo size={64} />
          <div className="text-[10px] text-[var(--text-3)] uppercase tracking-[.15em] font-semibold mt-2">
            Confirmation de présence
          </div>
        </div>

        <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--card-border)] p-5 sm:p-6 space-y-4">
          {/* Statut courant */}
          <StatusBanner
            conf={currentConf}
            acceptsResponse={acceptsResponse}
            proposedDebut={occupant.proposed_creneau_debut}
          />

          <header className="border-b border-[var(--card-border)] pb-4">
            <div className="text-[11px] text-[var(--text-3)] font-mono">
              Réf. {iv.ref ?? '—'}
            </div>
            <h1 className="text-lg font-extrabold text-[var(--text)] mt-1">
              {acp?.nom ?? '—'}
            </h1>
            <div className="text-xs text-[var(--text-2)] mt-0.5">
              {[acp?.adresse, acp?.code_postal, acp?.ville].filter(Boolean).join(', ') || '—'}
            </div>
          </header>

          <Field label="Votre appartement">
            <span className="font-bold text-base">{occupant.appartement ?? '—'}</span>
            {occupant.nom && <span className="text-[var(--text-2)]"> · {occupant.nom}</span>}
          </Field>

          <Field label="Date d'intervention">
            {iv.creneau_debut ? (
              <span className="capitalize">{fmtDateTime(iv.creneau_debut, true)}</span>
            ) : (
              <span className="text-terra">À confirmer</span>
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
            <div className="bg-[var(--card-border-2)] border border-[var(--card-border)] rounded-lg px-3.5 py-2.5 text-xs text-[var(--text-2)]">
              Cette intervention n&apos;accepte plus de modifications de présence.
            </div>
          )}

          {/* Documents */}
          <div className="pt-3 border-t border-[var(--card-border)]">
            <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider font-bold mb-2">
              Documents
            </div>
            {rapportPublie ? (
              <DownloadButton
                href={`/api/rapport/${iv.id}?occupant=${occupant.id}`}
                filename={`rapport-${iv.ref ?? iv.id}.pdf`}
                label="Télécharger le rapport"
              />
            ) : (
              <p className="text-[12px] text-[var(--text-2)]">
                Le rapport sera disponible après l&apos;intervention.
              </p>
            )}
          </div>

          <p className="text-[10px] text-[var(--text-3)] leading-relaxed pt-2 border-t border-[var(--card-border)]">
            Ce lien vous est strictement personnel. Pour toute question, contactez votre
            syndic{syndic?.nom ? ` (${syndic.nom})` : ''} ou{' '}
            <a href="mailto:info@foxo.be" className="text-[var(--accent)] underline">info@foxo.be</a>.
          </p>
        </div>

        <p className="text-center text-[10px] text-[var(--text-3)] mt-4">
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
      <div className="bg-ok-light border border-ok-mid text-ok rounded-lg px-3.5 py-2.5 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 size={14} /> Présence confirmée — merci !
        </span>
        {acceptsResponse && (
          <p className="text-[11px] font-normal mt-1 opacity-80">
            Vous pouvez modifier votre réponse ci-dessous.
          </p>
        )}
      </div>
    );
  }
  if (conf === 'decline') {
    return (
      <div className="bg-terra-light border border-terra-mid text-terra rounded-lg px-3.5 py-2.5 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <X size={14} /> Vous avez décliné cette intervention.
        </span>
        {acceptsResponse && (
          <p className="text-[11px] font-normal mt-1 opacity-80">
            Vous pouvez encore changer d&apos;avis ci-dessous.
          </p>
        )}
      </div>
    );
  }
  // conf === 'en_attente' : peut être un vrai pending OU une contre-proposition
  // (counter est stocké en attente côté DB, le syndic doit valider).
  if (proposedDebut) {
    return (
      <div className="bg-[var(--info-bg)] border border-[var(--info-fg)]/30 text-[var(--info-fg)] rounded-lg px-3.5 py-2.5 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw size={14} /> Vous avez proposé un autre créneau ({fmtDateTime(proposedDebut, true)}). Le syndic vous reviendra.
        </span>
        {acceptsResponse && (
          <p className="text-[11px] font-normal mt-1 opacity-80">
            Vous pouvez encore changer votre réponse ci-dessous.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg px-3.5 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5">
      <Hourglass size={14} /> En attente de votre réponse
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wider font-bold mb-0.5">
        {label}
      </div>
      <div className="text-[13px] text-[var(--text)]">{children}</div>
    </div>
  );
}

function NotFoundCard() {
  return (
    <div className="min-h-screen bg-[var(--main-bg)] py-8 px-4 flex items-start justify-center">
      <div className="w-full max-w-[420px] mt-12">
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} />
        </div>
        <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--card-border)] p-6 text-center">
          <h1 className="text-lg font-extrabold text-[var(--text)] mb-2">Lien invalide</h1>
          <p className="text-sm text-[var(--text-2)] leading-relaxed">
            Ce lien de confirmation n&apos;est plus valide ou n&apos;existe pas.
            <br />
            Pour toute question, contactez{' '}
            <a href="mailto:info@foxo.be" className="text-[var(--accent)] underline">info@foxo.be</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
