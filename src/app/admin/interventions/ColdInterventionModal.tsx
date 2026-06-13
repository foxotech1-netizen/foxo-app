'use client';

// Modal de création d'intervention « à froid » (page /admin/interventions).
// Câblé à l'action serveur createInterventionCold (sans planning/agenda/notif).
//
// RÉUTILISE (sans les modifier) :
//   - ModalShell / ModalFooter         (../planning/CreateInterventionModal)
//   - searchAcps / searchOrganisations (../planning/actions — autocompletes)
//   - types demandeur CreateFromSlot*  (../planning/actions)
//   - ALLOWED_TYPES_INTERVENTION       (@/lib/mails/intervention-types — même
//                                        source que le select type du Planning)
//
// Hors périmètre (le backend tolère leur absence) : occupants, override
// facturation. Spécifique « cold » : statut au choix, date prévue optionnelle,
// technicien optionnel.

import { useEffect, useState, useTransition } from 'react';
import { Building2, User, X } from 'lucide-react';
import { ModalShell, ModalFooter } from '../planning/CreateInterventionModal';
import { searchAcps, searchOrganisations } from '../planning/actions';
import { createInterventionCold } from './actions';
import { ALLOWED_TYPES_INTERVENTION } from '@/lib/mails/intervention-types';
import type {
  Acp,
  Organisation,
  Utilisateur,
  TypeIntervention,
  StatutIntervention,
  PrioriteIntervention,
} from '@/lib/types/database';

const STATUTS: { value: StatutIntervention; label: string }[] = [
  { value: 'nouvelle', label: 'Nouvelle' },
  { value: 'attente', label: 'En attente' },
  { value: 'confirmee', label: 'Confirmée' },
  { value: 'realisee', label: 'Réalisée' },
  { value: 'rapport', label: 'Rapport' },
  { value: 'cloturee', label: 'Clôturée' },
];

const INPUT_CLASS =
  'w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid';

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-semibold text-ink-mid block mb-1.5">{children}</label>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2">{title}</div>
      {children}
    </section>
  );
}

