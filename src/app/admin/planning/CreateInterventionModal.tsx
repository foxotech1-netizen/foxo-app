'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  User,
  Zap,
  CheckCircle2,
  XCircle,
  Mail,
  Smartphone,
  MessageCircle,
  Check,
  X,
  Hourglass,
  type LucideIcon,
} from 'lucide-react';
import { TypeBadge } from '@/components/TypeBadge';
import {
  createInterventionFromSlot,
  searchAcps,
  searchOrganisations,
  type SlotOccupant,
} from './actions';
import type {
  Acp,
  Organisation,
  TypeIntervention,
  Utilisateur,
} from '@/lib/types/database';

const TYPES: TypeIntervention[] = [
  'Fuite canalisation',
  'Fuite chauffage',
  'Fuite infiltration',
  'Surconsommation eau',
  'Autre',
];

export interface SlotInfo {
  id: string;
  date: string;          // YYYY-MM-DD
  heure_debut: string;   // HH:MM
  heure_fin: string;     // HH:MM
  technicien_id: string | null;
}

export function CreateInterventionModal({
  slot,
  techs,
  onClose,
  onCreated,
}: {
  slot: SlotInfo;
  techs: Utilisateur[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [demandeurType, setDemandeurType] = useState<'syndic' | 'particulier'>('syndic');

  // Champs communs
  const [ref, setRef] = useState<string>('');
  const [type, setType] = useState<TypeIntervention | ''>('');
  const [description, setDescription] = useState('');
  const [priorite, setPriorite] = useState<'normale' | 'urgente'>('normale');
  const [adressePrecise, setAdressePrecise] = useState('');

  // Syndic mode
  const [acpQuery, setAcpQuery] = useState('');
  const [acpResults, setAcpResults] = useState<Acp[]>([]);
  const [selectedAcp, setSelectedAcp] = useState<Acp | null>(null);
  const [orgQuery, setOrgQuery] = useState('');
  const [orgResults, setOrgResults] = useState<Organisation[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organisation | null>(null);
  const [occupants, setOccupants] = useState<SlotOccupant[]>([
    { appartement: '', etage: '', prenom: '', nom: '', email: '', telephone: '', conf: 'en_attente', instructions: '', contact_preference: 'email' },
  ]);

  // Particulier mode — Mandant
  const [pPrenom, setPPrenom] = useState('');
  const [pNom, setPNom] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pTel, setPTel] = useState('');
  const [pRue, setPRue] = useState('');     // adresse facturation
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

  // Syndic mode — billing override
  const [billingOverride, setBillingOverride] = useState(false);
  const [billingRue, setBillingRue] = useState('');
  const [billingCp, setBillingCp] = useState('');
  const [billingVille, setBillingVille] = useState('');
  const [billingBce, setBillingBce] = useState('');

  const tech = techs.find((t) => t.id === slot.technicien_id);
  const dateLabel = new Date(slot.date + 'T12:00:00').toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  // Pré-remplissage depuis /admin/mails — sessionStorage 'foxo_mail_prefill'
  // (analyse Claude d'un email entrant). Ne tourne qu'une fois au mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem('foxo_mail_prefill'); } catch { /* noop */ }
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as {
        analysis?: {
          nom_client?: string | null;
          adresse?: string | null;
          type_probleme?: string | null;
          telephone?: string | null;
          email?: string | null;
          date_souhaitee?: string | null;
          priorite?: 'urgente' | 'normale' | null;
          resume?: string | null;
        };
      };
      const a = data?.analysis;
      if (!a) return;

      // Bascule en mode particulier (les mails entrants sont rarement
      // d'un syndic enregistré)
      setDemandeurType('particulier');

      if (a.nom_client) {
        const parts = a.nom_client.trim().split(/\s+/);
        if (parts.length >= 2) {
          setPPrenom(parts[0]);
          setPNom(parts.slice(1).join(' '));
        } else {
          setPNom(a.nom_client);
        }
      }
      if (a.email) setPEmail(a.email);
      if (a.telephone) setPTel(a.telephone);
      if (a.adresse) {
        // Heuristique légère : "Rue X 12, 1000 Bruxelles" → rue + cp + ville
        const m = a.adresse.match(/^(.+?),?\s*(\d{4})\s+(.+?)$/);
        if (m) {
          setPRue(m[1].trim());
          setPCp(m[2].trim());
          setPVille(m[3].trim());
        } else {
          setPRue(a.adresse);
        }
      }
      if (a.type_probleme) {
        const allowed = ['Fuite canalisation', 'Fuite chauffage', 'Fuite infiltration', 'Surconsommation eau', 'Autre'] as const;
        if ((allowed as readonly string[]).includes(a.type_probleme)) {
          setType(a.type_probleme as typeof allowed[number]);
        }
      }
      if (a.priorite === 'urgente') setPriorite('urgente');
      if (a.resume) setDescription(a.resume);

      // Cleanup pour éviter le re-prefill au prochain modal
      try { sessionStorage.removeItem('foxo_mail_prefill'); } catch { /* noop */ }
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recherche ACP debounce
  useEffect(() => {
    if (selectedAcp || demandeurType !== 'syndic') return;
    const q = acpQuery.trim();
    if (q.length < 2) { setAcpResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchAcps(q);
      if (res.ok) setAcpResults(res.data ?? []);
    }, 280);
    return () => clearTimeout(t);
  }, [acpQuery, selectedAcp, demandeurType]);

  // Recherche org debounce
  useEffect(() => {
    if (selectedOrg || demandeurType !== 'syndic') return;
    const q = orgQuery.trim();
    if (q.length < 2) { setOrgResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchOrganisations(q);
      if (res.ok) setOrgResults(res.data ?? []);
    }, 280);
    return () => clearTimeout(t);
  }, [orgQuery, selectedOrg, demandeurType]);

  function addOccupant() {
    setOccupants((arr) => [...arr, { appartement: '', etage: '', prenom: '', nom: '', email: '', telephone: '', conf: 'en_attente', instructions: '', contact_preference: 'email' }]);
  }
  function removeOccupant(i: number) {
    setOccupants((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));
  }
  function updateOccupant(i: number, patch: Partial<SlotOccupant>) {
    setOccupants((arr) => arr.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  function validate(): string | null {
    if (!type) return 'Sélectionne un type d\'intervention.';
    if (description.trim().length < 5) return 'Description trop courte (min. 5 caractères).';
    if (demandeurType === 'syndic') {
      if (!selectedAcp) return 'Sélectionne ou crée une ACP.';
      if (!selectedOrg) return 'Sélectionne un syndic.';
      if (billingOverride) {
        if (!billingRue.trim() || !billingCp.trim() || !billingVille.trim()) {
          return 'Adresse de facturation custom complète requise.';
        }
      }
    } else {
      if (!pPrenom.trim() || !pNom.trim()) return 'Prénom et nom mandant requis.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pEmail.trim())) return 'Email mandant invalide.';
      if (!pTel.trim()) return 'Téléphone mandant requis.';
      if (!pRue.trim() || !pCp.trim() || !pVille.trim()) return 'Adresse de facturation complète requise.';
      if (!pLieuMeme && (!pLieuRue.trim() || !pLieuCp.trim() || !pLieuVille.trim())) {
        return 'Adresse d\'intervention complète requise.';
      }
      if (pContactActif) {
        if (!pContactPrenom.trim() || !pContactNom.trim()) return 'Prénom + nom du contact sur place requis.';
        if (!pContactTel.trim()) return 'Téléphone du contact sur place requis.';
        if (pContactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pContactEmail.trim())) {
          return 'Email du contact sur place invalide.';
        }
      }
    }
    return null;
  }

  function submit() {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);

    startTransition(async () => {
      const res = await createInterventionFromSlot({
        creneau_id: slot.id,
        ref: ref.trim() || undefined,
        type: type as TypeIntervention,
        description: description.trim(),
        priorite,
        adresse_precise: adressePrecise.trim() || undefined,
        demandeur:
          demandeurType === 'syndic'
            ? {
                demandeur_type: 'syndic',
                acp_id: selectedAcp!.id,
                syndic_id: selectedOrg!.id,
                occupants: occupants.filter(
                  (o) => o.appartement || o.nom || o.prenom || o.email || o.telephone,
                ),
                ...(billingOverride
                  ? {
                      billing_override: {
                        rue: billingRue.trim(),
                        cp: billingCp.trim(),
                        ville: billingVille.trim(),
                        ...(billingBce.trim() ? { bce: billingBce.trim() } : {}),
                      },
                    }
                  : {}),
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
                occupants: occupants.filter(
                  (o) => o.appartement || o.nom || o.prenom || o.email || o.telephone,
                ),
              },
      });
      if (!res.ok) { setError(res.error); return; }
      onCreated();
      onClose();
      router.refresh();
    });
  }

  return (
    <ModalShell onClose={onClose} title="Nouvelle intervention" subtitle={`${dateLabel} · ${slot.heure_debut} → ${slot.heure_fin}${tech ? ` · ${tech.prenom ?? ''} ${tech.nom ?? ''}` : ''}`}>
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

        {/* Champs communs */}
        <Section title="Identification">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Référence" value={ref} onChange={setRef} placeholder="2026-101 (auto si vide)" mono />
            <Field label="Type d'intervention *" value={type} onChange={(v) => setType(v as TypeIntervention)} type="select">
              <option value="">— Sélectionner —</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Field>
          </div>
          <div className="mt-3">
            <Label>Description *</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Décris le problème, l'étage, les dégâts visibles…"
              rows={3}
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <Label>Priorité</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['normale', 'urgente'] as const).map((p) => (
                  <label
                    key={p}
                    className={
                      'px-3 py-2 border-2 rounded-lg cursor-pointer flex items-center gap-2 text-xs ' +
                      (priorite === p
                        ? 'border-navy bg-navy-pale dark:text-white'
                        : 'border-sand-border bg-white')
                    }
                  >
                    <input type="radio" checked={priorite === p} onChange={() => setPriorite(p)} className="accent-[#1B3A6B]" />
                    {p === 'urgente' ? (<span className="inline-flex items-center gap-1"><Zap size={12} /> Urgente</span>) : 'Normale'}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Adresse précise (si différente)" value={adressePrecise} onChange={setAdressePrecise} placeholder="ex : Apt 3B, étage 5" />
          </div>
        </Section>

        {demandeurType === 'syndic' ? (
          <>
            <Section title="ACP (immeuble)">
              {selectedAcp ? (
                <div className="bg-navy-pale border border-navy-light rounded-lg p-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-[13px] text-navy dark:text-white">{selectedAcp.nom}</div>
                    <div className="text-[11px] text-navy/80 dark:text-white/80">
                      {[selectedAcp.adresse, selectedAcp.code_postal, selectedAcp.ville].filter(Boolean).join(', ') || '—'}
                    </div>
                    {selectedAcp.bce && (
                      <div className="text-[10px] font-mono text-navy/60 dark:text-white/60 mt-0.5">BCE {selectedAcp.bce}</div>
                    )}
                  </div>
                  <button onClick={() => setSelectedAcp(null)} className="text-[11px] text-navy underline dark:text-white">Changer</button>
                </div>
              ) : (
                <>
                  <input
                    value={acpQuery}
                    onChange={(e) => setAcpQuery(e.target.value)}
                    placeholder="Rechercher par nom ou BCE…"
                    className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                  />
                  {acpResults.length > 0 && (
                    <div className="mt-2 bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[180px] overflow-y-auto">
                      {acpResults.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => { setSelectedAcp(a); setAcpResults([]); setAcpQuery(a.nom); }}
                          className="block w-full text-left px-3 py-2 text-[12px] hover:bg-sand"
                        >
                          <div className="font-bold">{a.nom}</div>
                          <div className="text-[10px] text-ink-muted">
                            {[a.adresse, a.code_postal, a.ville].filter(Boolean).join(', ')}
                            {a.bce ? ` · BCE ${a.bce}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section title="Syndic">
              {selectedOrg ? (
                <div className="bg-navy-pale border border-navy-light rounded-lg p-3 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="font-bold text-[13px] text-navy dark:text-white flex items-center gap-2">
                      {selectedOrg.nom}
                      <TypeBadge type={selectedOrg.type} />
                    </div>
                    <div className="text-[11px] text-navy/80 dark:text-white/80">{selectedOrg.email}</div>
                  </div>
                  <button onClick={() => setSelectedOrg(null)} className="text-[11px] text-navy underline dark:text-white">Changer</button>
                </div>
              ) : (
                <>
                  <input
                    value={orgQuery}
                    onChange={(e) => setOrgQuery(e.target.value)}
                    placeholder="Rechercher par nom ou email…"
                    className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                  />
                  {orgResults.length > 0 && (
                    <div className="mt-2 bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[180px] overflow-y-auto">
                      {orgResults.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => { setSelectedOrg(o); setOrgResults([]); setOrgQuery(o.nom); }}
                          className="block w-full text-left px-3 py-2 text-[12px] hover:bg-sand"
                        >
                          <div className="font-bold flex items-center gap-2">
                            {o.nom}
                            <TypeBadge type={o.type} />
                          </div>
                          <div className="text-[10px] text-ink-muted">{o.email}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Section>

            {/* Adresses syndic — info + override facturation */}
            {selectedAcp && selectedOrg && (
              <Section title="Adresses">
                <div className="bg-sand border border-sand-border rounded-lg p-3 mb-3 text-[12px]">
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted w-[110px] flex-shrink-0 mt-0.5">
                      Intervention
                    </span>
                    <span className="text-ink">
                      {[selectedAcp.adresse, selectedAcp.code_postal, selectedAcp.ville].filter(Boolean).join(', ') || '—'}
                      <span className="text-[10px] text-ink-muted ml-1">(ACP)</span>
                    </span>
                  </div>
                  <div className="flex items-start gap-2 mt-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted w-[110px] flex-shrink-0 mt-0.5">
                      Facturation
                    </span>
                    <span className="text-ink">
                      {billingOverride
                        ? <span className="italic">Adresse custom (ci-dessous)</span>
                        : (
                          <>
                            {selectedOrg.adresse || <em className="text-ink-muted">—</em>}
                            <span className="text-[10px] text-ink-muted ml-1">
                              ({selectedOrg.nom})
                            </span>
                          </>
                        )}
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[12px] cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={billingOverride}
                    onChange={(e) => setBillingOverride(e.target.checked)}
                    className="accent-[#1B3A6B]"
                  />
                  Utiliser une adresse de facturation différente
                </label>
                {billingOverride && (
                  <div className="space-y-2">
                    <input
                      value={billingRue}
                      onChange={(e) => setBillingRue(e.target.value)}
                      placeholder="Rue et numéro"
                      className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        value={billingCp}
                        onChange={(e) => setBillingCp(e.target.value)}
                        placeholder="CP"
                        className="px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                      />
                      <input
                        value={billingVille}
                        onChange={(e) => setBillingVille(e.target.value)}
                        placeholder="Ville"
                        className="col-span-2 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                      />
                    </div>
                    <input
                      value={billingBce}
                      onChange={(e) => setBillingBce(e.target.value)}
                      placeholder="BCE / TVA (optionnel)"
                      className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white font-mono outline-none focus:border-navy-mid"
                    />
                  </div>
                )}
              </Section>
            )}

          </>
        ) : (
          <>
            {/* Mandant (donneur d'ordre) */}
            <Section title="Mandant (donneur d'ordre)">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Prénom *" value={pPrenom} onChange={setPPrenom} />
                <Field label="Nom *" value={pNom} onChange={setPNom} />
                <Field label="Email *" type="email" value={pEmail} onChange={setPEmail} />
                <Field label="Téléphone *" type="tel" value={pTel} onChange={setPTel} />
              </div>
              <div className="mt-3">
                <label className="text-xs font-semibold text-ink-mid block mb-1.5">
                  Adresse de facturation *
                </label>
                <input
                  value={pRue}
                  onChange={(e) => setPRue(e.target.value)}
                  placeholder="Rue et numéro"
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid mb-2"
                />
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={pCp}
                    onChange={(e) => setPCp(e.target.value)}
                    placeholder="CP"
                    className="px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                  />
                  <input
                    value={pVille}
                    onChange={(e) => setPVille(e.target.value)}
                    placeholder="Ville"
                    className="col-span-2 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                  />
                </div>
              </div>
              <div className="mt-3">
                <Field label="BCE / TVA (optionnel)" value={pBce} onChange={setPBce} placeholder="BE0123.456.789" />
              </div>
            </Section>

            {/* Lieu intervention */}
            <Section title="Lieu d'intervention">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={pLieuMeme}
                  onChange={(e) => setPLieuMeme(e.target.checked)}
                  className="accent-[#1B3A6B]"
                />
                Même adresse que le mandant
              </label>
              {!pLieuMeme && (
                <div>
                  <input
                    value={pLieuRue}
                    onChange={(e) => setPLieuRue(e.target.value)}
                    placeholder="Rue et numéro de l'intervention"
                    className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid mb-2"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      value={pLieuCp}
                      onChange={(e) => setPLieuCp(e.target.value)}
                      placeholder="CP"
                      className="px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                    />
                    <input
                      value={pLieuVille}
                      onChange={(e) => setPLieuVille(e.target.value)}
                      placeholder="Ville"
                      className="col-span-2 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
                    />
                  </div>
                </div>
              )}
            </Section>

            {/* Contact sur place */}
            <Section title="Contact sur place (optionnel)">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={pContactActif}
                  onChange={(e) => setPContactActif(e.target.checked)}
                  className="accent-[#1B3A6B]"
                />
                Contact différent du mandant
              </label>
              {pContactActif && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Field label="Prénom *" value={pContactPrenom} onChange={setPContactPrenom} />
                    <Field label="Nom *" value={pContactNom} onChange={setPContactNom} />
                  </div>
                  <Field label="Téléphone *" type="tel" value={pContactTel} onChange={setPContactTel} placeholder="+32 ..." />
                  <Field label="Email (optionnel)" type="email" value={pContactEmail} onChange={setPContactEmail} />
                  <div>
                    <label className="text-xs font-semibold text-ink-mid block mb-1.5">
                      Instructions d&apos;accès
                    </label>
                    <textarea
                      value={pContactInstr}
                      onChange={(e) => setPContactInstr(e.target.value)}
                      placeholder="Digicode, gardien, créneau d'accès…"
                      rows={2}
                      className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
                    />
                  </div>
                </div>
              )}
            </Section>
          </>
        )}

        {/* Appartements / unités à inspecter — commun syndic + particulier */}
        <Section title={demandeurType === 'syndic' ? 'Appartements / unités concernés' : 'Autres unités à inspecter (optionnel)'}>
          <div className="space-y-2">
            {occupants.map((o, i) => (
              <div key={i} className="bg-white border border-sand-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    Unité {i + 1}
                  </span>
                  {occupants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeOccupant(i)}
                      className="text-[10px] text-terra hover:underline"
                    >
                      Retirer
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={o.appartement}
                    onChange={(e) => updateOccupant(i, { appartement: e.target.value })}
                    placeholder="Numéro / nom (Apt 3B, Cave 2, Communs…)"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
                  />
                  <input
                    value={o.etage ?? ''}
                    onChange={(e) => updateOccupant(i, { etage: e.target.value })}
                    placeholder="Étage (optionnel)"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={o.prenom}
                    onChange={(e) => updateOccupant(i, { prenom: e.target.value })}
                    placeholder="Prénom occupant"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
                  />
                  <input
                    value={o.nom}
                    onChange={(e) => updateOccupant(i, { nom: e.target.value })}
                    placeholder="Nom occupant"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
                  />
                  <input
                    value={o.telephone}
                    onChange={(e) => updateOccupant(i, { telephone: e.target.value })}
                    type="tel"
                    placeholder="+32 488 12 34 56"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white font-mono"
                  />
                  <input
                    value={o.email}
                    onChange={(e) => updateOccupant(i, { email: e.target.value })}
                    type="email"
                    placeholder="Email (lien occupant /o/…)"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                    Statut accès
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { v: 'confirme', icon: CheckCircle2 as LucideIcon, label: 'Confirmé' },
                        { v: 'en_attente', icon: Hourglass as LucideIcon, label: 'À confirmer' },
                        { v: 'decline', icon: XCircle as LucideIcon, label: 'Pas d\'accès' },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.v}
                        className={
                          'px-2 py-1.5 border rounded text-[11px] font-semibold cursor-pointer text-center inline-flex items-center justify-center gap-1 ' +
                          (o.conf === opt.v
                            ? 'border-navy bg-navy-pale text-navy dark:text-white'
                            : 'border-sand-border bg-white text-ink-mid')
                        }
                      >
                        <input
                          type="radio"
                          checked={o.conf === opt.v}
                          onChange={() => updateOccupant(i, { conf: opt.v })}
                          className="sr-only"
                        />
                        <opt.icon size={12} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
                    Préférence contact
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(
                      [
                        { v: 'email', icons: [Mail] as LucideIcon[], label: 'Email' },
                        { v: 'sms', icons: [Smartphone] as LucideIcon[], label: 'SMS' },
                        { v: 'whatsapp', icons: [MessageCircle] as LucideIcon[], label: 'WhatsApp' },
                        { v: 'both', icons: [Mail, Smartphone] as LucideIcon[], label: 'Les deux' },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.v}
                        className={
                          'px-1.5 py-1 border rounded text-[10px] font-semibold cursor-pointer text-center inline-flex items-center justify-center gap-1 ' +
                          (o.contact_preference === opt.v
                            ? 'border-navy bg-navy-pale text-navy dark:text-white'
                            : 'border-sand-border bg-white text-ink-mid')
                        }
                      >
                        <input
                          type="radio"
                          checked={o.contact_preference === opt.v}
                          onChange={() => updateOccupant(i, { contact_preference: opt.v })}
                          className="sr-only"
                        />
                        <span className="inline-flex items-center gap-0.5">
                          {opt.icons.map((Ic, idx) => <Ic key={idx} size={10} />)}
                        </span>
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <textarea
                  value={o.instructions ?? ''}
                  onChange={(e) => updateOccupant(i, { instructions: e.target.value })}
                  placeholder="Instructions spécifiques (digicode, gardien, créneau d'accès…)"
                  rows={2}
                  className="w-full px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none resize-y"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={addOccupant}
              className="w-full bg-sand-mid text-ink-mid border border-sand-border px-3 py-2 rounded-md text-[12px] font-semibold dark:bg-[rgba(255,255,255,.06)]"
            >
              + Ajouter un appartement
            </button>
            {demandeurType === 'particulier' && (
              <p className="text-[10px] text-ink-muted italic mt-1">
                Le particulier ci-dessus reste le contact principal. Cette section sert pour les unités annexes (cave, communs, voisin impacté, etc.).
              </p>
            )}
          </div>
        </Section>

        {error && (
          <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-lg px-3 py-2 font-semibold">
            {error}
          </div>
        )}
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)]"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="bg-navy text-white px-5 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {pending ? 'Création…' : (<><Check size={14} /> Créer l&apos;intervention</>)}
        </button>
      </ModalFooter>
    </ModalShell>
  );
}

// ─── Helpers shells réutilisables ──────────────────────────────────────────

export function ModalShell({
  title, subtitle, onClose, children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-cream w-full sm:max-w-[640px] sm:rounded-modal rounded-t-modal border border-sand-border max-h-[90vh] flex flex-col shadow-overlay">
        <header className="px-5 py-4 border-b border-sand-border flex items-start justify-between gap-3 flex-shrink-0">
          <div>
            <h2 className="fxs-section-title text-ink">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border flex-shrink-0 dark:bg-[rgba(255,255,255,.06)] inline-flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  // Sticky : la rangée d'actions reste visible pendant que le corps
  // scrolle (critère D5-c), sans sortir les boutons du <form>.
  return (
    <div className="sticky bottom-0 -mx-5 -mb-4 px-5 py-4 mt-5 bg-cream border-t border-sand-border flex justify-end gap-2">
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2">
        {title}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-ink-mid block mb-1.5">
      {children}
    </label>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, mono, children,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; mono?: boolean; children?: React.ReactNode;
}) {
  if (type === 'select') {
    return (
      <div>
        <Label>{label}</Label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white"
        >
          {children}
        </select>
      </div>
    );
  }
  return (
    <div>
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          'w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid ' +
          (mono ? 'font-mono' : '')
        }
      />
    </div>
  );
}
