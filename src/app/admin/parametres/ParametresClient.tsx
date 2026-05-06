'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle, Bell, Building2, Check, CheckCircle2, Cloud, CreditCard,
  FileText, Link2, Mail, MessageSquare, Palette, RefreshCw, Save, Search,
  Sparkles, Users, Webhook, Wrench, X, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { setParametre } from '../facturation/actions';
import { testSmsAction } from '../sms/actions';
import {
  getGoogleStatus,
  disconnectGoogle,
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

// ───────────────────────────────────────────────────────────────────────────
//  Navigation sidebar — groupes + items + keywords pour la recherche
// ───────────────────────────────────────────────────────────────────────────

type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  // Mots-clés indexés pour la recherche (en plus du label).
  keywords: string[];
};
type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'GÉNÉRAL',
    items: [
      { id: 'societe',   label: 'Société & identité', icon: Building2, keywords: ['société', 'nom', 'tva', 'bce', 'iban', 'adresse', 'logo', 'téléphone', 'email', 'légal', 'identité'] },
      { id: 'apparence', label: 'Apparence',          icon: Palette,   keywords: ['thème', 'theme', 'couleur', 'sombre', 'clair', 'planning', 'palette', 'logo'] },
    ],
  },
  {
    title: 'COMMUNICATIONS',
    items: [
      { id: 'email', label: 'Email',           icon: Mail,           keywords: ['email', 'comptable', 'mail', 'analyse', 'cron', 'gmail', 'csv', 'comptabilité'] },
      { id: 'sms',   label: 'SMS / WhatsApp',  icon: MessageSquare,  keywords: ['sms', 'whatsapp', 'twilio', 'template', 'rappel', 'confirmation', 'occupants', 'syndic'] },
    ],
  },
  {
    title: 'INTÉGRATIONS',
    items: [
      { id: 'google',    label: 'Google Workspace',          icon: Cloud,      keywords: ['google', 'drive', 'gmail', 'calendar', 'oauth', 'workspace', 'rapports', 'factures', 'watch', 'subscription'] },
      { id: 'ia',        label: 'Intelligence artificielle', icon: Sparkles,   keywords: ['ia', 'claude', 'anthropic', 'analyse', 'llm', 'assistant'] },
      { id: 'paiements', label: 'Paiements',                 icon: CreditCard, keywords: ['paiement', 'ponto', 'iban', 'délai', 'beobank', 'virement', 'échéance', 'banque'] },
    ],
  },
  {
    title: 'OPÉRATIONNEL',
    items: [
      { id: 'documents',     label: 'Documents',      icon: FileText, keywords: ['document', 'rapport', 'facture', 'devis', 'pdf', 'docx', 'template'] },
      { id: 'notifications', label: 'Notifications',  icon: Bell,     keywords: ['notification', 'push', 'alerte', 'badge', 'pwa'] },
      { id: 'equipe',        label: 'Équipe & accès', icon: Users,    keywords: ['équipe', 'technicien', 'admin', 'rôle', 'accès', 'whitelist', 'utilisateur'] },
    ],
  },
  {
    title: 'AVANCÉ',
    items: [
      { id: 'webhooks',    label: 'Webhooks',    icon: Webhook, keywords: ['webhook', 'api', 'endpoint', 'slack', 'zapier'] },
      { id: 'maintenance', label: 'Maintenance', icon: Wrench,  keywords: ['maintenance', 'cron', 'log', 'debug', 'à venir', 'roadmap'] },
    ],
  },
];

const ALL_IDS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

