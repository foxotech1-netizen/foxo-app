'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
    { appartement: '', etage: '', prenom: '', nom: '', email: '', telephone: '', conf: 'en_attente', instructions: '' },
  ]);

  // Particulier mode
  const [pPrenom, setPPrenom] = useState('');
  const [pNom, setPNom] = useState('');
  const [pEmail, setPEmail] = useState('');
  const [pTel, setPTel] = useState('');
  const [pRue, setPRue] = useState('');
  const [pCp, setPCp] = useState('');
  const [pVille, setPVille] = useState('');
  const [pAccesYes, setPAccesYes] = useState(true);
  const [pAccesInstr, setPAccesInstr] = useState('');

  const tech = techs.find((t) => t.id === slot.technicien_id);
  const dateLabel = new Date(slot.date + 'T12:00:00').toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

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
    setOccupants((arr) => [...arr, { appartement: '', etage: '', prenom: '', nom: '', email: '', telephone: '', conf: 'en_attente', instructions: '' }]);
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
    } else {
      if (!pPrenom.trim() || !pNom.trim()) return 'Prénom et nom requis.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pEmail.trim())) return 'Email invalide.';
      if (!pTel.trim()) return 'Téléphone requis.';
      if (!pRue.trim() || !pCp.trim() || !pVille.trim()) return 'Adresse complète requise.';
    }
    return null;
  }

  function submit() {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);

    const accesNote = pAccesYes
      ? (pAccesInstr.trim() ? `Accès au logement OK. ${pAccesInstr.trim()}` : 'Accès au logement OK.')
      : `Pas d'accès direct au logement. ${pAccesInstr.trim()}`.trim();

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
              }
            : {
                demandeur_type: 'particulier',
                particulier: {
                  prenom: pPrenom.trim(),
                  nom: pNom.trim(),
                  email: pEmail.trim().toLowerCase(),
                  telephone: pTel.trim(),
                  adresse: { rue: pRue.trim(), code_postal: pCp.trim(), ville: pVille.trim() },
                  // accès rangé en commentaire dans description si non vide
                  ...(accesNote ? {} : {}),
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
              'px-3 py-2 rounded-lg text-[13px] font-bold border-2 transition-colors ' +
              (demandeurType === 'syndic'
                ? 'bg-navy text-white border-navy'
                : 'bg-white text-ink border-sand-border hover:border-navy-mid dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
            }
          >
            🏢 Syndic
          </button>
          <button
            type="button"
            onClick={() => setDemandeurType('particulier')}
            className={
              'px-3 py-2 rounded-lg text-[13px] font-bold border-2 transition-colors ' +
              (demandeurType === 'particulier'
                ? 'bg-[#1F6B45] text-white border-[#1F6B45]'
                : 'bg-white text-ink border-sand-border hover:border-[#1F6B45] dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
            }
          >
            👤 Particulier
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
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
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
                        ? 'border-navy bg-navy-pale dark:bg-[#1B3A6B] dark:text-white'
                        : 'border-sand-border bg-white dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]')
                    }
                  >
                    <input type="radio" checked={priorite === p} onChange={() => setPriorite(p)} className="accent-[#1B3A6B]" />
                    {p === 'urgente' ? '⚡ Urgente' : 'Normale'}
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
                <div className="bg-navy-pale border border-navy-light rounded-lg p-3 flex items-start justify-between gap-3 dark:bg-[#1B3A6B] dark:border-[#2A5298]">
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
                    <div className="mt-2 bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[180px] overflow-y-auto dark:bg-[#221E1A] dark:border-[#3D3A32] dark:divide-[#3D3A32]">
                      {acpResults.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => { setSelectedAcp(a); setAcpResults([]); setAcpQuery(a.nom); }}
                          className="block w-full text-left px-3 py-2 text-[12px] hover:bg-sand dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
                        >
                          <div className="font-bold">{a.nom}</div>
                          <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">
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
                <div className="bg-navy-pale border border-navy-light rounded-lg p-3 flex items-start justify-between gap-3 dark:bg-[#1B3A6B] dark:border-[#2A5298]">
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
                    <div className="mt-2 bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[180px] overflow-y-auto dark:bg-[#221E1A] dark:border-[#3D3A32] dark:divide-[#3D3A32]">
                      {orgResults.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => { setSelectedOrg(o); setOrgResults([]); setOrgQuery(o.nom); }}
                          className="block w-full text-left px-3 py-2 text-[12px] hover:bg-sand dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
                        >
                          <div className="font-bold flex items-center gap-2">
                            {o.nom}
                            <TypeBadge type={o.type} />
                          </div>
                          <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">{o.email}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Section>

          </>
        ) : (
          <>
            <Section title="Particulier — coordonnées">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Prénom *" value={pPrenom} onChange={setPPrenom} />
                <Field label="Nom *" value={pNom} onChange={setPNom} />
                <Field label="Email *" type="email" value={pEmail} onChange={setPEmail} />
                <Field label="Téléphone *" type="tel" value={pTel} onChange={setPTel} />
              </div>
            </Section>
            <Section title="Adresse du logement">
              <Field label="Rue et numéro *" value={pRue} onChange={setPRue} />
              <div className="grid grid-cols-3 gap-2 mt-2">
                <Field label="Code postal *" value={pCp} onChange={setPCp} />
                <div className="col-span-2">
                  <Field label="Ville *" value={pVille} onChange={setPVille} />
                </div>
              </div>
            </Section>
            <Section title="Accès au logement">
              <div className="grid grid-cols-2 gap-2 mb-2">
                {[true, false].map((v) => (
                  <label
                    key={String(v)}
                    className={
                      'px-3 py-2 border-2 rounded-lg cursor-pointer flex items-center gap-2 text-xs ' +
                      (pAccesYes === v
                        ? 'border-navy bg-navy-pale dark:bg-[#1B3A6B] dark:text-white'
                        : 'border-sand-border bg-white dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]')
                    }
                  >
                    <input type="radio" checked={pAccesYes === v} onChange={() => setPAccesYes(v)} className="accent-[#1B3A6B]" />
                    {v ? '✓ Oui' : '✕ Non, à organiser'}
                  </label>
                ))}
              </div>
              <textarea
                value={pAccesInstr}
                onChange={(e) => setPAccesInstr(e.target.value)}
                placeholder="Instructions d'accès (digicode, gardien, horaire…)"
                rows={2}
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
              />
            </Section>
          </>
        )}

        {/* Appartements / unités à inspecter — commun syndic + particulier */}
        <Section title={demandeurType === 'syndic' ? 'Appartements / unités concernés' : 'Autres unités à inspecter (optionnel)'}>
          <div className="space-y-2">
            {occupants.map((o, i) => (
              <div key={i} className="bg-white border border-sand-border rounded-lg p-3 space-y-2 dark:bg-[#221E1A] dark:border-[#3D3A32]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-[#C8C2B8]">
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
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                  />
                  <input
                    value={o.etage ?? ''}
                    onChange={(e) => updateOccupant(i, { etage: e.target.value })}
                    placeholder="Étage (optionnel)"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    value={o.prenom}
                    onChange={(e) => updateOccupant(i, { prenom: e.target.value })}
                    placeholder="Prénom occupant"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                  />
                  <input
                    value={o.nom}
                    onChange={(e) => updateOccupant(i, { nom: e.target.value })}
                    placeholder="Nom occupant"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                  />
                  <input
                    value={o.telephone}
                    onChange={(e) => updateOccupant(i, { telephone: e.target.value })}
                    type="tel"
                    placeholder="Téléphone"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                  />
                  <input
                    value={o.email}
                    onChange={(e) => updateOccupant(i, { email: e.target.value })}
                    type="email"
                    placeholder="Email (lien occupant /o/…)"
                    className="px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-[#C8C2B8] mb-1">
                    Statut accès
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { v: 'confirme', label: '✅ Confirmé' },
                        { v: 'en_attente', label: '⏳ À confirmer' },
                        { v: 'decline', label: '❌ Pas d\'accès' },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.v}
                        className={
                          'px-2 py-1.5 border rounded text-[11px] font-semibold cursor-pointer text-center ' +
                          (o.conf === opt.v
                            ? 'border-navy bg-navy-pale text-navy dark:bg-[#1B3A6B] dark:text-white dark:border-[#2A5298]'
                            : 'border-sand-border bg-white text-ink-mid dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#C8C2B8]')
                        }
                      >
                        <input
                          type="radio"
                          checked={o.conf === opt.v}
                          onChange={() => updateOccupant(i, { conf: opt.v })}
                          className="sr-only"
                        />
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
                  className="w-full px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none resize-y dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={addOccupant}
              className="w-full bg-sand-mid text-ink-mid border border-sand-border px-3 py-2 rounded-md text-[12px] font-semibold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
            >
              + Ajouter un appartement
            </button>
            {demandeurType === 'particulier' && (
              <p className="text-[10px] text-ink-muted dark:text-[#C8C2B8] italic mt-1">
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
          className="bg-sand-mid text-ink-mid px-4 py-2.5 rounded-lg text-[13px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="bg-navy text-white px-5 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Création…' : '✓ Créer l\'intervention'}
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
      <div className="bg-cream w-full sm:max-w-[640px] sm:rounded-2xl rounded-t-2xl border border-sand-border max-h-[90vh] flex flex-col shadow-2xl dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <header className="px-5 py-4 border-b border-sand-border flex items-start justify-between gap-3 flex-shrink-0 dark:border-[#2C2A24]">
          <div>
            <h2 className="text-base font-extrabold text-ink dark:text-[#F0ECE4]">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-ink-muted mt-0.5 dark:text-[#C8C2B8]">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border flex-shrink-0 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-sand-border dark:border-[#2C2A24]">
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2 dark:text-[#C8C2B8]">
        {title}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-ink-mid block mb-1.5 dark:text-[#C8C2B8]">
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
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
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
          'w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4] ' +
          (mono ? 'font-mono' : '')
        }
      />
    </div>
  );
}
