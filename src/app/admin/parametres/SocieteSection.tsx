'use client';

import { useState, useTransition } from 'react';
import { Building2, Hourglass, RefreshCw, Send, Save } from 'lucide-react';
import { setParametre } from '../facturation/actions';

const FORMES_JURIDIQUES = ['SRL', 'SA', 'ASBL', 'Indépendant', 'Autre'] as const;
type FormeJuridique = typeof FORMES_JURIDIQUES[number];

function isFormeJuridique(v: string): v is FormeJuridique {
  return (FORMES_JURIDIQUES as readonly string[]).includes(v);
}

export function SocieteSection({ initial }: { initial: Record<string, string> }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Identité
  const [societeNom, setSocieteNom] = useState(initial['societe_nom'] ?? '');
  const initialForme = initial['societe_forme'] ?? 'SRL';
  const [societeForme, setSocieteForme] = useState<FormeJuridique>(
    isFormeJuridique(initialForme) ? initialForme : 'SRL',
  );
  const [societeTva, setSocieteTva] = useState(initial['societe_tva'] ?? '');
  const [societeBce, setSocieteBce] = useState(initial['societe_bce'] ?? '');

  // Adresse
  const [societeRue, setSocieteRue] = useState(initial['societe_rue'] ?? '');
  const [societeNumero, setSocieteNumero] = useState(initial['societe_numero'] ?? '');
  const [societeCodePostal, setSocieteCodePostal] = useState(initial['societe_code_postal'] ?? '');
  const [societeVille, setSocieteVille] = useState(initial['societe_ville'] ?? '');
  const [societePays, setSocietePays] = useState(initial['societe_pays'] ?? 'Belgique');

  // Coordonnées
  const [societeTel, setSocieteTel] = useState(initial['societe_telephone'] ?? '');
  const [societeEmail, setSocieteEmail] = useState(initial['societe_email'] ?? '');
  const [societeSite, setSocieteSite] = useState(initial['societe_site'] ?? '');

  // Bancaire
  const [societeIban, setSocieteIban] = useState(initial['societe_iban'] ?? '');
  const [societeBic, setSocieteBic] = useState(initial['societe_bic'] ?? '');
  const [societeBanque, setSocieteBanque] = useState(initial['societe_banque'] ?? '');

  // Logo
  const [societeLogoUrl, setSocieteLogoUrl] = useState(initial['societe_logo_url'] ?? '');

  async function handleLogoUpload(file: File) {
    setUploadingLogo(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const r = await fetch('/api/admin/societe/upload-logo', { method: 'POST', body: fd });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Erreur upload logo.' });
        return;
      }
      setSocieteLogoUrl(data.url as string);
      setFeedback({ kind: 'ok', msg: 'Logo mis à jour.' });
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setUploadingLogo(false);
    }
  }

  function handleSave() {
    setFeedback(null);
    startTransition(async () => {
      const results = await Promise.all([
        setParametre('societe_nom',         societeNom),
        setParametre('societe_forme',       societeForme),
        setParametre('societe_tva',         societeTva),
        setParametre('societe_bce',         societeBce),
        setParametre('societe_rue',         societeRue),
        setParametre('societe_numero',      societeNumero),
        setParametre('societe_code_postal', societeCodePostal),
        setParametre('societe_ville',       societeVille),
        setParametre('societe_pays',        societePays),
        setParametre('societe_telephone',   societeTel),
        setParametre('societe_email',       societeEmail),
        setParametre('societe_site',        societeSite),
        setParametre('societe_iban',        societeIban),
        setParametre('societe_bic',         societeBic),
        setParametre('societe_banque',      societeBanque),
      ]);
      const firstErr = results.find((r) => !r.ok);
      if (firstErr && !firstErr.ok) {
        setFeedback({ kind: 'err', msg: firstErr.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: 'Informations société sauvegardées.' });
    });
  }

  const inputCls =
    'w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid';

  return (
    <section className="bg-cream rounded-xl border border-sand-border p-5 space-y-5">
      <div>
        <h2 className="text-[13px] font-extrabold text-ink flex items-center gap-1.5">
          <Building2 size={16} aria-hidden /> Société
        </h2>
        <p className="text-[11px] text-ink-muted mt-0.5">
          Informations légales utilisées sur les factures et documents.
        </p>
      </div>

      {/* Grille 2 colonnes : Identité + Adresse */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Identité */}
        <div className="space-y-3">
          <FieldGroup label="Identité" />

          <Field label="Nom société">
            <input
              type="text"
              value={societeNom}
              onChange={(e) => setSocieteNom(e.target.value)}
              placeholder="Fox Group"
              className={inputCls}
            />
          </Field>

          <Field label="Forme juridique">
            <select
              value={societeForme}
              onChange={(e) => {
                const v = e.target.value;
                if (isFormeJuridique(v)) setSocieteForme(v);
              }}
              className={inputCls}
            >
              {FORMES_JURIDIQUES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>

          <Field label="N° TVA">
            <input
              type="text"
              value={societeTva}
              onChange={(e) => setSocieteTva(e.target.value)}
              placeholder="BE0123456789"
              className={inputCls + ' font-mono'}
            />
          </Field>

          <Field label="N° BCE">
            <input
              type="text"
              value={societeBce}
              onChange={(e) => setSocieteBce(e.target.value)}
              placeholder="0123.456.789"
              className={inputCls + ' font-mono'}
            />
          </Field>
        </div>

        {/* Adresse */}
        <div className="space-y-3">
          <FieldGroup label="Adresse" />

          <div className="grid grid-cols-[1fr_80px] gap-2">
            <Field label="Rue">
              <input
                type="text"
                value={societeRue}
                onChange={(e) => setSocieteRue(e.target.value)}
                placeholder="Stationstraat"
                className={inputCls}
              />
            </Field>
            <Field label="N°">
              <input
                type="text"
                value={societeNumero}
                onChange={(e) => setSocieteNumero(e.target.value)}
                placeholder="55"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-[100px_1fr] gap-2">
            <Field label="CP">
              <input
                type="text"
                value={societeCodePostal}
                onChange={(e) => setSocieteCodePostal(e.target.value)}
                placeholder="3070"
                className={inputCls + ' font-mono'}
              />
            </Field>
            <Field label="Ville">
              <input
                type="text"
                value={societeVille}
                onChange={(e) => setSocieteVille(e.target.value)}
                placeholder="Kortenberg"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Pays">
            <input
              type="text"
              value={societePays}
              onChange={(e) => setSocietePays(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      </div>

      {/* Coordonnées : 3 colonnes */}
      <div>
        <FieldGroup label="Coordonnées" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <Field label="Téléphone">
            <input
              type="tel"
              value={societeTel}
              onChange={(e) => setSocieteTel(e.target.value)}
              placeholder="+32 488 700 007"
              className={inputCls + ' font-mono'}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={societeEmail}
              onChange={(e) => setSocieteEmail(e.target.value)}
              placeholder="info@foxo.be"
              className={inputCls + ' font-mono'}
            />
          </Field>
          <Field label="Site web">
            <input
              type="url"
              value={societeSite}
              onChange={(e) => setSocieteSite(e.target.value)}
              placeholder="https://foxo.be"
              className={inputCls + ' font-mono'}
            />
          </Field>
        </div>
      </div>

      {/* Bancaire */}
      <div>
        <FieldGroup label="Données bancaires" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div className="sm:col-span-2">
            <Field label="IBAN">
              <input
                type="text"
                value={societeIban}
                onChange={(e) => setSocieteIban(e.target.value)}
                placeholder="BE68 5390 0754 7034"
                className={inputCls + ' font-mono'}
              />
            </Field>
          </div>
          <Field label="BIC">
            <input
              type="text"
              value={societeBic}
              onChange={(e) => setSocieteBic(e.target.value)}
              placeholder="TRIOBEBB"
              className={inputCls + ' font-mono'}
            />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Banque">
              <input
                type="text"
                value={societeBanque}
                onChange={(e) => setSocieteBanque(e.target.value)}
                placeholder="Beobank"
                className={inputCls}
              />
            </Field>
          </div>
        </div>
      </div>

      {/* Logo */}
      <div>
        <FieldGroup label="Logo" />
        {societeLogoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={societeLogoUrl}
            alt="Logo société"
            className="h-12 object-contain mb-2 mt-2"
          />
        )}
        <label className="inline-block">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            disabled={uploadingLogo}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleLogoUpload(f);
              e.currentTarget.value = '';
            }}
            className="hidden"
          />
          <span
            className={
              'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer ' +
              (uploadingLogo
                ? 'bg-sand-mid text-ink-muted cursor-wait dark:bg-[rgba(255,255,255,.06)]'
                : 'bg-sand-mid text-ink border border-sand-border hover:bg-sand-hover dark:bg-[rgba(255,255,255,.06)]')
            }
          >
            {uploadingLogo ? (
              <><Hourglass size={14} aria-hidden /> Upload…</>
            ) : societeLogoUrl ? (
              <><RefreshCw size={14} aria-hidden /> Remplacer le logo</>
            ) : (
              <><Send size={14} aria-hidden /> Uploader un logo</>
            )}
          </span>
        </label>
        <p className="text-[10px] text-ink-muted mt-1">
          jpg / png / webp / svg, max 2 Mo. L&apos;ancien logo est écrasé à chaque upload.
        </p>
      </div>

      {/* Save + feedback */}
      <div className="flex items-center gap-3 pt-2 border-t border-sand-border">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-navy text-white px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {pending ? '…' : (<><Save size={14} aria-hidden /> Enregistrer</>)}
        </button>
        {feedback && (
          <span
            className={
              'text-[11px] font-semibold ' +
              (feedback.kind === 'ok' ? 'text-ok' : 'text-terra')
            }
          >
            {feedback.msg}
          </span>
        )}
      </div>
    </section>
  );
}

// ─── Sous-composants utilitaires ─────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-ink-muted uppercase tracking-widest block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldGroup({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-bold text-navy uppercase tracking-widest border-b border-sand-border pb-1">
      {label}
    </div>
  );
}
