'use client';

import { useState, useTransition } from 'react';
import { setParametre } from '../facturation/actions';

export function ParametresClient({ initial }: { initial: Record<string, string> }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [emailComptable, setEmailComptable] = useState(initial.email_comptable ?? '');
  const [paymentTerms, setPaymentTerms] = useState(initial.payment_terms_days ?? '15');
  const [pontoEnabled, setPontoEnabled] = useState(initial.ponto_enabled === 'true');
  const [pontoApiKey, setPontoApiKey] = useState(initial.ponto_api_key ?? '');

  function save(cle: string, valeur: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await setParametre(cle, valeur);
      if (!res.ok) setFeedback({ kind: 'err', msg: res.error });
      else setFeedback({ kind: 'ok', msg: 'Paramètre enregistré.' });
    });
  }

  return (
    <div className="space-y-5 max-w-[760px]">
      {feedback && (
        <div
          className={
            'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra')
          }
        >
          {feedback.msg}
        </div>
      )}

      {/* Comptabilité */}
      <Section title="Comptabilité" desc="Destinataire des exports comptables et délais de paiement par défaut.">
        <Row
          label="Email comptable"
          hint="Reçoit le CSV mensuel quand on clique « Envoyer au comptable »."
        >
          <input
            type="email"
            value={emailComptable}
            onChange={(e) => setEmailComptable(e.target.value)}
            placeholder="comptable@cabinet.be"
            className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
          />
          <SaveBtn pending={pending} onClick={() => save('email_comptable', emailComptable)} />
        </Row>
        <Row
          label="Délai de paiement (jours)"
          hint="Date d'échéance par défaut sur les nouvelles factures."
        >
          <input
            type="number"
            min="1"
            max="120"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            className="w-24 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
          />
          <SaveBtn pending={pending} onClick={() => save('payment_terms_days', paymentTerms)} />
        </Row>
      </Section>

      {/* Ponto */}
      <Section
        title="Synchronisation bancaire (Ponto)"
        desc="Réconciliation automatique des paiements Beobank via MyPonto. Tant que ce n'est pas activé, l'import CSV manuel reste disponible depuis /admin/facturation."
      >
        <Row label="Activer Ponto" hint="Synchronisation continue des transactions et matching auto sur la communication structurée.">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer dark:text-[#F0ECE4]">
            <input
              type="checkbox"
              checked={pontoEnabled}
              onChange={(e) => setPontoEnabled(e.target.checked)}
              className="accent-[#1B3A6B]"
            />
            {pontoEnabled ? 'Activé' : 'Désactivé'}
          </label>
          <SaveBtn pending={pending} onClick={() => save('ponto_enabled', pontoEnabled ? 'true' : 'false')} />
        </Row>
        <Row label="Clé API Ponto" hint="Stockée chiffrée côté Supabase. À renseigner après création d'une connexion Ponto.">
          <input
            type="password"
            value={pontoApiKey}
            onChange={(e) => setPontoApiKey(e.target.value)}
            placeholder="••••••••••••"
            className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4] font-mono"
          />
          <SaveBtn pending={pending} onClick={() => save('ponto_api_key', pontoApiKey)} />
        </Row>
        <p className="text-[11px] text-ink-muted dark:text-[#C8C2B8] italic">
          Le branchement effectif est dans <code>src/lib/ponto.ts</code> (TODO connectPonto, syncTransactions). Quand les credentials seront disponibles, la sync s&apos;activera automatiquement.
        </p>
      </Section>

      {/* À venir */}
      <Section title="À venir" desc="Configurations encore à brancher.">
        <ul className="text-[12px] text-ink-mid leading-relaxed list-disc list-inside dark:text-[#C8C2B8]">
          <li>Coordonnées légales (BCE, TVA, IBAN, adresse) éditables</li>
          <li>Taux TVA par défaut</li>
          <li>Gestion des techniciens (ajout, suspension, accès PWA)</li>
          <li>Templates de rapports + emails</li>
          <li>Connexions Google Calendar / Drive / Gmail (placeholders dans <code>src/lib/google-*.ts</code>)</li>
          <li>Whitelists d&apos;admins</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
      <h2 className="text-sm font-extrabold text-ink mb-1 dark:text-[#F0ECE4]">{title}</h2>
      <p className="text-[12px] text-ink-mid mb-3 dark:text-[#C8C2B8]">{desc}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1 dark:text-[#C8C2B8]">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {hint && <p className="text-[10px] text-ink-muted mt-1 dark:text-[#8A8278]">{hint}</p>}
    </div>
  );
}

function SaveBtn({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
    >
      {pending ? '…' : 'Enregistrer'}
    </button>
  );
}