export function ColdInterventionModal({
  techs,
  onClose,
  onCreated,
}: {
  techs: Utilisateur[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [demandeurType, setDemandeurType] = useState<'syndic' | 'particulier'>('syndic');

  // Champs communs / spécifiques cold
  const [ref, setRef] = useState('');
  const [statut, setStatut] = useState<StatutIntervention>('nouvelle');
  const [type, setType] = useState<TypeIntervention | ''>('');
  const [description, setDescription] = useState('');
  const [priorite, setPriorite] = useState<PrioriteIntervention>('normale');
  const [datePrevue, setDatePrevue] = useState('');         // datetime-local → creneau_debut
  const [technicienId, setTechnicienId] = useState('');     // '' = aucun

  // Syndic — autocompletes
  const [acpQuery, setAcpQuery] = useState('');
  const [acpResults, setAcpResults] = useState<Acp[]>([]);
  const [selectedAcp, setSelectedAcp] = useState<Acp | null>(null);
  const [orgQuery, setOrgQuery] = useState('');
  const [orgResults, setOrgResults] = useState<Organisation[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organisation | null>(null);
  // Adresse d'intervention (optionnel — mode syndic uniquement ; en
  // particulier l'adresse est dérivée du lieu côté action).
  const [adresse, setAdresse] = useState('');

  // Particulier — mandant
  const [pPrenom, setPPrenom] = useState('');
  const [pNom, setPNom] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pTel, setPTel] = useState('');
  const [pRue, setPRue] = useState('');
  const [pCp, setPCp] = useState('');
  const [pVille, setPVille] = useState('');
  const [pBce, setPBce] = useState('');
  // Lieu intervention
  const [pLieuMeme, setPLieuMeme] = useState(true);
  const [pLieuRue, setPLieuRue] = useState('');
  const [pLieuCp, setPLieuCp] = useState('');
  const [pLieuVille, setPLieuVille] = useState('');
  // Contact sur place
  const [pContactActif, setPContactActif] = useState(false);
  const [pContactPrenom, setPContactPrenom] = useState('');
  const [pContactNom, setPContactNom] = useState('');
  const [pContactTel, setPContactTel] = useState('');
  const [pContactEmail, setPContactEmail] = useState('');
  const [pContactInstr, setPContactInstr] = useState('');

  // Recherche ACP debounce (même pattern que le Planning ; tous les setState
  // vivent dans le callback du timer pour rester hors du corps de l'effet).
  useEffect(() => {
    if (selectedAcp || demandeurType !== 'syndic') return;
    const q = acpQuery.trim();
    const t = setTimeout(async () => {
      if (q.length < 2) { setAcpResults([]); return; }
      const res = await searchAcps(q);
      if (res.ok) setAcpResults(res.data ?? []);
    }, 280);
    return () => clearTimeout(t);
  }, [acpQuery, selectedAcp, demandeurType]);

  // Recherche org debounce (même pattern que le Planning, non filtré par type)
  useEffect(() => {
    if (selectedOrg || demandeurType !== 'syndic') return;
    const q = orgQuery.trim();
    const t = setTimeout(async () => {
      if (q.length < 2) { setOrgResults([]); return; }
      const res = await searchOrganisations(q);
      if (res.ok) setOrgResults(res.data ?? []);
    }, 280);
    return () => clearTimeout(t);
  }, [orgQuery, selectedOrg, demandeurType]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pEmail.trim());
  const canSubmit =
    demandeurType === 'syndic'
      ? Boolean(selectedAcp && selectedOrg)
      : Boolean(
          emailValid && pPrenom.trim() && pNom.trim() &&
          pRue.trim() && pCp.trim() && pVille.trim() &&
          (pLieuMeme || (pLieuRue.trim() && pLieuCp.trim() && pLieuVille.trim())),
        );

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const res = await createInterventionCold({
        ref: ref.trim() || undefined,
        statut,
        type: type || undefined,
        description: description.trim() || undefined,
        priorite,
        creneau_debut: datePrevue ? new Date(datePrevue).toISOString() : null,
        technicien_id: technicienId || null,
        adresse: adresse.trim() || undefined,
        demandeur:
          demandeurType === 'syndic'
            ? {
                demandeur_type: 'syndic',
                acp_id: selectedAcp!.id,
                syndic_id: selectedOrg!.id,
                occupants: [],
              }
            : {
                demandeur_type: 'particulier',
                mandant: {
                  prenom: pPrenom.trim(),
                  nom: pNom.trim(),
                  email: pEmail.trim().toLowerCase(),
                  tel: pTel.trim(),
                  adresse_facturation: {
                    rue: pRue.trim(),
                    code_postal: pCp.trim(),
                    ville: pVille.trim(),
                  },
                  ...(pBce.trim() ? { bce: pBce.trim() } : {}),
                },
                lieu: {
                  meme_que_mandant: pLieuMeme,
                  rue: pLieuMeme ? pRue.trim() : pLieuRue.trim(),
                  cp: pLieuMeme ? pCp.trim() : pLieuCp.trim(),
                  ville: pLieuMeme ? pVille.trim() : pLieuVille.trim(),
                },
                contact_sur_place: {
                  actif: pContactActif,
                  ...(pContactActif
                    ? {
                        prenom: pContactPrenom.trim(),
                        nom: pContactNom.trim(),
                        tel: pContactTel.trim(),
                        ...(pContactEmail.trim() ? { email: pContactEmail.trim().toLowerCase() } : {}),
                        ...(pContactInstr.trim() ? { instructions: pContactInstr.trim() } : {}),
                      }
                    : {}),
                },
              },
      });
      if (!res.ok) { setError(res.error); return; }
      onCreated();
      onClose();
    });
  }

  return (
    <ModalShell onClose={onClose} title="Créer une intervention" subtitle="Création directe — sans planning, agenda ni notification">
      <div className="space-y-4">
        {/* Toggle demandeur */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDemandeurType('syndic')}
            className={
              'px-3 py-2 rounded-lg text-[13px] font-bold border-2 transition-colors inline-flex items-center justify-center gap-1.5 ' +
              (demandeurType === 'syndic'
                ? 'bg-navy text-white border-navy'
                : 'bg-white text-ink border-sand-border hover:border-navy-mid')
            }
          >
            <Building2 size={14} /> Syndic
          </button>
          <button
            type="button"
            onClick={() => setDemandeurType('particulier')}
            className={
              'px-3 py-2 rounded-lg text-[13px] font-bold border-2 transition-colors inline-flex items-center justify-center gap-1.5 ' +
              (demandeurType === 'particulier'
                ? 'bg-[#1F6B45] text-white border-[#1F6B45]'
                : 'bg-white text-ink border-sand-border hover:border-[#1F6B45]')
            }
          >
            <User size={14} /> Particulier
          </button>
        </div>

        {/* Caractéristiques */}
        <Section title="Intervention">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Lbl>Référence</Lbl>
              <input className={`${INPUT_CLASS} font-mono`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="auto si vide" />
            </div>
            <div>
              <Lbl>Statut</Lbl>
              <select className={INPUT_CLASS} value={statut} onChange={(e) => setStatut(e.target.value as StatutIntervention)}>
                {STATUTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <Lbl>Type</Lbl>
              <select className={INPUT_CLASS} value={type} onChange={(e) => setType(e.target.value as TypeIntervention | '')}>
                <option value="">— Type —</option>
                {ALLOWED_TYPES_INTERVENTION.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Lbl>Priorité</Lbl>
              <select className={INPUT_CLASS} value={priorite} onChange={(e) => setPriorite(e.target.value as PrioriteIntervention)}>
                <option value="normale">Normale</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div>
              <Lbl>Date prévue</Lbl>
              <input type="datetime-local" className={INPUT_CLASS} value={datePrevue} onChange={(e) => setDatePrevue(e.target.value)} />
            </div>
            <div>
              <Lbl>Technicien</Lbl>
              <select className={INPUT_CLASS} value={technicienId} onChange={(e) => setTechnicienId(e.target.value)}>
                <option value="">— Aucun —</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>{[t.prenom, t.nom].filter(Boolean).join(' ') || t.email}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <Lbl>Description</Lbl>
            <textarea
              className={`${INPUT_CLASS} min-h-[72px] resize-y`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optionnel"
            />
          </div>
        </Section>

        {/* Demandeur — syndic */}
        {demandeurType === 'syndic' && (
          <Section title="Demandeur — syndic">
            <div className="space-y-3">
              {/* ACP */}
              <div>
                <Lbl>ACP / copropriété *</Lbl>
                {selectedAcp ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 border border-navy-mid rounded-lg bg-white text-[13px]">
                    <span className="font-semibold text-ink truncate">{selectedAcp.nom}</span>
                    <button type="button" onClick={() => { setSelectedAcp(null); setAcpQuery(''); }} className="text-ink-muted hover:text-terra flex-shrink-0" aria-label="Changer d'ACP"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <input className={INPUT_CLASS} value={acpQuery} onChange={(e) => setAcpQuery(e.target.value)} placeholder="Nom ou BCE (min. 2 caractères)…" />
                    {acpResults.length > 0 && (
                      <ul className="mt-1 rounded-lg border border-sand-border bg-cream max-h-[160px] overflow-y-auto shadow-raised">
                        {acpResults.map((a) => (
                          <li key={a.id}>
                            <button type="button" onClick={() => { setSelectedAcp(a); setAcpResults([]); }} className="w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--color-sand-hover)]">
                              <span className="font-semibold text-navy">{a.nom}</span>
                              {a.ville ? <span className="text-ink-mid"> — {[a.adresse, a.code_postal, a.ville].filter(Boolean).join(', ')}</span> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              {/* Syndic */}
              <div>
                <Lbl>Syndic *</Lbl>
                {selectedOrg ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 border border-navy-mid rounded-lg bg-white text-[13px]">
                    <span className="font-semibold text-ink truncate">{selectedOrg.nom}</span>
                    <button type="button" onClick={() => { setSelectedOrg(null); setOrgQuery(''); }} className="text-ink-muted hover:text-terra flex-shrink-0" aria-label="Changer de syndic"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <input className={INPUT_CLASS} value={orgQuery} onChange={(e) => setOrgQuery(e.target.value)} placeholder="Nom ou email (min. 2 caractères)…" />
                    {orgResults.length > 0 && (
                      <ul className="mt-1 rounded-lg border border-sand-border bg-cream max-h-[160px] overflow-y-auto shadow-raised">
                        {orgResults.map((o) => (
                          <li key={o.id}>
                            <button type="button" onClick={() => { setSelectedOrg(o); setOrgResults([]); }} className="w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--color-sand-hover)]">
                              <span className="font-semibold text-navy">{o.nom}</span>
                              <span className="text-ink-mid"> — {o.type}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              {/* Adresse d'intervention — optionnel, mode syndic uniquement */}
              <div>
                <Lbl>Adresse de l&apos;intervention (optionnel)</Lbl>
                <input
                  className={INPUT_CLASS}
                  value={adresse}
                  onChange={(e) => setAdresse(e.target.value)}
                  placeholder="Rue + numéro, code postal ville"
                />
              </div>
            </div>
          </Section>
        )}

        {/* Demandeur — particulier */}
        {demandeurType === 'particulier' && (
          <>
            <Section title="Mandant (facturation)">
              <div className="grid grid-cols-2 gap-3">
                <div><Lbl>Prénom *</Lbl><input className={INPUT_CLASS} value={pPrenom} onChange={(e) => setPPrenom(e.target.value)} /></div>
                <div><Lbl>Nom *</Lbl><input className={INPUT_CLASS} value={pNom} onChange={(e) => setPNom(e.target.value)} /></div>
                <div><Lbl>Email *</Lbl><input className={INPUT_CLASS} value={pEmail} onChange={(e) => setPEmail(e.target.value)} placeholder="nom@exemple.be" /></div>
                <div><Lbl>Téléphone</Lbl><input className={INPUT_CLASS} value={pTel} onChange={(e) => setPTel(e.target.value)} /></div>
                <div className="col-span-2"><Lbl>Rue + numéro *</Lbl><input className={INPUT_CLASS} value={pRue} onChange={(e) => setPRue(e.target.value)} /></div>
                <div><Lbl>Code postal *</Lbl><input className={INPUT_CLASS} value={pCp} onChange={(e) => setPCp(e.target.value)} /></div>
                <div><Lbl>Ville *</Lbl><input className={INPUT_CLASS} value={pVille} onChange={(e) => setPVille(e.target.value)} /></div>
                <div className="col-span-2"><Lbl>BCE (optionnel)</Lbl><input className={`${INPUT_CLASS} font-mono`} value={pBce} onChange={(e) => setPBce(e.target.value)} /></div>
              </div>
            </Section>

            <Section title="Lieu d'intervention">
              <label className="flex items-center gap-2 text-[13px] text-ink mb-2">
                <input type="checkbox" checked={pLieuMeme} onChange={(e) => setPLieuMeme(e.target.checked)} />
                Même adresse que le mandant
              </label>
              {!pLieuMeme && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2"><Lbl>Rue + numéro *</Lbl><input className={INPUT_CLASS} value={pLieuRue} onChange={(e) => setPLieuRue(e.target.value)} /></div>
                  <div><Lbl>Code postal *</Lbl><input className={INPUT_CLASS} value={pLieuCp} onChange={(e) => setPLieuCp(e.target.value)} /></div>
                  <div><Lbl>Ville *</Lbl><input className={INPUT_CLASS} value={pLieuVille} onChange={(e) => setPLieuVille(e.target.value)} /></div>
                </div>
              )}
            </Section>

            <Section title="Contact sur place">
              <label className="flex items-center gap-2 text-[13px] text-ink mb-2">
                <input type="checkbox" checked={pContactActif} onChange={(e) => setPContactActif(e.target.checked)} />
                Un contact différent sera présent sur place
              </label>
              {pContactActif && (
                <div className="grid grid-cols-2 gap-3">
                  <div><Lbl>Prénom</Lbl><input className={INPUT_CLASS} value={pContactPrenom} onChange={(e) => setPContactPrenom(e.target.value)} /></div>
                  <div><Lbl>Nom</Lbl><input className={INPUT_CLASS} value={pContactNom} onChange={(e) => setPContactNom(e.target.value)} /></div>
                  <div><Lbl>Téléphone</Lbl><input className={INPUT_CLASS} value={pContactTel} onChange={(e) => setPContactTel(e.target.value)} /></div>
                  <div><Lbl>Email</Lbl><input className={INPUT_CLASS} value={pContactEmail} onChange={(e) => setPContactEmail(e.target.value)} /></div>
                  <div className="col-span-2"><Lbl>Instructions</Lbl><input className={INPUT_CLASS} value={pContactInstr} onChange={(e) => setPContactInstr(e.target.value)} /></div>
                </div>
              )}
            </Section>
          </>
        )}

        {error && (
          <div className="px-3 py-2.5 rounded-lg text-[12px] font-semibold bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] text-[var(--color-terra)]">
            {error}
          </div>
        )}
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-[13px] font-medium bg-white border border-sand-border text-ink-mid hover:border-navy-mid"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || pending}
          className="px-4 py-2 rounded-lg text-[13px] font-bold bg-navy text-white disabled:opacity-50"
        >
          {pending ? 'Création…' : 'Créer l\'intervention'}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}
