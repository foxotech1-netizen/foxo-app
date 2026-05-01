'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveClient, type ClientInput } from '../facturation/actions';
import { TYPE_CLIENT_LABEL, type Client, type Organisation, type TypeClient } from '@/lib/types/database';
import { AddressAutocomplete, type AddressValue } from '@/components/AddressAutocomplete';

const TYPES: TypeClient[] = ['acp', 'particulier', 'entreprise'];

export function ClientForm({
  initial,
  redirectAfter = '/admin/clients',
}: {
  initial: Client | null;
  redirectAfter?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<TypeClient>(initial?.type ?? 'acp');
  const [nom, setNom] = useState(initial?.nom ?? '');
  const [prenom, setPrenom] = useState(initial?.prenom ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [telephone, setTelephone] = useState(initial?.telephone ?? '');
  const [adresse, setAdresse] = useState(initial?.adresse ?? '');
  const [codePostal, setCodePostal] = useState(initial?.code_postal ?? '');
  const [ville, setVille] = useState(initial?.ville ?? '');
  const [pays, setPays] = useState(initial?.pays ?? 'Belgique');
  const [bce, setBce] = useState(initial?.bce ?? '');
  const [tva, setTva] = useState(initial?.tva ?? '');
  const [contactNom, setContactNom] = useState(initial?.contact_nom ?? '');
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? '');
  const [contactTel, setContactTel] = useState(initial?.contact_telephone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  // Liens ACP → Syndic + emails dédiés
  const [syndicIdRef, setSyndicIdRef] = useState<string | null>(initial?.syndic_id_ref ?? null);
  const [emailFactures, setEmailFactures] = useState(initial?.email_factures ?? '');
  const [emailRapports, setEmailRapports] = useState(initial?.email_rapports ?? '');
  const [emailComm, setEmailComm] = useState(initial?.email_communications ?? '');

  // Liste des syndics chargée à la demande quand type='acp'
  const [syndics, setSyndics] = useState<Organisation[]>([]);
  const [syndicsLoading, setSyndicsLoading] = useState(false);
  const [syndicSearch, setSyndicSearch] = useState('');
  const [showCreateSyndic, setShowCreateSyndic] = useState(false);

  useEffect(() => {
    if (type !== 'acp') return;
    let mounted = true;
    setSyndicsLoading(true);
    fetch('/api/admin/organisations?type=syndic', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) setSyndics(data.organisations ?? []);
      })
      .catch(() => { /* noop */ })
      .finally(() => { if (mounted) setSyndicsLoading(false); });
    return () => { mounted = false; };
  }, [type]);

  const selectedSyndic = syndics.find((s) => s.id === syndicIdRef) ?? null;

  const filteredSyndics = syndicSearch.trim()
    ? syndics.filter((s) => {
        const q = syndicSearch.toLowerCase();
        return s.nom.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
      })
    : syndics;

  function pickSyndic(s: Organisation) {
    setSyndicIdRef(s.id);
    setSyndicSearch('');
    // Auto-fill billing email + rapport email si vides
    if (!emailFactures && s.email_factures) setEmailFactures(s.email_factures);
    if (!emailRapports && s.email_rapports) setEmailRapports(s.email_rapports);
    if (!emailComm && s.email_communications) setEmailComm(s.email_communications);
    // Adresse facturation = adresse du syndic si vide
    if (!adresse && s.adresse) setAdresse(s.adresse);
  }

  function submit() {
    setError(null);
    const input: ClientInput = {
      id: initial?.id,
      type, nom, prenom, email, telephone,
      adresse, code_postal: codePostal, ville, pays,
      bce, tva,
      contact_nom: contactNom, contact_email: contactEmail, contact_telephone: contactTel,
      notes,
      actif: initial?.actif ?? true,
      syndic_id_ref: type === 'acp' ? syndicIdRef : null,
      email_factures: type === 'acp' ? emailFactures : null,
      email_rapports: type === 'acp' ? emailRapports : null,
      email_communications: type === 'acp' ? emailComm : null,
    };
    startTransition(async () => {
      const res = await saveClient(input);
      if (!res.ok) { setError(res.error); return; }
      router.push(`${redirectAfter}?id=${res.data!.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 max-w-[760px]">
      <Section title="Type de client">
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={
                'px-3 py-2 rounded-lg text-[13px] font-bold border-2 ' +
                (type === t
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink border-sand-border hover:border-navy-mid dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
              }
            >
              {TYPE_CLIENT_LABEL[t]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Coordonnées">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {type === 'particulier' && (
            <Field label="Prénom" value={prenom} onChange={setPrenom} />
          )}
          <Field label={type === 'particulier' ? 'Nom *' : 'Nom *'} value={nom} onChange={setNom} />
          <Field label="Email" type="email" value={email} onChange={setEmail} />
          <Field label="Téléphone" type="tel" value={telephone} onChange={setTelephone} />
        </div>
      </Section>

      <Section title="Adresse">
        <AddressAutocomplete
          label="Rue et numéro"
          value={{
            adresse,
            rue: '',
            numero: '',
            code_postal: codePostal,
            ville,
            pays: pays || 'Belgique',
            lat: null,
            lng: null,
            verified: false,
          } as AddressValue}
          onChange={(addr) => {
            // addr.adresse est :
            //   - le texte tapé en saisie manuelle, OU
            //   - la composition rue+numéro après sélection Nominatim
            // Dans les deux cas on prend tel quel — pas de re-composition
            // ici sinon on perdrait des caractères (cf. bug 2026-05-19).
            setAdresse(addr.adresse);
            if (addr.code_postal) setCodePostal(addr.code_postal);
            if (addr.ville) setVille(addr.ville);
            if (addr.pays) setPays(addr.pays);
          }}
          placeholder="Commence à taper la rue…"
        />
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Field label="Code postal" value={codePostal} onChange={setCodePostal} />
          <div className="col-span-2">
            <Field label="Ville" value={ville} onChange={setVille} />
          </div>
        </div>
        <div className="mt-2">
          <Field label="Pays" value={pays} onChange={setPays} />
        </div>
      </Section>

      {(type === 'acp' || type === 'entreprise') && (
        <>
          <Section title="Identifiants légaux">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Numéro BCE" value={bce} onChange={setBce} placeholder="BE0123.456.789" mono />
              <Field label="Numéro TVA" value={tva} onChange={setTva} placeholder="BE0123.456.789" mono />
            </div>
          </Section>

          <Section title="Contact référent">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Nom" value={contactNom} onChange={setContactNom} />
              <Field label="Email" type="email" value={contactEmail} onChange={setContactEmail} />
              <Field label="Téléphone" type="tel" value={contactTel} onChange={setContactTel} />
            </div>
          </Section>
        </>
      )}

      {type === 'acp' && (
        <Section title="Syndic gestionnaire">
          {selectedSyndic ? (
            <div className="bg-navy-pale border border-navy-light rounded-lg p-3 mb-2 dark:bg-[#1A2540] dark:border-[#2C4878]">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-[13px] text-navy dark:text-[#A8C4F2]">
                    🏢 {selectedSyndic.nom}
                  </div>
                  <div className="text-[11px] font-mono text-ink-mid mt-0.5 dark:text-[#C8C2B8]">
                    {selectedSyndic.email}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSyndicIdRef(null)}
                  className="text-[10px] text-terra hover:underline flex-shrink-0"
                >
                  ✕ Retirer
                </button>
              </div>
            </div>
          ) : (
            <>
              <input
                value={syndicSearch}
                onChange={(e) => setSyndicSearch(e.target.value)}
                placeholder={syndicsLoading ? 'Chargement…' : `Rechercher parmi ${syndics.length} syndics`}
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid mb-2 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
              />
              {filteredSyndics.length > 0 && (
                <ul className="max-h-[160px] overflow-y-auto bg-cream border border-sand-border rounded-lg divide-y divide-sand-mid mb-2 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                  {filteredSyndics.slice(0, 20).map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => pickSyndic(s)}
                        className="w-full text-left px-3 py-1.5 hover:bg-navy-pale dark:hover:bg-[#2A2520]"
                      >
                        <div className="text-[12px] font-bold text-ink dark:text-[#F0ECE4]">{s.nom}</div>
                        <div className="text-[10px] font-mono text-ink-muted dark:text-[#C8C2B8]">{s.email}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setShowCreateSyndic((v) => !v)}
                className="text-[11px] text-navy hover:underline font-bold dark:text-[#A8C4F2]"
              >
                {showCreateSyndic ? '✕ Annuler' : '➕ Nouveau syndic'}
              </button>
              {showCreateSyndic && (
                <NewSyndicInline
                  onCreated={(s) => {
                    setSyndics((arr) => [s, ...arr]);
                    pickSyndic(s);
                    setShowCreateSyndic(false);
                  }}
                  onCancel={() => setShowCreateSyndic(false)}
                />
              )}
            </>
          )}
          <p className="text-[10px] text-ink-muted mt-2 italic dark:text-[#C8C2B8]">
            Optionnel. Si renseigné, l&apos;adresse de facturation et les emails dédiés sont
            pré-remplis depuis le syndic (modifiables).
          </p>
        </Section>
      )}

      {type === 'acp' && (
        <Section title="📧 Emails dédiés">
          <div className="space-y-2">
            <DedicatedEmailField
              label="Email factures"
              value={emailFactures}
              onChange={setEmailFactures}
              fallback={selectedSyndic?.email_factures ?? selectedSyndic?.email ?? null}
              syndicNom={selectedSyndic?.nom ?? null}
            />
            <DedicatedEmailField
              label="Email rapports"
              value={emailRapports}
              onChange={setEmailRapports}
              fallback={selectedSyndic?.email_rapports ?? selectedSyndic?.email ?? null}
              syndicNom={selectedSyndic?.nom ?? null}
            />
            <DedicatedEmailField
              label="Email communications"
              value={emailComm}
              onChange={setEmailComm}
              fallback={selectedSyndic?.email_communications ?? selectedSyndic?.email ?? null}
              syndicNom={selectedSyndic?.nom ?? null}
            />
          </div>
        </Section>
      )}

      <Section title="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Notes internes (visibles uniquement par l'admin)"
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
        />
      </Section>

      {error && (
        <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-lg px-3 py-2 font-semibold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={pending}
          className="bg-sand-mid text-ink-mid py-3 rounded-xl font-bold text-[13px] disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="bg-navy text-white py-3 rounded-xl font-bold text-[13px] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? '…' : initial ? 'Enregistrer' : 'Créer le client'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-3 dark:text-[#C8C2B8]">
        {title}
      </div>
      {children}
    </section>
  );
}

function DedicatedEmailField({
  label, value, onChange, fallback, syndicNom,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string | null;
  syndicNom: string | null;
}) {
  const placeholder = fallback && syndicNom
    ? `Hérite de ${syndicNom} : ${fallback}`
    : fallback ?? '';
  return (
    <div>
      <label className="text-xs font-semibold text-ink-mid block mb-1.5 dark:text-[#C8C2B8]">{label}</label>
      <input
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
      />
    </div>
  );
}

function NewSyndicInline({
  onCreated, onCancel,
}: {
  onCreated: (org: Organisation) => void;
  onCancel: () => void;
}) {
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [telephone, setTelephone] = useState('');
  const [adresse, setAdresse] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!nom.trim() || !email.trim()) {
      setError('Nom et email requis.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/organisations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'syndic',
          nom: nom.trim(),
          email: email.trim().toLowerCase(),
          telephone: telephone.trim() || null,
          adresse: adresse.trim() || null,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Échec création.');
        return;
      }
      onCreated(data.organisation as Organisation);
    } finally {
      setSaving(false);
    }
  }

  const cls = 'w-full px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid';

  return (
    <div className="bg-navy-pale border border-navy-light rounded-lg p-3 mt-2 dark:bg-[#1A2540] dark:border-[#2C4878]">
      <div className="text-[11px] font-bold text-navy mb-2 dark:text-[#A8C4F2]">
        Nouveau syndic
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom *" className={cls + ' col-span-2'} />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" className={cls + ' col-span-2 font-mono'} />
        <input value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="Téléphone" className={cls + ' font-mono'} />
        <input value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder="Adresse" className={cls} />
      </div>
      {error && <p className="text-[11px] text-terra mt-1.5">{error}</p>}
      <div className="flex justify-end gap-1.5 mt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-[10px] bg-sand-mid text-ink-mid px-2 py-1 rounded font-bold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={create}
          disabled={saving || !nom.trim() || !email.trim()}
          className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold disabled:opacity-50"
        >
          {saving ? '…' : 'Créer'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-ink-mid block mb-1.5 dark:text-[#C8C2B8]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          'w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid ' +
          (mono ? 'font-mono' : '')
        }
      />
    </div>
  );
}