// ───────────────────────────────────────────────────────────────────────────
//  ParametresClient
// ───────────────────────────────────────────────────────────────────────────

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

  // Sidebar nav : recherche + tracking section active
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeId, setActiveId] = useState<string>('societe');
  const sectionsRef = useRef<Record<string, HTMLElement | null>>({});

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
      if (g === 'ok') setGoogleTestMsg({ kind: 'ok', msg: 'Compte Google connecté' });
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

  // Debounce de la recherche (300 ms) — n'applique le filtrage qu'après
  // une pause de saisie pour éviter de tronquer la sidebar à chaque
  // frappe.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Sidebar items filtrés par la requête (label + keywords).
  const filteredGroups = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return NAV_GROUPS;
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((it) =>
        it.label.toLowerCase().includes(q) ||
        it.keywords.some((k) => k.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [debouncedQuery]);

  function scrollToSection(id: string) {
    const el = sectionsRef.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  }

  // Auto-scroll vers la section quand la recherche ne laisse qu'un
  // seul résultat (tous groupes confondus).
  useEffect(() => {
    if (!debouncedQuery.trim()) return;
    const items = filteredGroups.flatMap((g) => g.items);
    if (items.length === 1) scrollToSection(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filteredGroups]);

  // Tracking de la section active via IntersectionObserver. Le scroll
  // a lieu dans #parametres-scroll (cf. page.tsx) — on l'utilise comme
  // root pour que les calculs soient justes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('parametres-scroll');
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => ({ id: e.target.id, top: e.boundingClientRect.top }))
          .sort((a, b) => a.top - b.top);
        if (visible.length > 0 && visible[0].id) {
          setActiveId(visible[0].id);
        }
      },
      { root, rootMargin: '-15% 0px -55% 0px', threshold: 0 },
    );
    for (const id of ALL_IDS) {
      const el = sectionsRef.current[id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
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

  // Badge "Actif" / "À configurer" par section, calculé dynamiquement
  // à partir de l'état des paramètres. null = pas de badge.
  function getBadge(id: string): { kind: 'ok' | 'warn'; label: string } | null {
    switch (id) {
      case 'societe':
        return initial.societe_nom
          ? { kind: 'ok', label: 'Actif' }
          : { kind: 'warn', label: 'À configurer' };
      case 'email':
        return emailComptable
          ? { kind: 'ok', label: 'Actif' }
          : { kind: 'warn', label: 'À configurer' };
      case 'sms':
        return (smsEnabled || waEnabled) ? { kind: 'ok', label: 'Actif' } : null;
      case 'google':
        return googleStatus.connected
          ? { kind: 'ok', label: 'Actif' }
          : { kind: 'warn', label: 'À configurer' };
      case 'paiements':
        return pontoEnabled ? { kind: 'ok', label: 'Actif' } : null;
      default:
        return null;
    }
  }

  return (
    <div className="parametres-shell flex flex-col lg:flex-row gap-4 lg:gap-6">
      {/* Sidebar : recherche + nav (devient horizontal scrollable sur mobile) */}
      <aside className="parametres-aside lg:w-[250px] lg:flex-shrink-0">
        <div className="lg:sticky lg:top-2 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-9 pr-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
            />
          </div>
          <nav className="param-nav">
            {filteredGroups.length === 0 ? (
              <div className="text-[11px] text-ink-muted italic px-2 py-2">
                Aucun résultat.
              </div>
            ) : filteredGroups.map((g) => (
              <div key={g.title} className="param-nav-group">
                <div className="param-nav-title">{g.title}</div>
                {g.items.map((item) => {
                  const badge = getBadge(item.id);
                  const active = activeId === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => scrollToSection(item.id)}
                      className={'param-nav-item' + (active ? ' active' : '')}
                    >
                      <Icon size={14} aria-hidden />
                      <span className="param-nav-label">{item.label}</span>
                      {badge && (
                        <span className={'param-nav-badge ' + badge.kind}>
                          {badge.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Contenu principal scrollable — toutes les sections, ancrées par id */}
      <div className="flex-1 min-w-0 space-y-5 max-w-[800px]">
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

        {/* ─── GÉNÉRAL ──────────────────────────────────────────────── */}

        <section id="societe" ref={(el) => { sectionsRef.current.societe = el; }}>
          <SocieteSection initial={initial} />
        </section>

        <section
          id="apparence"
          ref={(el) => { sectionsRef.current.apparence = el; }}
          className="space-y-5"
        >
          <ThemePicker />
          <Section
            title="Couleurs du planning"
            desc="Couleurs des créneaux par type et par technicien. S'appliquent dans /admin/planning et sur les events Google Calendar (mappés sur le colorId le plus proche)."
          >
            <PlanningCouleursPanel />
          </Section>
        </section>

        {/* ─── COMMUNICATIONS ──────────────────────────────────────── */}

        <section
          id="email"
          ref={(el) => { sectionsRef.current.email = el; }}
          className="space-y-5"
        >
          <Section
            title="Email comptable"
            desc="Destinataire des exports comptables mensuels."
          >
            <Row
              label="Email comptable"
              hint="Reçoit le CSV mensuel quand on clique « Envoyer au comptable »."
            >
              <input
                type="email"
                value={emailComptable}
                onChange={(e) => setEmailComptable(e.target.value)}
                placeholder="comptable@cabinet.be"
                className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
              />
              <SaveBtn pending={pending} onClick={() => save('email_comptable', emailComptable)} />
            </Row>
          </Section>

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
              <div className="mt-2 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg px-3 py-2 text-[11px]">
                <div className="inline-flex items-start gap-1.5">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  <span>Le cron tournera toutes les 30 min. Vérifie d&apos;abord que Google est connecté (scope <code>gmail.readonly</code>) et fais un test à blanc :</span>
                </div>
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
              <span className="text-[11px] text-ink-muted">
                Dernière vérification : <strong>{formatRelative(mailLastCheck)}</strong>
              </span>
            </div>

            {mailCheckResult && (
              <div className={
                'mt-2 text-[12px] rounded-md px-3 py-2 border font-semibold ' +
                (mailCheckResult.kind === 'ok'
                  ? 'bg-ok-light border-ok-mid text-ok dark:text-white'
                  : 'bg-terra-light border-terra-mid text-terra')
              }>
                {mailCheckResult.msg}
              </div>
            )}

            <p className="text-[11px] text-ink-muted mt-2 italic">
              Mails labelisés <code>FOXO_TRAITE</code> (demande convertie) ou <code>FOXO_LU</code> (pas une demande) après passage. Aucun mail n&apos;est traité deux fois.
            </p>
          </Section>
        </section>

        <section id="sms" ref={(el) => { sectionsRef.current.sms = el; }}>
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
                      : 'bg-white text-ink border-sand-border')
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
                      : 'bg-white text-ink border-sand-border')
                  }
                >
                  Automatique
                </button>
              </div>
            </Row>

            {smsMode === 'auto' && (
              <div className="bg-amber-light border border-[#E8C896] rounded-lg p-3 text-[12px] text-[#8A5A1A] inline-flex items-start gap-1.5">
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>Mode automatique actif — les SMS partent sans confirmation manuelle. Active uniquement les toggles ci-dessous quand tu es sûr du contenu.</span>
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

            <div className="border-t border-sand-border pt-3 mt-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">
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

              <p className="text-[11px] text-ink-muted italic mt-2">
                Crée un compte sur <a href="https://www.twilio.com" target="_blank" rel="noopener noreferrer" className="text-navy underline">twilio.com</a> pour activer les SMS. Pour Vercel : ajoute aussi les variables d&apos;env <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>, <code>TWILIO_PHONE_NUMBER</code>, <code>TWILIO_WHATSAPP_NUMBER</code> (priorité sur la DB).
              </p>

              {twilioReady && (
                <div className="mt-3 bg-cream border border-sand-border rounded-lg p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">
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
                          if (res.ok) setFeedback({ kind: 'ok', msg: 'Test envoyé' });
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

            <div className="border-t border-sand-border pt-3 mt-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">
                Templates SMS
              </div>
              <p className="text-[11px] text-ink-muted mb-3">
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
        </section>

        {/* ─── INTÉGRATIONS ────────────────────────────────────────── */}

        <section
          id="google"
          ref={(el) => { sectionsRef.current.google = el; }}
          className="space-y-5"
        >
          <Section
            title="Intégrations Google"
            desc="Connecte un compte Google pour brancher Drive (rapports + factures), Gmail (lecture pour enrichir l'assistant) et Calendar (sync des créneaux)."
          >
            {googleLoading ? (
              <div className="text-[12px] text-ink-muted">Chargement du statut…</div>
            ) : googleStatus.connected ? (
              <div className="bg-ok-light border border-ok-mid rounded-lg p-3 text-[12px] text-ok">
                <span className="inline-flex items-center gap-1.5"><Check size={14} />Connecté en tant que <strong className="font-mono">{googleStatus.email ?? '—'}</strong></span>
                {googleStatus.expiry && (
                  <span className="block text-[10px] text-ink-muted mt-1">
                    Token expire : {new Date(googleStatus.expiry).toLocaleString('fr-BE')}
                  </span>
                )}
              </div>
            ) : (
              <div className="bg-amber-light border border-[#E8C896] rounded-lg p-3 text-[12px] text-[#8A5A1A]">
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
                  className="bg-terra-light text-terra border border-terra-mid px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90"
                >
                  Déconnecter
                </button>
              ) : (
                <a
                  href="/api/google/auth"
                  className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center gap-1.5 min-h-[44px]"
                >
                  <Link2 size={14} />Connecter Google
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
                              ? { kind: 'ok', msg: 'Drive : les 2 dossiers racines sont accessibles' }
                              : scopeIssue
                                ? { kind: 'err', msg: 'Scopes OAuth insuffisants — déconnecte puis reconnecte Google pour ré-accorder les permissions complètes.' }
                                : { kind: 'err', msg: 'Drive : un ou plusieurs dossiers inaccessibles — voir détails ci-dessous.' },
                          );
                        } catch (e) {
                          setGoogleTestMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
                        }
                      });
                    }}
                    className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-[12px] font-bold dark:bg-[rgba(255,255,255,.06)]"
                  >
                    Tester Drive
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGoogleTestMsg(null);
                      startTransition(async () => {
                        const res = await testGmail();
                        if (res.ok) setGoogleTestMsg({ kind: 'ok', msg: `Gmail : ${res.data?.count ?? 0} messages récents accessibles` });
                        else setGoogleTestMsg({ kind: 'err', msg: res.error });
                      });
                    }}
                    className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-[12px] font-bold dark:bg-[rgba(255,255,255,.06)]"
                  >
                    Tester Gmail
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setGoogleTestMsg(null);
                      startTransition(async () => {
                        const res = await testGoogleCalendar();
                        if (res.ok) setGoogleTestMsg({ kind: 'ok', msg: `Calendar : ${res.data?.count ?? 0} événements aujourd'hui` });
                        else setGoogleTestMsg({ kind: 'err', msg: res.error });
                      });
                    }}
                    className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-[12px] font-bold dark:bg-[rgba(255,255,255,.06)]"
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
                  ? 'bg-ok-light border-ok-mid text-ok dark:text-white'
                  : 'bg-terra-light border-terra-mid text-terra')
              }>
                {googleTestMsg.msg}
              </div>
            )}

            {driveTest?.scopes && driveTest.scopes.has_drive_file_only && (
              <div className="mt-3 bg-terra-light border border-terra-mid text-terra rounded-lg p-3 text-[12px]">
                <div className="font-bold mb-1 inline-flex items-center gap-1.5"><AlertTriangle size={14} />Scope Drive insuffisant : <code>drive.file</code> au lieu de <code>drive</code></div>
                <p className="leading-relaxed">
                  Ton token Google n&apos;a accès qu&apos;aux fichiers créés par l&apos;app — pas aux dossiers existants.
                  Clique <strong>Déconnecter</strong> puis <strong>Connecter Google</strong> à nouveau et accepte
                  tous les scopes lors du re-consentement.
                </p>
              </div>
            )}

            {driveTest?.scopes && driveTest.scopes.missing.length > 0 && (
              <div className="mt-3 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg p-3 text-[12px]">
                <div className="font-bold mb-1 inline-flex items-center gap-1.5"><AlertTriangle size={14} />Scopes manquants ({driveTest.scopes.missing.length})</div>
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

            <p className="text-[11px] text-ink-muted italic mt-3">
              Variables d&apos;env Vercel requises : <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>,
              <code>GOOGLE_DRIVE_RAPPORTS_FOLDER_ID</code>, <code>GOOGLE_DRIVE_FACTURES_FOLDER_ID</code>,
              <code>NEXT_PUBLIC_APP_URL</code>. Le redirect_uri doit être déclaré côté Google Cloud :{' '}
              <code>{'<NEXT_PUBLIC_APP_URL>/api/google/callback'}</code>.
            </p>
          </Section>

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
                  setWatchMsg({ kind: 'ok', msg: 'Subscription créée' });
                });
              }}
              onRenew={() => {
                setWatchMsg(null);
                startTransition(async () => {
                  const res = await renewCalendarWatchAction();
                  if (!res.ok) { setWatchMsg({ kind: 'err', msg: res.error }); return; }
                  setWatch(res.data ?? null);
                  setWatchMsg({ kind: 'ok', msg: 'Subscription renouvelée' });
                });
              }}
              onUnsubscribe={() => {
                if (!confirm('Désactiver la subscription push Calendar ?')) return;
                setWatchMsg(null);
                startTransition(async () => {
                  const res = await unsubscribeCalendarWatchAction();
                  if (!res.ok) { setWatchMsg({ kind: 'err', msg: res.error }); return; }
                  setWatch(res.data ?? null);
                  setWatchMsg({ kind: 'ok', msg: 'Subscription désactivée' });
                });
              }}
            />
          </Section>
        </section>

        <section id="ia" ref={(el) => { sectionsRef.current.ia = el; }}>
          <SectionPlaceholder
            title="Intelligence artificielle"
            desc="Configuration de l'assistant Claude (modèle, prompts système, limites) — bientôt disponible."
          />
        </section>

        <section
          id="paiements"
          ref={(el) => { sectionsRef.current.paiements = el; }}
          className="space-y-5"
        >
          <Section
            title="Délais de paiement"
            desc="Date d'échéance par défaut sur les nouvelles factures."
          >
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
                className="w-24 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
              />
              <SaveBtn pending={pending} onClick={() => save('payment_terms_days', paymentTerms)} />
            </Row>
          </Section>

          <Section
            title="Synchronisation bancaire (Ponto)"
            desc="Réconciliation automatique des paiements Beobank via MyPonto. Tant que ce n'est pas activé, l'import CSV manuel reste disponible depuis /admin/facturation."
          >
            <Row label="Activer Ponto" hint="Synchronisation continue des transactions et matching auto sur la communication structurée.">
              <label className="flex items-center gap-2 text-[13px] cursor-pointer">
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
                className="flex-1 px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
              />
              <SaveBtn pending={pending} onClick={() => save('ponto_api_key', pontoApiKey)} />
            </Row>
            <p className="text-[11px] text-ink-muted italic">
              Le branchement effectif est dans <code>src/lib/ponto.ts</code> (TODO connectPonto, syncTransactions). Quand les credentials seront disponibles, la sync s&apos;activera automatiquement.
            </p>
          </Section>
        </section>

        {/* ─── OPÉRATIONNEL ────────────────────────────────────────── */}

        <section id="documents" ref={(el) => { sectionsRef.current.documents = el; }}>
          <SectionPlaceholder
            title="Documents"
            desc="Templates rapports, factures et devis (placeholders, PDF, DOCX) — bientôt disponible."
          />
        </section>

        <section id="notifications" ref={(el) => { sectionsRef.current.notifications = el; }}>
          <SectionPlaceholder
            title="Notifications"
            desc="Push notifications (PWA), badges de la sidebar, alertes contextuelles — bientôt disponible."
          />
        </section>

        <section id="equipe" ref={(el) => { sectionsRef.current.equipe = el; }}>
          <SectionPlaceholder
            title="Équipe & accès"
            desc="Gestion des techniciens (ajout, suspension, accès PWA), whitelists d'admins — bientôt disponible."
          />
        </section>

        {/* ─── AVANCÉ ──────────────────────────────────────────────── */}

        <section id="webhooks" ref={(el) => { sectionsRef.current.webhooks = el; }}>
          <SectionPlaceholder
            title="Webhooks"
            desc="Endpoints sortants pour notifier des systèmes externes (Slack, Zapier, etc.) — bientôt disponible."
          />
        </section>

        <section id="maintenance" ref={(el) => { sectionsRef.current.maintenance = el; }}>
          <Section
            title="Maintenance & roadmap"
            desc="Configurations encore à brancher."
          >
            <ul className="text-[12px] text-ink-mid leading-relaxed list-disc list-inside">
              <li>Coordonnées légales (BCE, TVA, IBAN, adresse) éditables</li>
              <li>Taux TVA par défaut</li>
              <li>Gestion des techniciens (ajout, suspension, accès PWA)</li>
              <li>Templates de rapports + emails</li>
              <li>Connexions Google Calendar / Drive / Gmail (placeholders dans <code>src/lib/google-*.ts</code>)</li>
              <li>Whitelists d&apos;admins</li>
            </ul>
          </Section>
        </section>
      </div>

      <style>{`
        .param-nav {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .param-nav-group {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .param-nav-group + .param-nav-group {
          margin-top: 12px;
        }
        .param-nav-title {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.15em;
          color: var(--text-muted, #9A9690);
          text-transform: uppercase;
          padding: 4px 8px 2px;
        }
        .param-nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 6px;
          background: transparent;
          border: 0;
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
          color: var(--text-secondary, #6B6760);
          text-align: left;
          transition: background-color 0.15s ease, color 0.15s ease;
          width: 100%;
        }
        .param-nav-item:hover {
          background: rgba(200, 146, 74, 0.08);
          color: var(--text-primary, #1A1916);
        }
        .param-nav-item.active {
          background: rgba(200, 146, 74, 0.15);
          color: var(--accent-admin, #C8924A);
          font-weight: 600;
        }
        .param-nav-label {
          flex: 1;
          min-width: 0;
        }
        .param-nav-badge {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 1px 6px;
          border-radius: 999px;
          flex-shrink: 0;
          white-space: nowrap;
        }
        .param-nav-badge.ok {
          background: #D4EDE2;
          color: #1F6B45;
        }
        .param-nav-badge.warn {
          background: #FFEDD5;
          color: #9A3412;
        }

        @media (max-width: 1023px) {
          .parametres-aside {
            position: sticky;
            top: 0;
            z-index: 10;
            background: var(--main-bg, var(--color-sand));
            margin-bottom: 4px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--card-border, #E6E2DC);
          }
          .param-nav {
            flex-direction: row;
            overflow-x: auto;
            gap: 4px;
            padding-bottom: 4px;
            -webkit-overflow-scrolling: touch;
          }
          .param-nav-group {
            flex-direction: row;
            gap: 2px;
            flex-shrink: 0;
          }
          .param-nav-group + .param-nav-group {
            margin-top: 0;
            margin-left: 8px;
            padding-left: 8px;
            border-left: 1px solid var(--card-border, #E6E2DC);
          }
          .param-nav-title {
            display: none;
          }
          .param-nav-item {
            flex-shrink: 0;
            white-space: nowrap;
            padding: 8px 10px;
          }
          .param-nav-badge {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
//  Sous-composants
// ───────────────────────────────────────────────────────────────────────────

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
    return <div className="text-[12px] text-ink-muted">Chargement du statut…</div>;
  }
  const banner = (() => {
    if (watch.status === 'active') {
      return {
        cls: 'bg-ok-light border-ok-mid text-ok',
        text: <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />Active — expire le <strong className="font-mono">{watch.expiry_iso ? new Date(watch.expiry_iso).toLocaleString('fr-BE') : '?'}</strong></span>,
      };
    }
    if (watch.status === 'expiring_soon') {
      return {
        cls: 'bg-amber-light border-[#E8C896] text-[#8A5A1A]',
        text: <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} />Expire dans moins de 24h — <strong className="font-mono">{watch.expiry_iso ? new Date(watch.expiry_iso).toLocaleString('fr-BE') : '?'}</strong>. Le cron quotidien renouvellera automatiquement.</span>,
      };
    }
    if (watch.status === 'expired') {
      return {
        cls: 'bg-terra-light border-terra-mid text-terra',
        text: <span className="inline-flex items-center gap-1.5"><XCircle size={14} />Expirée — <strong className="font-mono">{watch.expiry_iso ? new Date(watch.expiry_iso).toLocaleString('fr-BE') : '?'}</strong>. Cliquer « Activer » pour en créer une nouvelle.</span>,
      };
    }
    return {
      cls: 'bg-sand-mid border-sand-border text-ink-mid dark:bg-[rgba(255,255,255,.04)]',
      text: <span className="inline-flex items-center gap-1.5"><XCircle size={14} />Inactive — aucun push Calendar ne sera reçu tant qu&apos;une subscription n&apos;est pas créée.</span>,
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
            className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Bell size={14} />Activer la subscription push
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onRenew}
              disabled={pending}
              className="bg-navy text-white px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw size={14} />Renouveler maintenant
            </button>
            <button
              type="button"
              onClick={onUnsubscribe}
              disabled={pending}
              className="bg-terra-light text-terra border border-terra-mid px-3.5 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <X size={14} />Désactiver
            </button>
          </>
        )}
      </div>

      {msg && (
        <div className={
          'mt-3 text-[12px] rounded-md px-3 py-2 border font-semibold ' +
          (msg.kind === 'ok'
            ? 'bg-ok-light border-ok-mid text-ok dark:text-white'
            : 'bg-terra-light border-terra-mid text-terra')
        }>
          {msg.msg}
        </div>
      )}

      {watch.channel_id && (
        <div className="mt-3 text-[10px] text-ink-muted font-mono">
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
      setMsg({ kind: 'ok', msg: 'Couleurs enregistrées.' });
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <div className="text-[12px] text-ink-mid italic">Chargement…</div>;
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
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2">
          Types de créneaux
        </div>
        <div className="space-y-1.5">
          {TYPES_LABELS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center gap-2.5 bg-white border border-sand-border rounded-md px-2.5 py-1.5">
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
                className="w-[90px] px-2 py-1 border border-sand-border rounded text-[11px] bg-white font-mono"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-ink">{label}</div>
                <div className="text-[10px] text-ink-muted truncate">{hint}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Techniciens */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2">
          Couleur par technicien
        </div>
        {techs.length === 0 ? (
          <div className="text-[12px] text-ink-muted italic">
            Aucun technicien — ajoute des comptes via le code (TECH_EMAILS dans roles.ts).
          </div>
        ) : (
          <div className="space-y-1.5">
            {techs.map((t, idx) => {
              const initiales = ((t.prenom?.[0] ?? '') + (t.nom?.[0] ?? '')).toUpperCase() || '?';
              const display = [t.prenom, t.nom].filter(Boolean).join(' ') || t.email || '—';
              const couleur = t.couleur ?? '#888888';
              return (
                <div key={t.id} className="flex items-center gap-2.5 bg-white border border-sand-border rounded-md px-2.5 py-1.5">
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
                    className="w-[90px] px-2 py-1 border border-sand-border rounded text-[11px] bg-white font-mono"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold text-ink">
                      T.{idx + 1} {display}
                    </div>
                    <div className="text-[10px] text-ink-muted">
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
          className="bg-navy text-white px-4 py-2 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {saving ? 'Enregistrement…' : <><Save size={14} />Sauvegarder tout</>}
        </button>
        <button
          type="button"
          onClick={resetDefaults}
          disabled={saving}
          className="bg-sand-mid text-ink-mid border border-sand-border px-3.5 py-2 rounded-lg text-xs font-bold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)]"
        >
          Réinitialiser les défauts
        </button>
        {msg && (
          <span className={
            'text-[11px] font-semibold ' +
            (msg.kind === 'ok' ? 'text-ok' : 'text-terra')
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
    <section className="bg-cream border border-sand-border rounded-2xl p-4">
      <h2 className="text-sm font-extrabold text-ink mb-1">{title}</h2>
      <p className="text-[12px] text-ink-mid mb-3">{desc}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// Section "vide" pour les groupes pas encore implémentés. Affiche le
// titre + description + un placeholder "Bientôt disponible" centré.
function SectionPlaceholder({ title, desc }: { title: string; desc: string }) {
  return (
    <Section title={title} desc={desc}>
      <div className="text-[12px] text-ink-muted italic py-6 text-center">
        Bientôt disponible
      </div>
    </Section>
  );
}

function Row({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {hint && <p className="text-[10px] text-ink-muted mt-1">{hint}</p>}
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
    ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />Dossier accessible : {status.name ?? '(sans nom)'}</span>
    : status.status === 404
      ? <span className="inline-flex items-center gap-1.5"><XCircle size={14} />Dossier introuvable (404)</span>
      : status.status === 403
        ? <span className="inline-flex items-center gap-1.5"><XCircle size={14} />Erreur d&apos;accès (403)</span>
        : status.trashed
          ? <span className="inline-flex items-center gap-1.5"><XCircle size={14} />Dossier dans la corbeille : {status.name ?? ''}</span>
          : <span className="inline-flex items-center gap-1.5"><XCircle size={14} />{status.error ?? 'Inaccessible'}</span>;
  return (
    <div className={
      'rounded-lg border p-3 text-[12px] ' +
      (ok
        ? 'bg-ok-light border-ok-mid'
        : 'bg-terra-light border-terra-mid')
    }>
      <div className={
        'font-bold ' +
        (ok ? 'text-ok' : 'text-terra')
      }>
        {label} — {headline}
      </div>
      {status.id && (
        <div className="text-[10px] text-ink-muted mt-1">
          <span className="font-mono">{envKey}</span> = <span className="font-mono">{status.id}</span>
        </div>
      )}
      {!ok && status.error && status.status !== 404 && status.status !== 403 && (
        <div className="text-[10px] text-ink-mid mt-1">{status.error}</div>
      )}
      {!ok && (
        <div className="text-[10px] text-ink-muted mt-1 italic">
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
      <span className="text-[12px] text-ink">{label}</span>
      <span
        onClick={() => onChange(!checked)}
        className={
          'relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ' +
          (checked ? 'bg-ok' : 'bg-sand-mid')
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
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          {label}
        </span>
        {!isDefault && (
          <button
            type="button"
            onClick={() => { setValue(defaultValue); onSave(cle, defaultValue); }}
            className="text-[10px] text-ink-mid hover:text-navy underline"
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
        <span className="text-[10px] text-ink-muted">{value.length} caractères</span>
        <SaveBtn pending={pending} onClick={() => onSave(cle, value)} />
      </div>
    </div>
  );
}
