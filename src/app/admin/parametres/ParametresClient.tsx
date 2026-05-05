'use client';

import { useEffect, useState, useTransition } from 'react';
import { setParametre } from '../facturation/actions';
import { testSmsAction } from '../sms/actions';
import {
  getGoogleStatus,
  disconnectGoogle,
  testGoogleDrive,
  testGoogleCalendar,
  testGmail,
} from '../google/actions';
import {
  triggerCheckMailsNow, getMailLastCheck,
  getCalendarWatchStatus, subscribeCalendarWatchAction,
  unsubscribeCalendarWatchAction, renewCalendarWatchAction,
  type CalendarWatchStatus,
} from './actions';
import { SocieteSection } from './SocieteSection';
import { ThemePicker } from '@/components/ThemePicker';

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'jamais';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'jamais';
  const diffMs = Date.now() - t;
  if (diffMs < 0) return 'à l’instant';
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

const SMS_TEMPLATE_DEFAULTS: Record<string, string> = {
  sms_template_confirmation:
    'Bonjour [Prénom], FoxO interviendra le [date] à [heure] pour [adresse]. Confirmez votre présence : [lien]',
  sms_template_rappel_24h:
    'Rappel FoxO : intervention demain [date] à [heure] — [adresse]. Contact : 0488/700.007',
  sms_template_rapport:
    'FoxO — Votre rapport est disponible : [lien]',
  sms_template_lien_occupant:
    'FoxO — Confirmez votre présence pour le [date] : [lien]',
};

