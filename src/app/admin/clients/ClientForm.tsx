'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveClient, type ClientInput } from '../facturation/actions';
import { TYPE_CLIENT_LABEL, type Client, type TypeClient } from '@/lib/types/database';

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
        <Field label="Rue et numéro" value={adresse} onChange={setAdresse} />
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
