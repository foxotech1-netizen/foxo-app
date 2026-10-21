import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { TYPE_CLIENT_LABEL, type Client, type Utilisateur } from '@/lib/types/database';
import { ClientForm } from '../ClientForm';
import { getClient360, type Client360 } from './client360';
import { InterventionsSection, OccupantsSection } from './Client360Sections';
import { JournalPanel } from '@/components/admin/JournalPanel';
import { buildRdvInitial } from './rdv-initial';
import { NouveauRdvButton } from './NouveauRdvButton';
import { NotesAppelSection } from './NotesAppelSection';
import { ResumeIASection } from './ResumeIASection';

export const dynamic = 'force-dynamic';

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // L'id recu peut etre un id de CLIENT ou un id d'ACP : le bouton « Fiche »
  // d'une ACP (drawer syndic + recap destinataires) passe l'id de l'ACP.
  // Resolution : d'abord par id de client, puis en repli par acp_id — chaque
  // ACP a un client miroir type='acp' lie via clients.acp_id (migration
  // 2026-05-30_sync_acps_clients).
  const byId = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
  const byAcp = byId.data
    ? null
    : await supabase.from('clients').select('*').eq('acp_id', id).limit(1).maybeSingle();
  const clientRow = byId.data ?? byAcp?.data ?? null;
  if (!clientRow) notFound();
  const client = clientRow as Client;

  // Fiche 360° (Mode Appel phase 2) — best-effort : si le chargeur échoue,
  // la fiche d'édition reste utilisable et un bandeau le signale.
  // Techniciens (même requête que /admin/interventions) pour le modal RDV.
  let c360: Client360 | null = null;
  let techs: Utilisateur[] = [];
  try {
    const [c360Res, techsRes] = await Promise.all([
      getClient360({ id: client.id, acp_id: client.acp_id, type: client.type }),
      supabase
        .from('utilisateurs')
        .select('id,prenom,nom,email,couleur,role,actif,organisation_id,telephone,last_seen_at,created_at')
        .eq('role', 'technicien')
        .order('prenom', { ascending: true }),
    ]);
    c360 = c360Res;
    techs = (techsRes.data as Utilisateur[] | null) ?? [];
  } catch (e) {
    console.error('[clients/[id]] getClient360:', e);
  }
  const factures = c360?.factures.slice(0, 50) ?? [];
  const dernierDossier = c360?.interventions[0] ?? null;

  // Pré-remplissage « Nouveau RDV » (Mode Appel phase 3) — best-effort aussi.
  let rdvInitial = null;
  try {
    rdvInitial = await buildRdvInitial(client, c360?.occupants ?? []);
  } catch (e) {
    console.error('[clients/[id]] buildRdvInitial:', e);
  }

  return (
    <>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            {[client.prenom, client.nom].filter(Boolean).join(' ')}
          </h1>
          <div className="fx-small flex items-center gap-2 text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {TYPE_CLIENT_LABEL[client.type]} · {c360 ? `${c360.interventions.length} intervention${c360.interventions.length > 1 ? 's' : ''} · ` : ''}{factures.length} facture{factures.length > 1 ? 's' : ''} liée{factures.length > 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {rdvInitial && <NouveauRdvButton techs={techs} initial={rdvInitial} />}
          <Link
            href="/admin/clients"
            className="fx-meta text-[var(--color-ink-mid)] hover:text-[var(--color-navy)]"
          >
            ← Retour
          </Link>
        </div>
      </div>

      <div className="space-y-6">
        {/* ── Bandeau Situation (résumé mécanique) ── */}
        {c360 === null ? (
          <div className="fx-label px-4 py-2.5 bg-amber-light border border-[var(--color-amber-foxo)]/30 text-amber-ink rounded-lg font-semibold">
            Historique 360° indisponible pour le moment — la fiche reste modifiable.
          </div>
        ) : c360.resume ? (
          <div className="bg-cream border border-sand-border rounded-modal px-4 py-3 flex flex-wrap items-center gap-3">
            <span className="fx-eyebrow font-semibold text-ink-mid shrink-0">
              Situation
            </span>
            <p className="fx-body text-ink flex-1 min-w-[200px]">{c360.resume}</p>
            {c360.impayes.count > 0 && (
              <span className="fx-pill inline-flex items-center gap-1.5 bg-terra-light border border-terra-mid text-terra rounded-full px-3 py-1 font-semibold whitespace-nowrap">
                <AlertTriangle size={12} /> Impayé : {c360.impayes.max_jours} j
              </span>
            )}
          </div>
        ) : (
          <div className="fx-meta bg-cream border border-sand-border rounded-modal px-4 py-3 text-ink-mid italic">
            Aucun historique d&apos;intervention.
          </div>
        )}

        {/* ── Résumé IA (Mode Appel phase 5) — complète le bandeau Situation
              mécanique ci-dessus, génération au clic uniquement ── */}
        <ResumeIASection
          clientId={client.id}
          resumeInitial={client.resume_ia ?? null}
          genereLe={client.resume_ia_genere_le ?? null}
        />

        {/* ── Notes d'appel (Mode Appel phase 4) — l'outil principal au
              téléphone, placé haut, avant la fiche d'édition ── */}
        <NotesAppelSection
          clientId={client.id}
          dossiers={(c360?.interventions ?? []).map((iv) => ({
            id: iv.id,
            ref: iv.ref,
            date: iv.date_effective,
          }))}
        />

        <ClientForm initial={client} redirectAfter={`/admin/clients/${client.id}`} />

        {/* ── Interventions du client ── */}
        {c360 && <InterventionsSection items={c360.interventions} />}

        {/* ── Occupants connus (dédoublonnés, dossier le plus récent) ── */}
        {c360 && <OccupantsSection items={c360.occupants} />}

        {/* ── Historique des factures (échéance + retard) ── */}
        {c360 && (
        <section className="max-w-[760px]">
          <h2 className="fx-th font-medium text-ink-mid mb-3">
            Historique des factures
          </h2>
          {factures.length === 0 ? (
            <div className="fx-body bg-cream border border-sand-border rounded-modal p-6 text-center text-ink-mid">
              Aucune facture pour ce client.
            </div>
          ) : (
            <div className="bg-cream rounded-modal border border-sand-border overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-sand">
                    {['N°', 'Émission', 'Échéance', 'Montant TTC', 'Statut'].map((h) => (
                      <th key={h} className="fx-eyebrow px-3.5 py-2.5 text-left font-semibold text-ink-mid border-b border-sand-border">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {factures.map((f) => (
                    <tr key={f.id} className="border-b border-sand-mid hover:bg-sand-hover">
                      <td className="px-3.5 py-2.5">
                        <Link
                          href={`/admin/facturation/${f.id}`}
                          className="fx-label fx-ref font-semibold text-navy hover:underline"
                        >
                          {f.numero}
                        </Link>
                      </td>
                      <td className="fx-small px-3.5 py-2.5 text-ink-mid tabular-nums">
                        {fmtDate(f.date_emission)}
                      </td>
                      <td className="fx-small px-3.5 py-2.5 text-ink-mid tabular-nums whitespace-nowrap">
                        {fmtDate(f.date_echeance)}
                        {f.en_retard && (
                          <span className="fx-badge ml-1.5 inline-flex items-center bg-terra-light border border-terra-mid text-terra rounded-full px-2 py-0.5 font-semibold">
                            En retard ({f.jours_retard} j)
                          </span>
                        )}
                      </td>
                      <td className="fx-body-dense px-3.5 py-2.5 tabular-nums font-semibold">
                        {fmtMoney(f.montant_ttc)}
                      </td>
                      <td className="fx-small px-3.5 py-2.5 capitalize">
                        {f.statut}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        )}

        {/* ── Chronologie du dernier dossier (JournalPanel mono-intervention,
              assumé pour cette phase) ── */}
        {dernierDossier && (
          <section className="max-w-[760px]">
            <h2 className="fx-th font-medium text-ink-mid mb-3">
              Chronologie du dernier dossier ({dernierDossier.ref ?? '—'})
            </h2>
            <JournalPanel interventionId={dernierDossier.id} />
          </section>
        )}
      </div>
    </>
  );
}