export function ParametresClient({ initial }: { initial: Record<string, string> }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [emailComptable, setEmailComptable] = useState(initial.email_comptable ?? '');
  const [paymentTerms, setPaymentTerms] = useState(initial.payment_terms_days ?? '15');
  const [pontoEnabled, setPontoEnabled] = useState(initial.ponto_enabled === 'true');
  const [pontoApiKey, setPontoApiKey] = useState(initial.ponto_api_key ?? '');

  // SMS
  const [smsMode, setSmsMode] = useState(initial.sms_mode ?? 'manuel');
  const [smsEnabled, setSmsEnabled] = useState(initial.sms_enabled === 'true');
  const [waEnabled, setWaEnabled] = useState(initial.whatsapp_enabled === 'true');
  const [smsAutoConf, setSmsAutoConf] = useState(initial.sms_auto_confirmation === 'true');
  const [smsAutoRappel, setSmsAutoRappel] = useState(initial.sms_auto_rappel_24h === 'true');
  const [mailAutoAnalyse, setMailAutoAnalyse] = useState(initial.mail_auto_analyse === 'true');
  const [mailLastCheck, setMailLastCheck] = useState<string | null>(initial.mail_last_check || null);
  const [mailCheckResult, setMailCheckResult] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Calendar Watch
  const [watch, setWatch] = useState<CalendarWatchStatus | null>(null);
  const [watchMsg, setWatchMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [smsAutoRapport, setSmsAutoRapport] = useState(initial.sms_auto_rapport === 'true');
  const [twilioSid, setTwilioSid] = useState(initial.twilio_account_sid ?? '');
  const [twilioToken, setTwilioToken] = useState(initial.twilio_auth_token ?? '');
  const [twilioSmsFrom, setTwilioSmsFrom] = useState(initial.twilio_phone_number ?? '');
  const [twilioWaFrom, setTwilioWaFrom] = useState(initial.twilio_whatsapp_number ?? '');
  const [tplConf, setTplConf] = useState(initial.sms_template_confirmation ?? SMS_TEMPLATE_DEFAULTS.sms_template_confirmation);
  const [tplRappel, setTplRappel] = useState(initial.sms_template_rappel_24h ?? SMS_TEMPLATE_DEFAULTS.sms_template_rappel_24h);
  const [tplRapport, setTplRapport] = useState(initial.sms_template_rapport ?? SMS_TEMPLATE_DEFAULTS.sms_template_rapport);
  const [tplLien, setTplLien] = useState(initial.sms_template_lien_occupant ?? SMS_TEMPLATE_DEFAULTS.sms_template_lien_occupant);
  const [testNumber, setTestNumber] = useState('');

  // Google
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; email: string | null; expiry: string | null }>(
    { connected: false, email: null, expiry: null },
  );
  const [googleLoading, setGoogleLoading] = useState(true);
  const [googleTestMsg, setGoogleTestMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  type DriveFolderStatus = { ok: boolean; id: string | null; name?: string; status?: number; error?: string; trashed?: boolean };
  type DriveScopes = { granted: string[]; missing: string[]; has_drive_full: boolean; has_drive_file_only: boolean; account: string | null };
  const [driveTest, setDriveTest] = useState<{ rapports: DriveFolderStatus; factures: DriveFolderStatus; scopes?: DriveScopes } | null>(null);

  useEffect(() => {
    let mounted = true;
    setGoogleLoading(true);
    getGoogleStatus().then((res) => {
      if (!mounted) return;
      if (res.ok && res.data) {
        setGoogleStatus({ connected: res.data.connected, email: res.data.email, expiry: res.data.expiry });
      }
      setGoogleLoading(false);
    });
    // Si on revient du callback OAuth, lit les params pour afficher le statut
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const g = sp.get('google');
      if (g === 'ok') setGoogleTestMsg({ kind: 'ok', msg: 'Compte Google connecté ✓' });
      if (g === 'err') setGoogleTestMsg({ kind: 'err', msg: sp.get('msg') ?? 'Échec connexion Google' });
    }
    return () => { mounted = false; };
  }, []);

  // Charge le statut de la subscription Calendar Watch au mount
  useEffect(() => {
    let mounted = true;
    getCalendarWatchStatus().then((res) => {
      if (mounted && res.ok && res.data) setWatch(res.data);
    });
    return () => { mounted = false; };
  }, []);

  function refreshGoogleStatus() {
    getGoogleStatus().then((res) => {
      if (res.ok && res.data) {
        setGoogleStatus({ connected: res.data.connected, email: res.data.email, expiry: res.data.expiry });
      }
    });
  }
  const [testChannel, setTestChannel] = useState<'sms' | 'whatsapp'>('sms');
  const twilioReady = Boolean(twilioSid && twilioToken && twilioSmsFrom);

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
      <ThemePicker />
      <SocieteSection initial={initial} />

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

      {/* Planning — couleurs */}
      <Section title="🗓️ Couleurs du planning" desc="Couleurs des créneaux par type et par technicien. S'appliquent dans /admin/planning et sur les events Google Calendar (mappés sur le colorId le plus proche).">
        <PlanningCouleursPanel />
      </Section>

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

      {/* SMS / WhatsApp */}
      <Section
        title="Notifications SMS / WhatsApp"
        desc="Envoi de SMS aux occupants et au syndic via Twilio. Mode manuel par défaut : tu valides chaque envoi. Mode automatique : envoi sans intervention sur certains événements."
      >
        <Row label="Mode d'envoi" hint="Mode automatique = envoi sans confirmation à chaque événement (à activer prudemment).">
          <div className="grid grid-cols-2 gap-2 w-full sm:w-[280px]">
            <button
              type="button"
              onClick={() => { setSmsMode('manuel'); save('sms_mode', 'manuel'); }}
              className={
                'px-3 py-2 rounded-lg text-[12px] font-bold border-2 ' +
                (smsMode === 'manuel'
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink border-sand-border dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
              }
            >
              Manuel
            </button>
            <button
              type="button"
              onClick={() => { setSmsMode('auto'); save('sms_mode', 'auto'); }}
              className={
                'px-3 py-2 rounded-lg text-[12px] font-bold border-2 ' +
                (smsMode === 'auto'
                  ? 'bg-[#A17244] text-white border-[#A17244]'
                  : 'bg-white text-ink border-sand-border dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
              }
            >
              Automatique
            </button>
          </div>
        </Row>

        {smsMode === 'auto' && (
          <div className="bg-amber-light border border-[#E8C896] rounded-lg p-3 text-[12px] text-[#8A5A1A] dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]">
            ⚠ Mode automatique actif — les SMS partent sans confirmation manuelle. Active uniquement les toggles ci-dessous quand tu es sûr du contenu.
          </div>
        )}

        {smsMode === 'auto' && (
          <>
            <ToggleRow
              label="Confirmation créneau → SMS occupants"
              checked={smsAutoConf}
              onChange={(v) => { setSmsAutoConf(v); save('sms_auto_confirmation', String(v)); }}
            />
            <ToggleRow
              label="Rappel 24h avant → SMS occupants"
              checked={smsAutoRappel}
              onChange={(v) => { setSmsAutoRappel(v); save('sms_auto_rappel_24h', String(v)); }}
            />
            <ToggleRow
              label="Rapport disponible → SMS syndic"
              checked={smsAutoRapport}
              onChange={(v) => { setSmsAutoRapport(v); save('sms_auto_rapport', String(v)); }}
            />
          </>
        )}

        <div className="border-t border-sand-border dark:border-[#3D3A32] pt-3 mt-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2 dark:text-[#C8C2B8]">
            Configuration Twilio
          </div>

          <ToggleRow
            label="SMS activé"
            checked={smsEnabled}
            onChange={(v) => { setSmsEnabled(v); save('sms_enabled', String(v)); }}
          />
          <ToggleRow
            label="WhatsApp activé"
            checked={waEnabled}
            onChange={(v) => { setWaEnabled(v); save('whatsapp_enabled', String(v)); }}
          />

          <Row label="Twilio Account SID">
            <input
              value={twilioSid}
              onChange={(e) => setTwilioSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxx"
              className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
            />
            <SaveBtn pending={pending} onClick={() => save('twilio_account_sid', twilioSid)} />
          </Row>
          <Row label="Twilio Auth Token">
            <input
              type="password"
              value={twilioToken}
              onChange={(e) => setTwilioToken(e.target.value)}
              placeholder="••••••••••••"
              className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
            />
            <SaveBtn pending={pending} onClick={() => save('twilio_auth_token', twilioToken)} />
          </Row>
          <Row label="Numéro SMS Twilio" hint="Format E.164 : +32...">
            <input
              value={twilioSmsFrom}
              onChange={(e) => setTwilioSmsFrom(e.target.value)}
              placeholder="+32..."
              className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
            />
            <SaveBtn pending={pending} onClick={() => save('twilio_phone_number', twilioSmsFrom)} />
          </Row>
          <Row label="Numéro WhatsApp Twilio" hint="Format E.164 : +14155238886 (sandbox) ou ton numéro approuvé.">
            <input
              value={twilioWaFrom}
              onChange={(e) => setTwilioWaFrom(e.target.value)}
              placeholder="+14155238886"
              className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
            />
            <SaveBtn pending={pending} onClick={() => save('twilio_whatsapp_number', twilioWaFrom)} />
          </Row>

          <p className="text-[11px] text-ink-muted italic mt-2 dark:text-[#C8C2B8]">
            Crée un compte sur <a href="https://www.twilio.com" target="_blank" rel="noopener noreferrer" className="text-navy underline dark:text-[#A8C4F2]">twilio.com</a> pour activer les SMS. Pour Vercel : ajoute aussi les variables d&apos;env <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_PHONE_NUMBER</code>, <code>TWILIO_WHATSAPP_NUMBER</code> (priorité sur la DB).
          </p>

          {twilioReady && (
            <div className="mt-3 bg-cream border border-sand-border rounded-lg p-3 dark:bg-[#221E1A] dark:border-[#3D3A32]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2 dark:text-[#C8C2B8]">
                Tester l&apos;envoi
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <input
                  value={testNumber}
                  onChange={(e) => setTestNumber(e.target.value)}
                  placeholder="+32 488 12 34 56"
                  className="flex-1 min-w-[180px] px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
                />
                <select
                  value={testChannel}
                  onChange={(e) => setTestChannel(e.target.value as 'sms' | 'whatsapp')}
                  className="px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white"
                >
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!testNumber.trim()) {
                      setFeedback({ kind: 'err', msg: 'Numéro vide.' });
                      return;
                    }
                    startTransition(async () => {
                      const res = await testSmsAction({ to: testNumber, channel: testChannel });
                      if (res.ok) setFeedback({ kind: 'ok', msg: 'Test envoyé ✓' });
                      else setFeedback({ kind: 'err', msg: res.error });
                    });
                  }}
                  disabled={pending}
                  className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
                >
                  Envoyer le test
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-sand-border dark:border-[#3D3A32] pt-3 mt-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2 dark:text-[#C8C2B8]">
            Templates SMS
          </div>
          <p className="text-[11px] text-ink-muted mb-3 dark:text-[#C8C2B8]">
            Variables disponibles : <code>[Prénom]</code>, <code>[date]</code>, <code>[heure]</code>, <code>[adresse]</code>, <code>[lien]</code>
          </p>

          <TemplateRow
            label="Confirmation créneau"
            cle="sms_template_confirmation"
            value={tplConf}
            setValue={setTplConf}
            onSave={save}
            pending={pending}
          />
          <TemplateRow
            label="Rappel 24h avant"
            cle="sms_template_rappel_24h"
            value={tplRappel}
            setValue={setTplRappel}
            onSave={save}
            pending={pending}
          />
          <TemplateRow
            label="Rapport disponible"
            cle="sms_template_rapport"
            value={tplRapport}
            setValue={setTplRapport}
            onSave={save}
            pending={pending}
          />
          <TemplateRow
            label="Lien occupant"
            cle="sms_template_lien_occupant"
            value={tplLien}
            setValue={setTplLien}
            onSave={save}
            pending={pending}
          />
        </div>
      </Section>

      {/* Google — OAuth Drive + Gmail + Calendar */}
      <Section
        title="Intégrations Google"
        desc="Connecte un compte Google pour brancher Drive (rapports + factures), Gmail (lecture pour enrichir l'assistant) et Calendar (sync des créneaux)."
      >
        {googleLoading ? (
          <div className="text-[12px] text-ink-muted dark:text-[#C8C2B8]">Chargement du statut…</div>
        ) : googleStatus.connected ? (
          <div className="bg-ok-light border border-ok-mid rounded-lg p-3 text-[12px] text-ok dark:bg-[#14281E] dark:border-[#2A4F3A] dark:text-[#7AC9A0]">
            ✓ Connecté en tant que <strong className="font-mono">{googleStatus.email ?? '—'}</strong>
            {googleStatus.expiry && (
              <span className="block text-[10px] text-ink-muted dark:text-[#C8C2B8] mt-1">
                Token expire : {new Date(googleStatus.expiry).toLocaleString('fr-BE')}
              </span>
            )}
          </div>
        ) : (
          <div className="bg-amber-light border border-[#E8C896] rounded-lg p-3 text-[12px] text-[#8A5A1A] dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]">
            Aucun compte Google connecté.
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-3">
          {googleStatus.connected ? (
            <button
              type="button"
              onClick={() => {
                if (!confirm('Déconnecter le compte Google ?')) return;
                startTransition(async () => {
                  const res = await disconnectGoogle();
                  if (res.ok) {
                    setGoogleTestMsg({ kind: 'ok', msg: 'Compte déconnecté.' });
                    refreshGoogleStatus();
                  } else {
                    setGoogleTestMsg({ kind: 'err', msg: res.error });
                  }
                });
              }}
              className="bg-terra-light text-terra border border-terra-mid px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 dark:bg-[#5A2E18] dark:text-[#FFB897] dark:border-[#7A3F22]"
            >
              Déconnecter
            </button>
          ) : (
            <a
              href="/api/google/auth"
              className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center min-h-[44px]"
            >
              🔗 Connecter Google
            </a>
          )}

          {googleStatus.connected && (
            <>
              <button
                type="button"
                onClick={() => {
                  setGoogleTestMsg(null);
                  setDriveTest(null);
                  startTransition(async () => {
                    try {
                      const r = await fetch('/api/google/test-drive', { cache: 'no-store' });
                      const data = await r.json();
                      if (!data.ok) {
                        setGoogleTestMsg({ kind: 'err', msg: data.error ?? 'Erreur inconnue' });
                        return;
                      }
                      setDriveTest({ rapports: data.rapports, factures: data.factures, scopes: data.scopes });
                      const allOk = data.rapports?.ok && data.factures?.ok;
                      const scopeIssue = data.scopes?.has_drive_file_only || (data.scopes?.missing?.length ?? 0) > 0;
                      setGoogleTestMsg(
                        allOk
                          ? { kind: 'ok', msg: 'Drive : les 2 dossiers racines sont accessibles ✓' }
                          : scopeIssue
                            ? { kind: 'err', msg: 'Scopes OAuth insuffisants — déconnecte puis reconnecte Google pour ré-accorder les permissions complètes.' }
                            : { kind: 'err', msg: 'Drive : un ou plusieurs dossiers inaccessibles — voir détails ci-dessous.' },
                      );
                    } catch (e) {
                      setGoogleTestMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
                    }
                  });
                }}
                className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-[12px] font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
              >
                Tester Drive
              </button>
              <button
                type="button"
                onClick={() => {
                  setGoogleTestMsg(null);
                  startTransition(async () => {
                    const res = await testGmail();
                    if (res.ok) setGoogleTestMsg({ kind: 'ok', msg: `Gmail : ${res.data?.count ?? 0} messages récents accessibles ✓` });
                    else setGoogleTestMsg({ kind: 'err', msg: res.error });
                  });
                }}
                className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-[12px] font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
              >
                Tester Gmail
              </button>
              <button
                type="button"
                onClick={() => {
                  setGoogleTestMsg(null);
                  startTransition(async () => {
                    const res = await testGoogleCalendar();
                    if (res.ok) setGoogleTestMsg({ kind: 'ok', msg: `Calendar : ${res.data?.count ?? 0} événements aujourd'hui ✓` });
                    else setGoogleTestMsg({ kind: 'err', msg: res.error });
                  });
                }}
                className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-[12px] font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
              >
                Tester Calendar
              </button>
            </>
          )}
        </div>

        {googleTestMsg && (
          <div className={
            'mt-3 text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (googleTestMsg.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A]'
              : 'bg-terra-light border-terra-mid text-terra')
          }>
            {googleTestMsg.msg}
          </div>
        )}

        {driveTest?.scopes && driveTest.scopes.has_drive_file_only && (
          <div className="mt-3 bg-terra-light border border-terra-mid text-terra rounded-lg p-3 text-[12px] dark:bg-[#2E1A12] dark:border-[#5A2E18] dark:text-[#FFB897]">
            <div className="font-bold mb-1">⚠ Scope Drive insuffisant : <code>drive.file</code> au lieu de <code>drive</code></div>
            <p className="leading-relaxed">
              Ton token Google n&apos;a accès qu&apos;aux fichiers créés par l&apos;app — pas aux dossiers existants.
              Clique <strong>Déconnecter</strong> puis <strong>Connecter Google</strong> à nouveau et accepte
              tous les scopes lors du re-consentement.
            </p>
          </div>
        )}

        {driveTest?.scopes && driveTest.scopes.missing.length > 0 && (
          <div className="mt-3 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg p-3 text-[12px] dark:bg-[#2A220E] dark:border-[#5A4A30] dark:text-[#E8C896]">
            <div className="font-bold mb-1">⚠ Scopes manquants ({driveTest.scopes.missing.length})</div>
            <ul className="list-disc list-inside font-mono text-[11px]">
              {driveTest.scopes.missing.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        )}

        {driveTest && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <DriveFolderCard label="RAPPORTS" envKey="GOOGLE_DRIVE_RAPPORTS_FOLDER_ID" status={driveTest.rapports} />
            <DriveFolderCard label="FACTURES" envKey="GOOGLE_DRIVE_FACTURES_FOLDER_ID" status={driveTest.factures} />
          </div>
        )}

        <p className="text-[11px] text-ink-muted italic mt-3 dark:text-[#C8C2B8]">
          Variables d&apos;env Vercel requises : <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>,
          <code>GOOGLE_DRIVE_RAPPORTS_FOLDER_ID</code>, <code>GOOGLE_DRIVE_FACTURES_FOLDER_ID</code>,
          <code>NEXT_PUBLIC_APP_URL</code>. Le redirect_uri doit être déclaré côté Google Cloud :{' '}
          <code>{'<NEXT_PUBLIC_APP_URL>/api/google/callback'}</code>.
        </p>
      </Section>

      {/* Mail auto-analyse */}
      <Section
        title="Analyse automatique des mails"
        desc="Le cron /api/cron/check-mails (toutes les 30 min) lit les mails non lus de la boîte connectée, demande à Claude si c'est une demande d'intervention, et crée un dossier en statut « nouvelle » avec source=mail. Aucun envoi automatique vers les clients — tu garderas le contrôle pour planifier."
      >
        <ToggleRow
          label="Activer l'analyse automatique"
          checked={mailAutoAnalyse}
          onChange={(v) => { setMailAutoAnalyse(v); save('mail_auto_analyse', String(v)); }}
        />
        {mailAutoAnalyse && (
          <div className="mt-2 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg px-3 py-2 text-[11px] dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]">
            ⚠ Le cron tournera toutes les 30 min. Vérifie d&apos;abord que Google est connecté (scope <code>gmail.readonly</code>) et fais un test à blanc :
            <code className="block mt-1 font-mono text-[10px] break-all">
              GET /api/cron/check-mails/preview?secret={'<CRON_SECRET>'}
            </code>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setMailCheckResult(null);
              startTransition(async () => {
                const res = await triggerCheckMailsNow();
                if (!res.ok) {
                  setMailCheckResult({ kind: 'err', msg: res.error });
                  return;
                }
                const d = res.data!;
                setMailCheckResult({
                  kind: 'ok',
                  msg: `Vérification OK — ${d.created} créé(s), ${d.labeled_lu} non-demande(s), ${d.skipped} ignoré(s), ${d.errors} erreur(s).`,
                });
                const r = await getMailLastCheck();
                if (r.ok) setMailLastCheck(r.data?.value ?? null);
              });
            }}
            disabled={pending}
            className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Vérification…' : 'Vérifier maintenant'}
          </button>
          <span className="text-[11px] text-ink-muted dark:text-[#C8C2B8]">
            Dernière vérification : <strong>{formatRelative(mailLastCheck)}</strong>
          </span>
        </div>

        {mailCheckResult && (
          <div className={
            'mt-2 text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (mailCheckResult.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A]'
              : 'bg-terra-light border-terra-mid text-terra')
          }>
            {mailCheckResult.msg}
          </div>
        )}

        <p className="text-[11px] text-ink-muted mt-2 italic dark:text-[#C8C2B8]">
          Mails labelisés <code>FOXO_TRAITE</code> (demande convertie) ou <code>FOXO_LU</code> (pas une demande) après passage. Aucun mail n&apos;est traité deux fois.
        </p>
      </Section>

      {/* Calendar Watch (push notifications) */}
      <Section
        title="Synchronisation Google Calendar (Watch API)"
        desc="Subscription push qui notifie FoxO en temps réel des changements Calendar (création, modification, suppression d'events). Renouvelée auto chaque jour à 6h UTC via GitHub Actions ; expiration max ~7j."
      >
        <CalendarWatchPanel
          watch={watch}
          msg={watchMsg}
          pending={pending}
          onSubscribe={() => {
            setWatchMsg(null);
            startTransition(async () => {
              const res = await subscribeCalendarWatchAction();
              if (!res.ok) { setWatchMsg({ kind: 'err', msg: res.error }); return; }
              setWatch(res.data ?? null);
              setWatchMsg({ kind: 'ok', msg: 'Subscription créée ✓' });
            });
          }}
          onRenew={() => {
            setWatchMsg(null);
            startTransition(async () => {
              const res = await renewCalendarWatchAction();
              if (!res.ok) { setWatchMsg({ kind: 'err', msg: res.error }); return; }
              setWatch(res.data ?? null);
              setWatchMsg({ kind: 'ok', msg: 'Subscription renouvelée ✓' });
            });
          }}
          onUnsubscribe={() => {
            if (!confirm('Désactiver la subscription push Calendar ?')) return;
            setWatchMsg(null);
            startTransition(async () => {
              const res = await unsubscribeCalendarWatchAction();
              if (!res.ok) { setWatchMsg({ kind: 'err', msg: res.error }); return; }
              setWatch(res.data ?? null);
              setWatchMsg({ kind: 'ok', msg: 'Subscription désactivée ✓' });
            });
          }}
        />
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

function CalendarWatchPanel({
  watch, msg, pending, onSubscribe, onRenew, onUnsubscribe,
}: {
  watch: CalendarWatchStatus | null;
  msg: { kind: 'ok' | 'err'; msg: string } | null;
  pending: boolean;
  onSubscribe: () => void;
  onRenew: () => void;
  onUnsubscribe: () => void;
}) {
  if (!watch) {
    return <div className="text-[12px] text-ink-muted dark:text-[#C8C2B8]">Chargement du statut…</div>;
  }
  const banner = (() => {
    if (watch.status === 'active') {
      return {
        cls: 'bg-ok-light border-ok-mid text-ok dark:bg-[#14281E] dark:border-[#2A4F3A] dark:text-[#7AC9A0]',
        text: <>✅ Active — expire le <strong className="font-mono">{watch.expiry_iso ? new Date(watch.expiry_iso).toLocaleString('fr-BE') : '?'}</strong></>,
      };
    }
    if (watch.status === 'expiring_soon') {
      return {
        cls: 'bg-amber-light border-[#E8C896] text-[#8A5A1A] dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]',
        text: <>⚠️ Expire dans moins de 24h — <strong className="font-mono">{watch.expiry_iso ? new Date(watch.expiry_iso).toLocaleString('fr-BE') : '?'}</strong>. Le cron quotidien renouvellera automatiquement.</>,
      };
    }
    if (watch.status === 'expired') {
      return {
        cls: 'bg-terra-light border-terra-mid text-terra dark:bg-[#2E1A12] dark:border-[#5A2E18] dark:text-[#FFB897]',
        text: <>❌ Expirée — <strong className="font-mono">{watch.expiry_iso ? new Date(watch.expiry_iso).toLocaleString('fr-BE') : '?'}</strong>. Cliquer « Activer » pour en créer une nouvelle.</>,
      };
    }
    return {
      cls: 'bg-sand-mid border-sand-border text-ink-mid dark:bg-[rgba(255,255,255,.04)] dark:border-[#3D3A32] dark:text-[#C8C2B8]',
      text: <>❌ Inactive — aucun push Calendar ne sera reçu tant qu&apos;une subscription n&apos;est pas créée.</>,
    };
  })();

  return (
    <>
      <div className={'rounded-md border px-3 py-2 text-[12px] font-semibold ' + banner.cls}>
        {banner.text}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {watch.status === 'inactive' || watch.status === 'expired' ? (
          <button
            type="button"
            onClick={onSubscribe}
            disabled={pending}
            className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            🔔 Activer la subscription push
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onRenew}
              disabled={pending}
              className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
            >
              ↻ Renouveler maintenant
            </button>
            <button
              type="button"
              onClick={onUnsubscribe}
              disabled={pending}
              className="bg-terra-light text-terra border border-terra-mid px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 dark:bg-[#5A2E18] dark:text-[#FFB897] dark:border-[#7A3F22]"
            >
              ✕ Désactiver
            </button>
          </>
        )}
      </div>

      {msg && (
        <div className={
          'mt-3 text-[12px] rounded-md px-3 py-2 border font-semibold ' +
          (msg.kind === 'ok'
            ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A]'
            : 'bg-terra-light border-terra-mid text-terra')
        }>
          {msg.msg}
        </div>
      )}

      {watch.channel_id && (
        <div className="mt-3 text-[10px] text-ink-muted font-mono dark:text-[#C8C2B8]">
          channel_id: {watch.channel_id}
          <br />resource_id: {watch.resource_id}
        </div>
      )}
    </>
  );
}

// Panel autonome des couleurs planning — fetch + édition + save groupé.
// Utilise le composant <input type="color"> natif (touch-friendly mobile,
// roue de couleurs sur desktop). Pas de dépendance externe.
const PLANNING_DEFAULTS = {
  libre: '#1F6B45',
  reserve: '#1B3A6B',
  bloque: '#6B7280',
  google: '#4338CA',
  foxo_importe: '#7C3AED',
} as const;
type PlanningColorKey = keyof typeof PLANNING_DEFAULTS;

interface TechWithCouleur {
  id: string;
  prenom: string | null;
  nom: string | null;
  email: string | null;
  couleur: string | null;
}

function PlanningCouleursPanel() {
  const [loaded, setLoaded] = useState(false);
  const [types, setTypesState] = useState<Record<PlanningColorKey, string>>({ ...PLANNING_DEFAULTS });
  const [techs, setTechs] = useState<TechWithCouleur[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/admin/parametres/planning-couleurs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted || !data.ok) { setLoaded(true); return; }
        setTypesState(data.types as Record<PlanningColorKey, string>);
        setTechs((data.techniciens ?? []) as TechWithCouleur[]);
        setLoaded(true);
      })
      .catch(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, []);

  function setType(k: PlanningColorKey, v: string) {
    setTypesState((s) => ({ ...s, [k]: v }));
  }
  function setTechCouleur(id: string, couleur: string) {
    setTechs((arr) => arr.map((t) => t.id === id ? { ...t, couleur } : t));
  }
  function resetDefaults() {
    setTypesState({ ...PLANNING_DEFAULTS });
    // Pas de reset des couleurs tech — l'admin doit explicitement les
    // changer/enlever via le picker (et un bouton "Retirer" par tech).
    setMsg({ kind: 'ok', msg: 'Défauts restaurés (non encore enregistrés).' });
  }
  async function saveAll() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch('/api/admin/parametres/planning-couleurs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          types,
          techniciens: techs.map((t) => ({ id: t.id, couleur: t.couleur })),
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setMsg({ kind: 'err', msg: data.error ?? 'Échec sauvegarde.' });
        return;
      }
      setMsg({ kind: 'ok', msg: '✓ Couleurs enregistrées.' });
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <div className="text-[12px] text-ink-mid italic dark:text-[#C8C2B8]">Chargement…</div>;
  }

  const TYPES_LABELS: { key: PlanningColorKey; label: string; hint: string }[] = [
    { key: 'libre',         label: 'Libre',         hint: 'Créneau disponible (vue calendrier + grille dispos)' },
    { key: 'reserve',       label: 'Réservé',       hint: 'Créneau lié à une intervention (override par couleur tech ci-dessous)' },
    { key: 'bloque',        label: 'Bloqué',        hint: 'Créneau bloqué (vacances, congés, indisponibilité)' },
    { key: 'google',        label: 'Google Calendar', hint: 'Events externes Google Calendar (overlay)' },
    { key: 'foxo_importe',  label: 'FoxO importé',  hint: 'Events Google déjà rattachés à une intervention FoxO' },
  ];

  return (
    <div className="space-y-4">
      {/* Types de créneaux */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2 dark:text-[#C8C2B8]">
          Types de créneaux
        </div>
        <div className="space-y-1.5">
          {TYPES_LABELS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-2.5 bg-white border border-sand-border rounded-md px-2.5 py-1.5 dark:bg-[#221E1A] dark:border-[#3D3A32]">
              <input
                type="color"
                value={types[key]}
                onChange={(e) => setType(key, e.target.value)}
                className="w-9 h-9 rounded cursor-pointer flex-shrink-0 border-0 p-0 bg-transparent"
                style={{ background: types[key] }}
                aria-label={`Couleur ${label}`}
              />
              <input
                type="text"
                value={types[key]}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) setType(key, v);
                }}
                className="w-[90px] px-2 py-1 border border-sand-border rounded text-[11px] bg-white font-mono dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-ink dark:text-[#F0ECE4]">{label}</div>
                <div className="text-[10px] text-ink-muted truncate dark:text-[#C8C2B8]">{hint}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Techniciens */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2 dark:text-[#C8C2B8]">
          Couleur par technicien
        </div>
        {techs.length === 0 ? (
          <div className="text-[12px] text-ink-muted italic dark:text-[#C8C2B8]">
            Aucun technicien — ajoute des comptes via le code (TECH_EMAILS dans roles.ts).
          </div>
        ) : (
          <div className="space-y-1.5">
            {techs.map((t, idx) => {
              const initiales = ((t.prenom?.[0] ?? '') + (t.nom?.[0] ?? '')).toUpperCase() || '?';
              const display = [t.prenom, t.nom].filter(Boolean).join(' ') || t.email || '—';
              const couleur = t.couleur ?? '#888888';
              return (
                <div key={t.id} className="flex items-center gap-2.5 bg-white border border-sand-border rounded-md px-2.5 py-1.5 dark:bg-[#221E1A] dark:border-[#3D3A32]">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0"
                    style={{ background: couleur }}
                  >
                    {initiales}
                  </div>
                  <input
                    type="color"
                    value={couleur}
                    onChange={(e) => setTechCouleur(t.id, e.target.value)}
                    className="w-9 h-9 rounded cursor-pointer flex-shrink-0 border-0 p-0 bg-transparent"
                    aria-label={`Couleur ${display}`}
                  />
                  <input
                    type="text"
                    value={t.couleur ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (v === '' || /^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                        setTechCouleur(t.id, v || '#888888');
                      }
                    }}
                    placeholder="(défaut)"
                    className="w-[90px] px-2 py-1 border border-sand-border rounded text-[11px] bg-white font-mono dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold text-ink dark:text-[#F0ECE4]">
                      T.{idx + 1} {display}
                    </div>
                    <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">
                      {t.email}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={saveAll}
          disabled={saving}
          className="bg-navy text-white px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : '💾 Sauvegarder tout'}
        </button>
        <button
          type="button"
          onClick={resetDefaults}
          disabled={saving}
          className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-xs font-bold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
        >
          Réinitialiser les défauts
        </button>
        {msg && (
          <span className={
            'text-[11px] font-semibold ' +
            (msg.kind === 'ok' ? 'text-ok dark:text-[#7AC9A0]' : 'text-terra')
          }>
            {msg.msg}
          </span>
        )}
      </div>
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

function DriveFolderCard({
  label,
  envKey,
  status,
}: {
  label: string;
  envKey: string;
  status: { ok: boolean; id: string | null; name?: string; status?: number; error?: string; trashed?: boolean };
}) {
  const ok = status.ok;
  const headline = ok
    ? `✅ Dossier accessible : ${status.name ?? '(sans nom)'}`
    : status.status === 404
      ? '❌ Dossier introuvable (404)'
      : status.status === 403
        ? '❌ Erreur d\'accès (403)'
        : status.trashed
          ? `❌ Dossier dans la corbeille : ${status.name ?? ''}`
          : `❌ ${status.error ?? 'Inaccessible'}`;
  return (
    <div className={
      'rounded-lg border p-3 text-[12px] ' +
      (ok
        ? 'bg-ok-light border-ok-mid dark:bg-[#14281E] dark:border-[#2A4F3A]'
        : 'bg-terra-light border-terra-mid dark:bg-[#2E1A12] dark:border-[#5A2E18]')
    }>
      <div className={
        'font-bold ' +
        (ok ? 'text-ok dark:text-[#7AC9A0]' : 'text-terra dark:text-[#FFB897]')
      }>
        {label} — {headline}
      </div>
      {status.id && (
        <div className="text-[10px] text-ink-muted mt-1 dark:text-[#C8C2B8]">
          <span className="font-mono">{envKey}</span> = <span className="font-mono">{status.id}</span>
        </div>
      )}
      {!ok && status.error && status.status !== 404 && status.status !== 403 && (
        <div className="text-[10px] text-ink-mid mt-1 dark:text-[#C8C2B8]">{status.error}</div>
      )}
      {!ok && (
        <div className="text-[10px] text-ink-muted mt-1 italic dark:text-[#C8C2B8]">
          {status.status === 404
            ? <>Vérifie que l&apos;ID dans Vercel ({envKey}) correspond à un dossier existant et non supprimé.</>
            : status.status === 403
              ? <>Le compte connecté n&apos;a pas accès à ce dossier. Partage-le ou utilise un autre compte.</>
              : <>Vérifie l&apos;ID Drive et le partage avec le compte connecté.</>
          }
        </div>
      )}
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

function ToggleRow({
  label, checked, onChange,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <span className="text-[12px] text-ink dark:text-[#F0ECE4]">{label}</span>
      <span
        onClick={() => onChange(!checked)}
        className={
          'relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ' +
          (checked ? 'bg-ok' : 'bg-sand-mid dark:bg-[#3D3A32]')
        }
      >
        <span
          className={
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ' +
            (checked ? 'translate-x-4' : 'translate-x-0')
          }
        />
      </span>
    </label>
  );
}

function TemplateRow({
  label, cle, value, setValue, onSave, pending,
}: {
  label: string; cle: string; value: string; setValue: (v: string) => void;
  onSave: (cle: string, valeur: string) => void; pending: boolean;
}) {
  const defaultValue = (
    {
      sms_template_confirmation: 'Bonjour [Prénom], FoxO interviendra le [date] à [heure] pour [adresse]. Confirmez votre présence : [lien]',
      sms_template_rappel_24h: 'Rappel FoxO : intervention demain [date] à [heure] — [adresse]. Contact : 0488/700.007',
      sms_template_rapport: 'FoxO — Votre rapport est disponible : [lien]',
      sms_template_lien_occupant: 'FoxO — Confirmez votre présence pour le [date] : [lien]',
    } as Record<string, string>
  )[cle] ?? '';
  const isDefault = value === defaultValue;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted dark:text-[#C8C2B8]">
          {label}
        </span>
        {!isDefault && (
          <button
            type="button"
            onClick={() => { setValue(defaultValue); onSave(cle, defaultValue); }}
            className="text-[10px] text-ink-mid hover:text-navy underline dark:text-[#C8C2B8]"
          >
            Réinitialiser par défaut
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 border border-sand-border rounded-lg text-[12px] bg-white outline-none focus:border-navy-mid resize-y"
      />
      <div className="flex justify-between items-center mt-1.5">
        <span className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">{value.length} caractères</span>
        <SaveBtn pending={pending} onClick={() => onSave(cle, value)} />
      </div>
    </div>
  );
}
