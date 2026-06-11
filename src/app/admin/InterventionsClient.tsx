'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  FileEdit,
  FileText,
  HelpCircle,
  Home,
  Inbox,
  Lightbulb,
  Link2,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Shield,
  Smartphone,
  Sparkles,
  Trash2,
  User,
  Users,
  UserX,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardData } from './page';
import { Dashboard, DashboardTechs } from './Dashboard';
import {
  STATUT_INFO,
  STATUT_PIPELINE,
  type InterventionRow,
  type StatutIntervention,
} from '@/lib/types/database';
import type { Acp, TypeOccupant, Utilisateur } from '@/lib/types/database';
import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
import { TYPE_OCCUPANT_LABEL } from '@/lib/types/database';
import { AddressAutocomplete, addressFromString } from '@/components/AddressAutocomplete';
import {
  updateInterventionStatus,
  resendRapportToSyndic,
  validateRapport,
  reopenRapportDraft,
  reopenTransmittedRapport,
  assignTechnician,
  saveRapportDraftFromAdmin,
  searchAcpsForIntervention,
  confirmAcpSuggestion,
  ignoreAcpSuggestion,
  linkCourtierToDossier,
  unlinkCourtierFromDossier,
} from './actions';
import { searchOrganisations } from './planning/actions';
import { FactureBlock } from './FactureBlock';
import { DocumentsBlock } from './DocumentsBlock';
import { PlanRowModal } from './PlanRowModal';
import { AssistantChat, type QuickAction } from './assistant/AssistantChat';
import { TypeBadge } from '@/components/TypeBadge';
import { SendSmsModal } from '@/components/SendSmsModal';
import { MailStepper } from './MailStepper';
import { MessagesPanel } from '@/components/MessagesPanel';
import { RAPPORT_TECHNIQUES } from '@/lib/rapport/techniques';

const DRAWER_AI_ACTIONS: QuickAction[] = [
  { icon: FileEdit, label: 'Rédiger le rapport', prompt: 'Génère les 4 sections du rapport (degats, inspection, conclusion, recommandations) en JSON pur, en te basant sur la description initiale, le contexte du dossier et les données disponibles. Respecte les règles FoxO ("capteur d\'humidité", formulations prudentes, prose française).' },
  { icon: Mail, label: 'Email au syndic', prompt: 'Rédige un email professionnel au syndic adapté au statut actuel du dossier. Inclus l\'objet et le corps, prêt à copier-coller. Référence la ref FoxO et l\'ACP.' },
  { icon: Users, label: 'Email aux occupants', prompt: 'Rédige un message court, clair et bienveillant à envoyer aux occupants pour les informer (intervention prévue / replanifiée / clôturée selon le statut). Inclus l\'heure si elle est connue.' },
  { icon: Search, label: 'Résumé du dossier', prompt: 'Donne-moi un résumé synthétique du dossier en 3 lignes maximum : la situation, où on en est, ce qui reste à faire.' },
];

const STATUTS_FILTRE: ('tous' | StatutIntervention)[] = [
  'tous',
  'nouvelle',
  'attente',
  'confirmee',
  'realisee',
  'rapport',
  'cloturee',
  'en_suspens',
];

function fmtDate(iso: string | null, full = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return full
    ? d.toLocaleString('fr-BE', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS,
      })
    : d.toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: TZ_BRUSSELS,
      });
}

function relTime(iso: string | null, nowMs: number): string {
  if (!iso) return '';
  const h = Math.floor((nowMs - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return '< 1h';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}

function Badge({ statut, big = false }: { statut: StatutIntervention; big?: boolean }) {
  const info = STATUT_INFO[statut];
  return (
    <span
      className="inline-block rounded-full font-semibold whitespace-nowrap"
      style={{
        color: info.fg,
        background: info.bg,
        fontSize: big ? 12 : 11,
        padding: big ? '4px 12px' : '3px 9px',
      }}
    >
      {info.label}
    </span>
  );
}

function Pipebar({ statut }: { statut: StatutIntervention }) {
  if (statut === 'en_suspens') {
    return (
      <div className="flex gap-0.5 mt-1.5 items-center">
        <div className="h-[3px] flex-1 rounded-md bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)]" />
        <span className="text-[9px] text-terra font-bold ml-1.5 whitespace-nowrap font-mono">
          EN SUSPENS
        </span>
      </div>
    );
  }
  const idx = STATUT_PIPELINE.indexOf(statut);
  return (
    <div className="flex gap-0.5 mt-1.5">
      {STATUT_PIPELINE.map((p, i) => (
        <div
          key={p}
          className="h-[3px] flex-1 rounded-md"
          style={{ background: i <= idx ? STATUT_INFO[p].fg : 'var(--color-sand-border)' }}
        />
      ))}
    </div>
  );
}

export function InterventionsClient({
  initialRows,
  techs,
  loadError,
  dashboard,
  serverNowIso,
  adminEmail = '',
  fullPage = false,
  initialSelectedId = null,
  adminPins = [],
}: {
  initialRows: InterventionRow[];
  techs: Utilisateur[];
  loadError: string | null;
  dashboard: DashboardData;
  serverNowIso: string;
  /** Email admin connecté — alimente MessagesPanel.currentUserEmail. */
  adminEmail?: string;
  /** Pins de la carte admin — propagés au Dashboard pour l'accordéon
      mobile (la même donnée alimente la carte server-rendered en
      desktop, hidden md:block côté admin/page.tsx). */
  adminPins?: import('@/components/portal/SyndicMapWrapper').SyndicMapPin[];
  // Mode page complète (route /admin/interventions/[id]) — masque la
  // liste, étend le drawer en pleine largeur, et auto-sélectionne
  // l'intervention `initialSelectedId`. Le bouton "Fermer" devient
  // "← Retour" qui renvoie à /admin.
  fullPage?: boolean;
  initialSelectedId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const techFilter = searchParams.get('tech');
  const statutParam = searchParams.get('statut');   // 'nouvelle' | 'en_cours' | 'en_suspens' | 'rapport' | 'cloturee' | null
  const recentResponsesFilter = searchParams.get('recent_responses') === '1';
  const acpIdFilter = searchParams.get('acp_id');
  const recentResponseIvIds = useMemo(
    () => new Set(dashboard.recentResponses.map((r) => r.intervention_id)),
    [dashboard.recentResponses],
  );

  // Source de temps SSR-stable. Initialisée avec la valeur serveur pour
  // que le SSR et la 1ʳᵉ hydratation produisent le même HTML (React #418).
  // Mise à jour côté client après mount + chaque minute pour rafraîchir
  // les "il y a Xh" relatifs.
  const [nowMs, setNowMs] = useState<number>(() => Date.parse(serverNowIso));
  useEffect(() => {
    // queueMicrotask : sort le 1er setState du body sync de l'effect
    // (respecte react-hooks/set-state-in-effect). Le setInterval suivant
    // appelle déjà setNowMs depuis un callback asynchrone, donc OK.
    queueMicrotask(() => setNowMs(Date.now()));
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof STATUTS_FILTRE[number]>('tous');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [tab, setTab] = useState<'dossier' | 'suivi' | 'documents' | 'ia' | 'historique'>('dossier');
  const [iaSaveMessage, setIaSaveMessage] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [iaSavePending, startIaSaveTransition] = useTransition();

  type DrawerOccupant = {
    id: string;
    appartement: string | null;
    etage: string | null;
    prenom: string | null;
    nom: string | null;
    email: string | null;
    telephone: string | null;
    instructions: string | null;
    conf: 'confirme' | 'en_attente' | 'decline' | null;
    contact_preference?: 'email' | 'sms' | 'whatsapp' | 'both' | null;
    token_sent_at?: string | null;
    type_occupant?: TypeOccupant | null;
    proposed_creneau_debut?: string | null;
    proposed_creneau_fin?: string | null;
  };
  const [drawerOccupants, setDrawerOccupants] = useState<DrawerOccupant[]>([]);
  const [drawerOccupantsLoading, setDrawerOccupantsLoading] = useState(false);
  // Courtiers/experts mandatés sur le dossier (dossiers_sinistres), chargés
  // avec les occupants par le même endpoint à l'ouverture du drawer.
  type DrawerCourtier = { id: string; nom: string; type: string };
  const [drawerCourtiers, setDrawerCourtiers] = useState<DrawerCourtier[]>([]);
  const [rapportInfo, setRapportInfo] = useState<{
    statut: 'brouillon' | 'valide' | 'transmis';
    valide_par: string | null;
    valide_at: string | null;
    transmis_at: string | null;
    transmis_a: string[] | null;
    degats: string | null;
    inspection: string | null;
    conclusion: string | null;
    recommandations: string | null;
    techniques: string[] | null;
  } | null>(null);
  // Techniques cochées (édition brouillon) — Set de clés canoniques.
  const [rapportTech, setRapportTech] = useState<Set<string>>(new Set());
  const [rapportInfoLoading, setRapportInfoLoading] = useState(false);
  // Galerie photos de l'intervention (consultation admin du rapport).
  const [rapportPhotos, setRapportPhotos] = useState<Array<{
    id: string; url: string; caption: string | null; piece: string | null;
    ordre_rapport: number; pris_at: string | null; filename: string | null;
  }>>([]);
  // Édition admin des 4 sections (brouillon uniquement).
  const [rapportEdit, setRapportEdit] = useState<{ degats: string; inspection: string; conclusion: string; recommandations: string } | null>(null);
  const [rapportSaveMsg, setRapportSaveMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [rapportSavePending, startRapportSaveTransition] = useTransition();
  const [rapportReopenPending, startRapportReopenTransition] = useTransition();

  // Modal SMS
  type SmsModalState = {
    name: string;
    phone: string;
    occupantId?: string;
    templateKey: 'sms_template_confirmation' | 'sms_template_lien_occupant';
    preferredChannel?: 'email' | 'sms' | 'whatsapp' | 'both' | null;
  };
  const [smsModal, setSmsModal] = useState<SmsModalState | null>(null);
  const [pendingStatut, setPendingStatut] = useState<StatutIntervention | ''>('');
  const [suspensMotif, setSuspensMotif] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [emailMessage, setEmailMessage] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [emailPending, startEmailTransition] = useTransition();
  const [validateMessage, setValidateMessage] = useState<string | null>(null);
  const [validatePending, startValidateTransition] = useTransition();
  // Assignation technicien
  const [pendingTechId, setPendingTechId] = useState<string>('');
  const [assignMessage, setAssignMessage] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [assignPending, startAssignTransition] = useTransition();

  // ── Workflow d'édition (onglet Dossier) ──────────────────────────────
  // Brouillon des champs éditables, pré-rempli depuis selected quand
  // selectedId change (useEffect plus bas).
  type FormDraft = {
    nom_client: string;
    adresse: string;
    type: string;
    telephone: string;
    email: string;
    description: string;
    priorite: 'normale' | 'urgente';
  };
  const [formDraft, setFormDraft] = useState<FormDraft>({
    nom_client: '', adresse: '', type: '', telephone: '', email: '',
    description: '', priorite: 'normale',
  });
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [formPending, startFormTransition] = useTransition();

  // Schedule
  const [scheduleDate, setScheduleDate] = useState<string>('');
  const [scheduleHeure, setScheduleHeure] = useState<string>('');
  const [scheduleCreneauId, setScheduleCreneauId] = useState<string | null>(null);
  type AvailableCreneau = { id: string; date: string; heure_debut: string; heure_fin: string; technicien_id: string | null };
  const [availableCreneaux, setAvailableCreneaux] = useState<AvailableCreneau[]>([]);
  const [scheduleMsg, setScheduleMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [schedulePending, startScheduleTransition] = useTransition();

  // Notify occupants (multi-canal)
  const [notifySelectedIds, setNotifySelectedIds] = useState<Set<string>>(new Set());
  const [notifyMsg, setNotifyMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [notifyPending, startNotifyTransition] = useTransition();

  // Confirmation client (email Gmail)
  const [confirmMailMsg, setConfirmMailMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmMailPending, startConfirmMailTransition] = useTransition();

  // Suppression intervention
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, startDeleteTransition] = useTransition();
  // Soft-delete depuis l'icône poubelle de la ligne (indépendant du
  // drawer + indépendant du hard-delete cascade existant).
  const [deletingRow, setDeletingRow] = useState<{ id: string; ref: string | null } | null>(null);
  const [rowDeletePending, startRowDeleteTransition] = useTransition();
  const [rowDeleteErr, setRowDeleteErr] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Relance occupants depuis l'icône d'envoi de la ligne (réutilise la route
  // notify-occupants ; indépendant du drawer). relanceConfirm = ligne en attente
  // de confirmation ; relancingId = ligne dont l'envoi est en cours ; relanceMsg
  // = feedback transitoire par ligne.
  const [relanceConfirm, setRelanceConfirm] = useState<{ id: string; ref: string | null } | null>(null);
  const [relancingId, setRelancingId] = useState<string | null>(null);
  const [relanceMsg, setRelanceMsg] = useState<{ id: string; kind: 'ok' | 'err'; text: string } | null>(null);
  const [planningRow, setPlanningRow] = useState<{ id: string; ref: string | null; adresse: string | null; urgence: boolean } | null>(null);

  // Réanalyse mail
  type ReanalysisData = {
    analysis: {
      est_demande_intervention: boolean;
      nom_client: string | null;
      adresse: string | null;
      type_probleme: string | null;
      telephone: string | null;
      email: string | null;
      priorite: 'normale' | 'urgente' | null;
      resume: string | null;
      langue: 'fr' | 'nl' | 'en' | null;
      type_demandeur: 'syndic' | 'courtier' | 'particulier' | null;
      nom_societe: string | null;
      nom_immeuble: string | null;
      adresse_immeuble: string | null;
      reference_externe: string | null;
      occupants: { prenom: string; nom: string; email: string; appartement: string; etage: string; telephone: string; type: 'occupant' | 'proprietaire' | 'parties_communes'; notes: string }[];
      delegue: { prenom: string | null; nom: string | null; email: string | null; telephone: string | null } | null;
      // Champs ajoutés par le nouveau prompt FoxO opérationnel
      description_precise?: string | null;
      appartements_concernes?: string[];
      zones_communes?: string[];
      assurance?: { nom_contact: string | null; email: string | null; telephone: string | null; reference_police: string | null } | null;
      action_requise?: string | null;
      type_email?: 'nouvelle_demande' | 'suivi_dossier' | 'confirmation_rdv' | 'annulation' | 'rapport_demande' | 'autre' | null;
    };
  };
  const [reanalysis, setReanalysis] = useState<ReanalysisData | null>(null);
  const [reanalyzePending, startReanalyzeTransition] = useTransition();
  const [reanalyzeMsg, setReanalyzeMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Édition d'un occupant — un seul mode édition / ajout actif à la fois
  type OccupantForm = {
    prenom: string; nom: string; email: string; telephone: string;
    appartement: string; etage: string;
    contact_preference: 'email' | 'sms' | 'whatsapp' | 'both';
    type_occupant: TypeOccupant;
  };
  const EMPTY_OCC_FORM: OccupantForm = {
    prenom: '', nom: '', email: '', telephone: '',
    appartement: '', etage: '', contact_preference: 'email',
    type_occupant: 'occupant',
  };
  const [editingOccupantId, setEditingOccupantId] = useState<string | null>(null);
  const [addingOccupant, setAddingOccupant] = useState(false);
  const [occupantForm, setOccupantForm] = useState<OccupantForm>(EMPTY_OCC_FORM);
  const [occupantSaving, setOccupantSaving] = useState(false);

  // "En cours" est synthétique → confirmee + realisee. Pour le mois en cours
  // sur "cloturee", on filtre aussi par updated_at dans le mois courant.
  const today = useMemo(() => new Date(), []);
  function statutMatches(ivStatut: StatutIntervention, ivUpdatedAt: string | null): boolean {
    if (!statutParam) return true;
    if (statutParam === 'en_cours') return ivStatut === 'confirmee' || ivStatut === 'realisee';
    if (statutParam === 'a_relancer') return ivStatut === 'attente' || ivStatut === 'en_suspens';
    if (statutParam === 'cloturee') {
      if (ivStatut !== 'cloturee') return false;
      if (!ivUpdatedAt) return true;
      const d = new Date(ivUpdatedAt);
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    }
    return ivStatut === statutParam;
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((iv) => {
      const matchQuery =
        !q ||
        [iv.ref, iv.acp?.nom, iv.acp?.ville, iv.acp?.adresse, iv.syndic?.nom, iv.description]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q));
      const matchSelectFilter = filter === 'tous' || iv.statut === filter;
      const matchUrlStatut = statutMatches(iv.statut, iv.updated_at);
      const matchTech = !techFilter || iv.technicien_id === techFilter;
      const matchRecentResponses = !recentResponsesFilter || recentResponseIvIds.has(iv.id);
      const matchAcp = !acpIdFilter || iv.acp_id === acpIdFilter;
      return matchQuery && matchSelectFilter && matchUrlStatut && matchTech && matchRecentResponses && matchAcp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filter, techFilter, statutParam, recentResponsesFilter, recentResponseIvIds, acpIdFilter]);

  const techFilterName = useMemo(() => {
    if (!techFilter) return null;
    const t = techs.find((x) => x.id === techFilter);
    if (!t) return null;
    return [t.prenom, t.nom].filter(Boolean).join(' ') || t.email || 'Technicien';
  }, [techFilter, techs]);

  // Libellé du filtre statut pour le titre du pipeline
  const statutFilterLabel = useMemo(() => {
    if (!statutParam) return null;
    const map: Record<string, string> = {
      nouvelle: 'Nouvelles demandes',
      en_cours: 'En cours',
      en_suspens: 'En suspens',
      rapport: 'Rapports à envoyer',
      cloturee: 'Clôturées ce mois',
    };
    return map[statutParam] ?? null;
  }, [statutParam]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  // Stats
  const stats = useMemo(() => {
    const inProgress = rows.filter((r) =>
      ['confirmee', 'realisee', 'attente'].includes(r.statut),
    ).length;
    const suspended = rows.filter((r) => r.statut === 'en_suspens').length;
    const reports = rows.filter((r) => r.statut === 'rapport').length;
    const closed = rows.filter((r) => r.statut === 'cloturee').length;
    const urgent = rows.filter((r) => r.priorite === 'urgente' && r.statut !== 'cloturee').length;
    return { inProgress, suspended, reports, closed, urgent };
  }, [rows]);

  function openDrawer(id: string, initialTab: 'dossier' | 'suivi' | 'documents' | 'ia' | 'historique' = 'dossier') {
    const iv = rows.find((r) => r.id === id);
    setSelectedId(id);
    setTab(initialTab);
    setPendingStatut(iv?.statut ?? '');
    setSuspensMotif(iv?.suspens_motif ?? '');
    setPendingTechId(iv?.technicien?.id ?? '');
    setStatusMessage(null);
    setAssignMessage(null);

    // Pré-remplit le brouillon d'édition depuis l'intervention
    const pc = iv?.particulier_contact;
    const nomComplet = pc ? [pc.prenom, pc.nom].filter(Boolean).join(' ') : '';
    setFormDraft({
      nom_client: nomComplet,
      adresse: iv?.adresse ?? '',
      type: iv?.type ?? '',
      telephone: pc?.telephone ?? '',
      email: pc?.email ?? '',
      description: iv?.description ?? '',
      priorite: iv?.priorite ?? 'normale',
    });
    setFormMsg(null);

    // Pré-remplit la date/heure depuis creneau_debut
    if (iv?.creneau_debut) {
      const d = new Date(iv.creneau_debut);
      setScheduleDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      setScheduleHeure(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } else {
      setScheduleDate('');
      setScheduleHeure('');
    }
    setScheduleCreneauId(null);
    setAvailableCreneaux([]);
    setScheduleMsg(null);

    setNotifySelectedIds(new Set());
    setNotifyMsg(null);
    setConfirmMailMsg(null);

    // Lazy-load occupants (+ courtiers mandatés, même endpoint)
    setDrawerOccupants([]);
    setDrawerCourtiers([]);
    setDrawerOccupantsLoading(true);
    fetch(`/api/admin/occupants/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setDrawerOccupants(data.occupants ?? []);
          setDrawerCourtiers(data.courtiers ?? []);
          // Cocher tous les occupants par défaut pour la notif
          setNotifySelectedIds(new Set((data.occupants ?? []).map((o: { id: string }) => o.id)));
        }
      })
      .catch(() => { /* noop */ })
      .finally(() => setDrawerOccupantsLoading(false));

    // Lazy-load état du rapport (statut/validation/transmission)
    setRapportInfo(null);
    refreshRapportInfo(id);
  }
  function closeDrawer() {
    // En mode page complète, "Fermer" = retour à la liste /admin
    if (fullPage) {
      router.push('/admin');
      return;
    }
    setSelectedId(null);
    setStatusMessage(null);
    setAssignMessage(null);
    setIaSaveMessage(null);
    setDrawerOccupants([]);
    setDrawerCourtiers([]);
    setRapportInfo(null);
    setRapportInfoLoading(false);
    setValidateMessage(null);
  }

  // Mode page complète : ouvre automatiquement le drawer pour
  // l'intervention demandée au mount. openDrawer initialise tous les
  // brouillons de formulaire et déclenche le fetch des occupants
  // (cascade de setState) — wrappé en queueMicrotask pour rester hors
  // du body sync de l'effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (fullPage && initialSelectedId && rows.some((r) => r.id === initialSelectedId)) {
      queueMicrotask(() => openDrawer(initialSelectedId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAiRapportSave(sections: { degats: string; inspection: string; conclusion: string; recommandations: string }) {
    if (!selected) return;
    setIaSaveMessage(null);
    startIaSaveTransition(async () => {
      const res = await saveRapportDraftFromAdmin(selected.id, sections);
      if (res.error) {
        setIaSaveMessage({ kind: 'err', msg: res.error });
      } else {
        setIaSaveMessage({ kind: 'ok', msg: 'Brouillon sauvegardé. Le tech le verra dans son onglet Rapport.' });
      }
    });
  }

  function applyAssignTech() {
    if (!selected) return;
    setAssignMessage(null);
    const newTechId = pendingTechId || null;
    const newTech = newTechId ? techs.find((t) => t.id === newTechId) ?? null : null;
    startAssignTransition(async () => {
      const res = await assignTechnician(selected.id, newTechId);
      if (res.error) {
        setAssignMessage({ kind: 'err', msg: 'Erreur : ' + res.error });
        return;
      }
      // Optimistic local update
      setRows((rs) =>
        rs.map((r) =>
          r.id === selected.id
            ? { ...r, technicien_id: newTechId, technicien: newTech, updated_at: new Date().toISOString() }
            : r,
        ),
      );
      setAssignMessage({
        kind: 'ok',
        msg: newTech ? `Assigné à ${newTech.prenom ?? ''} ${newTech.nom ?? ''}`.trim() : 'Désassigné',
      });
    });
  }

  const refreshRapportInfo = (id: string) => {
    setRapportInfoLoading(true);
    setRapportSaveMsg(null);
    setRapportEdit(null);
    fetch(`/api/admin/rapports/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setRapportInfo(data.rapport);
          setRapportPhotos(Array.isArray(data.photos) ? data.photos : []);
          setRapportTech(new Set(Array.isArray(data.rapport?.techniques) ? data.rapport.techniques : []));
          // Pré-remplit le formulaire d'édition (utilisé seulement en brouillon).
          if (data.rapport) {
            setRapportEdit({
              degats: data.rapport.degats ?? '',
              inspection: data.rapport.inspection ?? '',
              conclusion: data.rapport.conclusion ?? '',
              recommandations: data.rapport.recommandations ?? '',
            });
          }
        }
      })
      .catch((e) => console.warn('[admin/interventions] chargement état rapport échoué (best-effort)', e))
      .finally(() => setRapportInfoLoading(false));
  };

  function saveRapportCorrections() {
    if (!selected || !rapportEdit) return;
    setRapportSaveMsg(null);
    startRapportSaveTransition(async () => {
      const res = await saveRapportDraftFromAdmin(selected.id, rapportEdit, Array.from(rapportTech));
      if (res.error) setRapportSaveMsg({ kind: 'err', msg: res.error });
      else {
        setRapportSaveMsg({ kind: 'ok', msg: 'Corrections enregistrées.' });
        refreshRapportInfo(selected.id);
      }
    });
  }

  function reopenRapport() {
    if (!selected) return;
    setRapportSaveMsg(null);
    startRapportReopenTransition(async () => {
      const res = await reopenRapportDraft(selected.id);
      if (res.error) setRapportSaveMsg({ kind: 'err', msg: res.error });
      else {
        setRapportSaveMsg({ kind: 'ok', msg: 'Rapport repassé en brouillon.' });
        refreshRapportInfo(selected.id);
      }
    });
  }

  function reopenTransmitted() {
    if (!selected) return;
    if (!confirm('Ce rapport a déjà été transmis au syndic. Le rouvrir permet de le corriger, puis il devra être re-validé et re-transmis (le syndic recevra la version corrigée). Continuer ?')) return;
    setEmailMessage(null);
    startRapportReopenTransition(async () => {
      const res = await reopenTransmittedRapport(selected.id);
      if (res.error) setEmailMessage({ kind: 'err', msg: res.error });
      else {
        setEmailMessage({ kind: 'ok', msg: 'Rapport rouvert pour correction — repassé en brouillon.' });
        refreshRapportInfo(selected.id);
      }
    });
  }

  function resendRapport() {
    if (!selected) return;
    setEmailMessage(null);
    startEmailTransition(async () => {
      const res = await resendRapportToSyndic(selected.id);
      if (res.error) setEmailMessage({ kind: 'err', msg: res.error });
      else {
        setEmailMessage({ kind: 'ok', msg: 'Rapport envoyé au syndic' });
        refreshRapportInfo(selected.id);
      }
    });
  }

  const handleValidate = () => {
    if (!selected) return;
    setValidateMessage(null);
    startValidateTransition(async () => {
      const res = await validateRapport(selected.id);
      if (res.ok) {
        setValidateMessage('Rapport validé.');
        refreshRapportInfo(selected.id);
      } else {
        setValidateMessage(res.error ?? 'Erreur lors de la validation.');
      }
    });
  };

  function applyStatus() {
    if (!selected || !pendingStatut) return;
    setStatusMessage(null);
    startTransition(async () => {
      const res = await updateInterventionStatus(
        selected.id,
        pendingStatut as StatutIntervention,
        pendingStatut === 'en_suspens' ? suspensMotif : null,
      );
      if (res.error) {
        setStatusMessage('Erreur : ' + res.error);
        return;
      }
      // Optimistic local update
      setRows((rs) =>
        rs.map((r) =>
          r.id === selected.id
            ? {
                ...r,
                statut: pendingStatut as StatutIntervention,
                suspens_motif: pendingStatut === 'en_suspens' ? suspensMotif : null,
                updated_at: new Date().toISOString(),
              }
            : r,
        ),
      );
      setStatusMessage('Statut mis à jour');
    });
  }

  // ── Workflow actions ────────────────────────────────────────────────

  // Charge les créneaux libres du technicien sélectionné, pour le picker.
  useEffect(() => {
    if (!selectedId || !pendingTechId) {
      // queueMicrotask : sort le setState du body sync de l'effect
      // (respecte react-hooks/set-state-in-effect).
      queueMicrotask(() => setAvailableCreneaux([]));
      return;
    }
    let mounted = true;
    fetch(`/api/admin/interventions/${selectedId}/schedule?tech=${pendingTechId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) setAvailableCreneaux(data.creneaux ?? []);
      })
      .catch(() => { /* noop */ });
    return () => { mounted = false; };
  }, [selectedId, pendingTechId]);

  function saveForm() {
    if (!selected) return;
    setFormMsg(null);
    startFormTransition(async () => {
      try {
        const r = await fetch(`/api/admin/interventions/${selected.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formDraft),
        });
        const data = await r.json();
        if (!data.ok) {
          setFormMsg({ kind: 'err', msg: data.error ?? 'Échec sauvegarde.' });
          return;
        }
        // Update local row optimistic
        setRows((rs) => rs.map((rw) => {
          if (rw.id !== selected.id) return rw;
          const parts = formDraft.nom_client.trim().split(/\s+/);
          const prenom = parts.length >= 2 ? parts[0] : '';
          const nom = parts.length >= 2 ? parts.slice(1).join(' ') : formDraft.nom_client.trim();
          return {
            ...rw,
            adresse: formDraft.adresse || null,
            type: formDraft.type || null,
            description: formDraft.description || null,
            priorite: formDraft.priorite,
            particulier_contact: rw.particulier_contact ? {
              ...rw.particulier_contact,
              prenom,
              nom,
              telephone: formDraft.telephone,
              email: formDraft.email,
            } : rw.particulier_contact,
            updated_at: new Date().toISOString(),
          };
        }));
        setFormMsg({ kind: 'ok', msg: 'Sauvegardé' });
      } catch (e) {
        setFormMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      }
    });
  }

  function applySchedule() {
    if (!selected) return;
    if (!scheduleDate || !scheduleHeure) {
      setScheduleMsg({ kind: 'err', msg: 'Date et heure requises.' });
      return;
    }
    setScheduleMsg(null);
    startScheduleTransition(async () => {
      try {
        const r = await fetch(`/api/admin/interventions/${selected.id}/schedule`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: scheduleDate,
            heure: scheduleHeure,
            creneau_id: scheduleCreneauId,
          }),
        });
        const data = await r.json();
        if (!data.ok) {
          setScheduleMsg({ kind: 'err', msg: data.error ?? 'Échec planification.' });
          return;
        }
        const iso = new Date(`${scheduleDate}T${scheduleHeure}:00`).toISOString();
        setRows((rs) => rs.map((rw) =>
          rw.id === selected.id
            ? { ...rw, creneau_debut: iso, statut: 'attente', updated_at: new Date().toISOString() }
            : rw,
        ));
        setScheduleMsg({ kind: 'ok', msg: 'Créneau planifié — statut "attente"' });
      } catch (e) {
        setScheduleMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      }
    });
  }

  function notifyOccupants() {
    if (!selected) return;
    if (notifySelectedIds.size === 0) {
      setNotifyMsg({ kind: 'err', msg: 'Sélectionne au moins un occupant.' });
      return;
    }
    setNotifyMsg(null);
    startNotifyTransition(async () => {
      try {
        const r = await fetch(`/api/admin/interventions/${selected.id}/notify-occupants`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ occupant_ids: Array.from(notifySelectedIds) }),
        });
        const data = await r.json();
        if (!data.ok) {
          setNotifyMsg({ kind: 'err', msg: data.error ?? 'Échec envoi.' });
          return;
        }
        setNotifyMsg({
          kind: 'ok',
          msg: `${data.sent} envoi(s) OK${data.failed ? ` · ${data.failed} échec(s)` : ''}`,
        });
      } catch (e) {
        setNotifyMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      }
    });
  }

  async function refreshOccupants() {
    if (!selected) return;
    try {
      const r = await fetch(`/api/admin/occupants/${selected.id}`, { cache: 'no-store' });
      const data = await r.json();
      if (data.ok) setDrawerOccupants(data.occupants ?? []);
    } catch { /* noop */ }
  }

  async function refreshCourtiers() {
    if (!selected) return;
    try {
      const r = await fetch(`/api/admin/occupants/${selected.id}`, { cache: 'no-store' });
      const data = await r.json();
      if (data.ok) setDrawerCourtiers(data.courtiers ?? []);
    } catch { /* noop */ }
  }

  async function acceptCounterProposal(occ: DrawerOccupant) {
    if (!selected) return;
    if (!occ.proposed_creneau_debut) return;

    const fullName = [occ.prenom, occ.nom].filter(Boolean).join(' ') || 'l\'occupant';
    const debutFr = new Date(occ.proposed_creneau_debut).toLocaleString('fr-BE', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS,
    });
    const finFr = occ.proposed_creneau_fin ? fmtTime(occ.proposed_creneau_fin) : null;
    const rangeStr = finFr ? `${debutFr} – ${finFr}` : debutFr;
    const ok = window.confirm(
      `Accepter le créneau proposé par ${fullName} : ${rangeStr} ?\n\n` +
      `L'intervention sera reprogrammée, le statut passera à "Confirmée" et l'occupant sera notifié.`,
    );
    if (!ok) return;

    // Optimistic update
    const newCreneau = occ.proposed_creneau_debut;
    const occId = occ.id;
    setDrawerOccupants((arr) => arr.map((x) => x.id === occId
      ? { ...x, conf: 'confirme', proposed_creneau_debut: null, proposed_creneau_fin: null }
      : x,
    ));
    setRows((arr) => arr.map((rw) => rw.id === selected.id
      ? { ...rw, creneau_debut: newCreneau, statut: 'confirmee' as const }
      : rw,
    ));
    setStatusMessage('Acceptation en cours…');

    try {
      const res = await fetch(`/api/admin/interventions/${selected.id}/accept-counter-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occupant_id: occId }),
      });
      const data = await res.json();
      if (!data.ok) {
        // Rollback : on recharge les données serveur autoritatives
        await refreshOccupants();
        setStatusMessage(`Erreur : ${data.error ?? 'inconnue'}`);
        return;
      }
      const calOk = data.calendarSync?.ok;
      const notifsOk = Array.isArray(data.notifs) ? data.notifs.filter((n: { ok: boolean }) => n.ok).length : 0;
      setStatusMessage(
        `Proposition acceptée${calOk ? ' (Google Calendar synchronisé)' : ''}${notifsOk > 0 ? ` · ${notifsOk} notif(s) envoyée(s)` : ''}.`,
      );
    } catch (e) {
      await refreshOccupants();
      setStatusMessage(`Erreur : ${e instanceof Error ? e.message : 'inconnue'}`);
    }
  }

  function startEditOccupant(o: DrawerOccupant) {
    setAddingOccupant(false);
    setEditingOccupantId(o.id);
    setOccupantForm({
      prenom: o.prenom ?? '',
      nom: o.nom ?? '',
      email: o.email ?? '',
      telephone: o.telephone ?? '',
      appartement: o.appartement ?? '',
      etage: o.etage ?? '',
      contact_preference: (o.contact_preference ?? 'email') as OccupantForm['contact_preference'],
      type_occupant: o.type_occupant ?? 'occupant',
    });
  }

  function startAddOccupant() {
    setEditingOccupantId(null);
    setAddingOccupant(true);
    setOccupantForm(EMPTY_OCC_FORM);
  }

  function cancelOccupantForm() {
    setEditingOccupantId(null);
    setAddingOccupant(false);
    setOccupantForm(EMPTY_OCC_FORM);
  }

  async function saveOccupant() {
    if (!selected) return;
    setOccupantSaving(true);
    try {
      const url = editingOccupantId
        ? `/api/admin/occupants/manage/${editingOccupantId}`
        : `/api/admin/occupants/${selected.id}`;
      const method = editingOccupantId ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(occupantForm),
      });
      const data = await r.json();
      if (!data.ok) {
        alert(data.error ?? 'Échec sauvegarde occupant.');
        return;
      }
      cancelOccupantForm();
      await refreshOccupants();
    } finally {
      setOccupantSaving(false);
    }
  }

  async function deleteOccupant(occId: string) {
    if (!confirm('Supprimer cet occupant ?')) return;
    setOccupantSaving(true);
    try {
      const r = await fetch(`/api/admin/occupants/manage/${occId}`, { method: 'DELETE' });
      const data = await r.json();
      if (!data.ok) {
        alert(data.error ?? 'Échec suppression.');
        return;
      }
      cancelOccupantForm();
      await refreshOccupants();
    } finally {
      setOccupantSaving(false);
    }
  }

  async function eraseOccupant(occId: string) {
    if (!confirm("EFFACEMENT RGPD - action irreversible.\n\nLes donnees personnelles de cet occupant (nom, contacts, messages SMS) seront definitivement anonymisees dans toute la plateforme. L'historique de l'intervention est conserve.\n\nConfirmer l'effacement ?")) return;
    setOccupantSaving(true);
    try {
      const r = await fetch(`/api/admin/occupants/manage/${occId}/erase`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) { alert(data.error ?? "Echec de l'effacement RGPD."); return; }
      cancelOccupantForm();
      await refreshOccupants();
    } finally {
      setOccupantSaving(false);
    }
  }

  function deleteIntervention() {
    if (!selected) return;
    setDeleteMsg(null);
    startDeleteTransition(async () => {
      try {
        const r = await fetch(`/api/admin/interventions/${selected.id}`, { method: 'DELETE' });
        const data = await r.json();
        if (!data.ok) {
          setDeleteMsg({ kind: 'err', msg: data.error ?? 'Échec suppression.' });
          return;
        }
        // Update optimiste : retire de la liste + ferme drawer
        setRows((rs) => rs.filter((r2) => r2.id !== selected.id));
        setDeleteConfirmOpen(false);
        setSelectedId(null);
      } catch (e) {
        setDeleteMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      }
    });
  }

  // Soft delete depuis l'icône poubelle de la ligne. Différent du hard-
  // delete cascade ci-dessus : ici on pose deleted_at, on retire la ligne
  // localement, et on garde toutes les données enfants (timeline, mails,
  // photos, occupants) pour pouvoir restaurer plus tard si besoin.
  function softDeleteRow() {
    if (!deletingRow) return;
    setRowDeleteErr(null);
    startRowDeleteTransition(async () => {
      try {
        const r = await fetch(`/api/admin/interventions/${deletingRow.id}/delete`, { method: 'DELETE' });
        const data = await r.json();
        if (!data.ok) {
          setRowDeleteErr(data.error ?? 'Échec suppression.');
          return;
        }
        // Update optimiste : retire de la liste sans recharger
        setRows((rs) => rs.filter((r2) => r2.id !== deletingRow.id));
        // Ferme aussi le drawer si on supprimait l'intervention sélectionnée
        if (selectedId === deletingRow.id) setSelectedId(null);
        setDeletingRow(null);
      } catch (e) {
        setRowDeleteErr(e instanceof Error ? e.message : 'Erreur réseau.');
      }
    });
  }

  // Relance occupants : la route notify-occupants exige des occupant_ids, donc
  // on récupère d'abord les occupants du dossier (route GET existante) puis on
  // POST. Best-effort : ne crashe jamais, feedback transitoire par ligne.
  async function relanceOccupants(interventionId: string) {
    setRelanceConfirm(null);
    setRelanceMsg(null);
    setRelancingId(interventionId);
    try {
      const occData = await fetch(`/api/admin/occupants/${interventionId}`).then((r) => r.json());
      const occIds: string[] = occData?.ok
        ? ((occData.occupants ?? []) as { id: string }[]).map((o) => o.id)
        : [];
      if (occIds.length === 0) {
        setRelanceMsg({ id: interventionId, kind: 'err', text: 'Aucun occupant à relancer.' });
        return;
      }
      const res = await fetch(`/api/admin/interventions/${interventionId}/notify-occupants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occupant_ids: occIds }),
      }).then((r) => r.json());
      if (res?.ok) {
        setRelanceMsg({ id: interventionId, kind: 'ok', text: `Relance envoyée (${res.sent}/${occIds.length}).` });
      } else {
        setRelanceMsg({ id: interventionId, kind: 'err', text: res?.error ?? 'Échec de la relance.' });
      }
    } catch (e) {
      setRelanceMsg({ id: interventionId, kind: 'err', text: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setRelancingId(null);
    }
  }

  // Log de gating : dès que selectedId change, on log les conditions
  // qui décident de l'affichage du bouton Réanalyser.
  useEffect(() => {
    if (!selected) return;
    if (selected.source !== 'mail') return;
    console.info('[reanalyze-ui] gating', {
      id: selected.id,
      ref: selected.ref,
      source: selected.source,
      statut: selected.statut,
      source_mail_id: selected.source_mail_id,
      button_visible: Boolean(selected.source_mail_id),
    });
  }, [selected]);

  function reanalyzeMail() {
    if (!selected) {
      console.warn('[reanalyze-ui] aborted: no selected intervention');
      return;
    }
    console.info('[reanalyze-ui] clicked', {
      id: selected.id,
      ref: selected.ref,
      source: selected.source,
      source_mail_id: selected.source_mail_id,
      statut: selected.statut,
    });
    setReanalysis(null);
    setReanalyzeMsg(null);
    startReanalyzeTransition(async () => {
      try {
        const url = `/api/admin/interventions/${selected.id}/reanalyze`;
        console.info('[reanalyze-ui] POST', url);
        const r = await fetch(url, { method: 'POST' });
        let data: { ok?: boolean; error?: string; code?: string; analysis?: unknown };
        try {
          data = await r.json();
        } catch {
          data = { ok: false, error: `HTTP ${r.status} (réponse non-JSON)` };
        }
        console.info('[reanalyze-ui] response', { status: r.status, ok: data.ok, error: data.error, code: data.code });
        if (!data.ok) {
          if (data.code === 'google_not_connected') {
            setReanalyzeMsg({ kind: 'err', msg: 'Google non connecté — connecte le compte dans /admin/parametres.' });
          } else {
            setReanalyzeMsg({ kind: 'err', msg: data.error ?? `Échec analyse (HTTP ${r.status}).` });
          }
          return;
        }
        setReanalysis({ analysis: data.analysis as ReanalysisData['analysis'] });
      } catch (e) {
        console.error('[reanalyze-ui] network error', e);
        setReanalyzeMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      }
    });
  }

  function applyReanalysis() {
    if (!selected || !reanalysis) return;
    setReanalyzeMsg(null);
    startReanalyzeTransition(async () => {
      try {
        const r = await fetch(`/api/admin/interventions/${selected.id}/apply-reanalysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysis: reanalysis.analysis }),
        });
        const data = await r.json();
        if (!data.ok) {
          setReanalyzeMsg({ kind: 'err', msg: data.error ?? 'Échec application.' });
          return;
        }
        setReanalysis(null);
        // Si l'intervention est OK mais que l'insert occupants a planté,
        // on affiche un warning détaillé (colonne manquante, RLS, etc.)
        if (data.occupants_error) {
          const stripped = Array.isArray(data.occupants_stripped_columns) && data.occupants_stripped_columns.length > 0
            ? ` · colonnes strippées : ${data.occupants_stripped_columns.join(', ')}`
            : '';
          setReanalyzeMsg({
            kind: 'err',
            msg: `Analyse OK mais occupants non insérés : [${data.occupants_error_code ?? '?'}] ${data.occupants_error}${stripped}`,
          });
        } else {
          setReanalyzeMsg({
            kind: 'ok',
            msg: `Analyse appliquée${data.new_occupants_count ? ` · ${data.new_occupants_count} nouveau(x) occupant(s)` : ''}`,
          });
        }
        // Refresh occupants + intervention via reload occupants + router.refresh
        await refreshOccupants();
        router.refresh();
      } catch (e) {
        setReanalyzeMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      }
    });
  }

  function sendConfirmMail() {
    if (!selected) return;
    setConfirmMailMsg(null);
    startConfirmMailTransition(async () => {
      try {
        const r = await fetch(`/api/admin/interventions/${selected.id}/confirm-mail`, { method: 'POST' });
        const data = await r.json();
        if (!data.ok) {
          setConfirmMailMsg({
            kind: 'err',
            msg: data.code === 'google_not_connected'
              ? 'Google non connecté — connecte le compte dans /admin/parametres.'
              : (data.error ?? 'Échec envoi.'),
          });
          return;
        }
        setRows((rs) => rs.map((rw) =>
          rw.id === selected.id ? { ...rw, statut: 'confirmee', updated_at: new Date().toISOString() } : rw,
        ));
        setConfirmMailMsg({ kind: 'ok', msg: 'Confirmation envoyée — statut "confirmée"' });
      } catch (e) {
        setConfirmMailMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
      }
    });
  }

  return (
    <>
      {smsModal && selected && (
        <SendSmsModal
          open
          onClose={() => setSmsModal(null)}
          recipientName={smsModal.name}
          recipientPhone={smsModal.phone}
          templateKey={smsModal.templateKey}
          interventionId={selected.id}
          occupantId={smsModal.occupantId}
          preferredChannel={smsModal.preferredChannel ?? null}
        />
      )}

      {deleteConfirmOpen && selected && (
        <DeleteInterventionModal
          ref={selected.ref}
          pending={deletePending}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={deleteIntervention}
        />
      )}

      {/* Soft-delete depuis l'icône poubelle de la ligne */}
      {deletingRow && (
        <SoftDeleteRowModal
          ref={deletingRow.ref}
          pending={rowDeletePending}
          error={rowDeleteErr}
          onCancel={() => { setDeletingRow(null); setRowDeleteErr(null); }}
          onConfirm={softDeleteRow}
        />
      )}

      {planningRow && (
        <PlanRowModal
          intervention={planningRow}
          onClose={() => setPlanningRow(null)}
          onScheduled={() => { setPlanningRow(null); router.refresh(); }}
        />
      )}

      {relanceConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setRelanceConfirm(null)}
        >
          <div
            className="bg-[var(--color-cream)] rounded-xl p-5 w-full max-w-[360px]"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
          >
            <h3 className="font-sora text-[15px] font-semibold text-[var(--color-ink)] mb-1.5">
              Relancer les occupants de ce dossier ?
            </h3>
            <p className="text-[13px] text-[var(--color-ink-mid)] leading-relaxed mb-4">
              Une demande de confirmation va être renvoyée par email / SMS aux occupants
              {relanceConfirm.ref ? ` du dossier ${relanceConfirm.ref}` : ''}. De vrais messages seront envoyés.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRelanceConfirm(null)}
                className="px-3 py-2 rounded-lg text-xs font-medium text-[var(--color-ink-mid)] hover:bg-[var(--color-sand)]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => relanceOccupants(relanceConfirm.id)}
                className="px-3 py-2 rounded-lg text-xs font-bold bg-[var(--color-navy)] text-white inline-flex items-center gap-1.5"
              >
                <Send size={14} />Relancer les occupants
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Topbar + liste — masqués en mode page complète */}
      {!fullPage && (
      <>
      <div className="px-6 pt-6 flex flex-wrap items-end justify-between gap-3 pb-3.5 border-b border-[var(--color-sand-border)] flex-shrink-0">
        <div>
          <h1 className="fxs-page-title mb-1">
            Tableau de bord
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide capitalize">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {new Date(nowMs).toLocaleDateString('fr-BE', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {techFilterName && (
            <div className="bg-[var(--color-amber-foxo)] text-[var(--color-cream)] rounded-full px-3 py-1.5 text-[11px] font-medium flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5"><Search size={12} />Filtré : {techFilterName}</span>
              <button
                type="button"
                onClick={() => router.push('/admin')}
                className="hover:opacity-70 leading-none"
                title="Retirer le filtre"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {recentResponsesFilter && (
            <div className="bg-[var(--color-terra)] text-[var(--color-cream)] rounded-full px-3 py-1.5 text-[11px] font-medium flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5"><Inbox size={12} />Réponses occupants &lt; 48 h ({recentResponseIvIds.size})</span>
              <button
                type="button"
                onClick={() => router.push('/admin')}
                className="hover:opacity-70 leading-none"
                title="Retirer le filtre"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 text-[var(--color-amber-foxo)] rounded-lg text-xs font-semibold flex-shrink-0">
          Connexion à la base limitée : {loadError}
        </div>
      )}

      {/* Dashboard adaptive : Briefing IA + Missions du jour + Chat
          express + sections détaillées (KPIs, mails, todo). Sur mobile
          le détail bascule dans un accordéon ; la carte admin
          server-rendered est masquée et re-rendue dans cet accordéon
          via adminPins. */}
      <div className="px-6 pt-4 flex-shrink-0">
        <Dashboard
          rows={rows}
          dashboard={dashboard}
          onOpenIntervention={openDrawer}
          statutFilter={statutParam}
          nowMs={nowMs}
          adminPins={adminPins}
        />
      </div>

      {/* Section 4 : Liste des interventions */}
      <div className="px-6 pt-5 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h3 className="text-[10px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em] dark:text-[#C8C2B8]">
            {statutFilterLabel
              ? <>Interventions — <span className="text-[var(--color-navy)] dark:text-[#A8C4F2]">{statutFilterLabel}</span> ({filtered.length})</>
              : `Toutes les interventions (${filtered.length})`}
          </h3>
          {statutFilterLabel && (
            <a
              href={techFilter ? `/admin?tech=${techFilter}` : '/admin'}
              className="text-[11px] text-[var(--color-navy)] underline hover:no-underline inline-flex items-center gap-1 dark:text-[#A8C4F2]"
            >
              <X size={12} />Effacer le filtre
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => router.push('/admin')}
            className={
              'px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ' +
              (!techFilter
                ? 'bg-[var(--color-navy)] text-[var(--color-cream)] border-[var(--color-navy)]'
                : 'bg-[var(--color-cream)] text-[var(--color-ink-mid)] border-[var(--color-sand-border)] hover:border-[var(--color-navy-mid)]')
            }
          >
            Tous
          </button>
          {techs.map((t) => {
            const active = techFilter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => router.push(active ? '/admin' : `/admin?tech=${t.id}`)}
                className={
                  'px-3 py-1.5 rounded-md text-[12px] font-medium border transition-colors ' +
                  (active
                    ? 'bg-[var(--color-amber-foxo)] text-[var(--color-cream)] border-[var(--color-amber-foxo)]'
                    : 'bg-[var(--color-cream)] text-[var(--color-ink-mid)] border-[var(--color-sand-border)] hover:border-[var(--color-amber-foxo)]')
                }
              >
                {[t.prenom, t.nom].filter(Boolean).join(' ') || t.email}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtres recherche / statut */}
      <div className="flex gap-2 px-6 pt-2 flex-shrink-0">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — référence, ACP, syndic, adresse…"
          className="flex-1 px-3.5 py-2.5 border border-[var(--color-sand-border)] rounded-md text-xs bg-[var(--color-cream)] outline-none focus:border-[var(--color-navy-mid)] transition-colors"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2.5 border border-[var(--color-sand-border)] rounded-md text-xs bg-[var(--color-cream)] cursor-pointer outline-none focus:border-[var(--color-navy-mid)]"
        >
          <option value="tous">Tous statuts</option>
          {STATUT_PIPELINE.map((s) => (
            <option key={s} value={s}>{STATUT_INFO[s].label}</option>
          ))}
          <option value="en_suspens">En suspens</option>
        </select>
      </div>

      {/* Table — desktop only (cf. cards mobile plus bas) */}
      <div className="flex-1 overflow-auto px-6 pt-3 pb-4">
        <div
          className="hidden md:block bg-[var(--color-cream)] rounded-[10px] overflow-hidden"
          style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
        >
          <table className="w-full border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-[var(--color-sand)]">
                {['Réf.', 'ACP', 'Type', 'Syndic', 'Technicien', 'Créneau', 'Statut', 'Màj', ''].map((h, i) => (
                  <th key={h || `col-${i}`} className="px-3.5 py-2.5 text-left text-[10px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em] border-b border-[var(--color-sand-border)] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-[var(--color-ink-muted)] text-[13px]">
                    Aucune intervention
                  </td>
                </tr>
              ) : (
                filtered.map((iv) => {
                  const sel = iv.id === selectedId;
                  return (
                    <tr
                      key={iv.id}
                      onClick={() => openDrawer(iv.id)}
                      className={`cursor-pointer border-b border-[var(--color-sand-mid)] transition-colors ${
                        sel ? 'bg-[var(--color-navy-pale)]' : 'bg-[var(--color-cream)] hover:bg-[var(--color-sand-hover)]'
                      }`}
                    >
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {iv.color && (
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-black/10"
                              style={{ background: iv.color }}
                              title={`Couleur ${iv.color}`}
                            />
                          )}
                          <div className="font-sora text-xs font-semibold text-[var(--color-navy)] tracking-[0.01em]">{iv.ref ?? '—'}</div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); window.open(`/admin/interventions/${iv.id}`, '_blank'); }}
                            className="text-[10px] text-[var(--color-ink-muted)]/40 hover:text-[var(--color-navy)] transition-colors"
                            title="Ouvrir dans un nouvel onglet"
                            aria-label="Ouvrir dans un nouvel onglet"
                          >
                            ↗
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {iv.priorite === 'urgente' && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-1.5 py-0.5">
                              <Zap size={12} />URGENT
                            </span>
                          )}
                          {iv.source === 'mail' && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)]"
                              title="Demande créée automatiquement depuis un mail entrant"
                            >
                              <Mail size={12} />Mail
                            </span>
                          )}
                          {(iv.recidive_count ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openDrawer(iv.id, 'historique'); }}
                              className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-1.5 py-0.5 hover:opacity-80 cursor-pointer transition-opacity"
                              title={`${iv.recidive_count} intervention(s) similaire(s) sur cette ACP dans les 12 mois — voir Historique`}
                            >
                              <RefreshCw size={12} />Récidive ({iv.recidive_count})
                            </button>
                          )}
                          {(iv.unread_messages_count ?? 0) > 0 && (
                            <span
                              className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-cream)] bg-[var(--color-terra)] rounded-full px-1.5 py-0.5"
                              title={`${iv.unread_messages_count} message(s) non lu(s) du partenaire`}
                            >
                              <MessageCircle size={12} />{iv.unread_messages_count}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5">
                        {iv.acp ? (
                          <>
                            <div className="font-medium text-[13px] text-[var(--color-ink)]">{iv.acp.nom}</div>
                            <div className="text-[10px] text-[var(--color-ink-muted)] truncate max-w-[200px]">
                              {[iv.acp.adresse, iv.acp.ville].filter(Boolean).join(', ') || '—'}
                            </div>
                          </>
                        ) : iv.source === 'mail' ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-amber-foxo)] bg-[var(--color-amber-light)] border border-[var(--color-amber-foxo)]/30 rounded px-1.5 py-0.5"
                                title="ACP non identifiée — associer manuellement dans le drawer">
                            <AlertTriangle size={12} />à associer
                          </span>
                        ) : (
                          <span className="text-[var(--color-ink-muted)] text-[12px]">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-[var(--color-ink-mid)] whitespace-nowrap">
                        {iv.type ?? '—'}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="text-xs font-medium text-[var(--color-ink)]">{iv.syndic?.nom ?? '—'}</div>
                        {iv.syndic?.type && <TypeBadge type={iv.syndic.type} className="mt-1" />}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs text-[var(--color-ink)]">
                        {iv.technicien ? (
                          <span>{(iv.technicien.prenom ?? '')[0]}. {iv.technicien.nom}</span>
                        ) : (
                          <span className="text-[var(--color-terra)] font-semibold text-[11px]">Non assigné</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-[var(--color-ink-mid)] font-mono whitespace-nowrap">
                        {fmtDate(iv.creneau_debut)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <Badge statut={iv.statut} />
                        <Pipebar statut={iv.statut} />
                      </td>
                      <td className="px-3.5 py-2.5 text-[10px] text-[var(--color-ink-muted)] font-mono whitespace-nowrap">
                        {relTime(iv.updated_at, nowMs)}
                      </td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        {iv.statut === 'nouvelle' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPlanningRow({
                                id: iv.id,
                                ref: iv.ref,
                                adresse: iv.adresse ?? (iv.acp ? [iv.acp.adresse, iv.acp.ville].filter(Boolean).join(', ') || null : null),
                                urgence: iv.priorite === 'urgente',
                              });
                            }}
                            className="text-[var(--color-ink-muted)]/40 hover:text-[var(--color-navy)] transition-colors w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[var(--color-navy-pale)] align-middle"
                            title="Planifier (proposer un créneau + assigner)"
                            aria-label="Planifier l'intervention"
                          >
                            <CalendarClock size={15} />
                          </button>
                        )}
                        {(iv.statut === 'nouvelle' || iv.statut === 'attente' || iv.statut === 'confirmee' || iv.statut === 'en_suspens') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRelanceMsg(null);
                              setRelanceConfirm({ id: iv.id, ref: iv.ref });
                            }}
                            disabled={relancingId === iv.id}
                            className="text-[var(--color-ink-muted)]/40 hover:text-[var(--color-navy)] transition-colors w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[var(--color-navy-pale)] disabled:opacity-50 align-middle"
                            title={relanceMsg?.id === iv.id ? relanceMsg.text : 'Relancer les occupants'}
                            aria-label="Relancer les occupants"
                          >
                            {relancingId === iv.id
                              ? <RefreshCw size={15} className="animate-spin" />
                              : relanceMsg?.id === iv.id
                                ? (relanceMsg.kind === 'ok'
                                    ? <Check size={15} className="text-[var(--color-ok)]" />
                                    : <XCircle size={15} className="text-[var(--color-terra)]" />)
                                : <Send size={15} />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRowDeleteErr(null);
                            setDeletingRow({ id: iv.id, ref: iv.ref });
                          }}
                          className="text-[var(--color-ink-muted)]/40 hover:text-[var(--color-terra)] transition-colors w-7 h-7 inline-flex items-center justify-center rounded hover:bg-[var(--color-terra-light)] align-middle"
                          title="Supprimer cette intervention"
                          aria-label="Supprimer cette intervention"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Cards mobile (< 768px) — version condensée de chaque ligne */}
        <div className="md:hidden space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-ink-muted)] text-[13px] fxs-card">
              Aucune intervention
            </div>
          ) : (
            filtered.map((iv) => {
              const sel = iv.id === selectedId;
              const adresse = iv.acp ? [iv.acp.adresse, iv.acp.ville].filter(Boolean).join(', ') : '';
              return (
                <button
                  key={iv.id}
                  type="button"
                  onClick={() => openDrawer(iv.id)}
                  className={
                    'w-full text-left fxs-card fxs-card-hover p-3 ' +
                    (sel ? 'ring-2 ring-[var(--color-navy)]/20' : '')
                  }
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {iv.color && (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-black/10"
                          style={{ background: iv.color }}
                        />
                      )}
                      <span className="font-sora text-[11px] font-semibold text-[var(--color-navy)] truncate tracking-[0.01em]">
                        {iv.ref ?? '—'}
                      </span>
                    </div>
                    <Badge statut={iv.statut} />
                  </div>

                  {(iv.priorite === 'urgente'
                    || iv.source === 'mail'
                    || (iv.recidive_count ?? 0) > 0
                    || (iv.unread_messages_count ?? 0) > 0) && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {iv.priorite === 'urgente' && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-1.5 py-0.5">
                          <Zap size={12} />URGENT
                        </span>
                      )}
                      {iv.source === 'mail' && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[var(--color-amber-light)] text-[var(--color-amber-foxo)]">
                          <Mail size={12} />Mail
                        </span>
                      )}
                      {(iv.recidive_count ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-1.5 py-0.5">
                          <RefreshCw size={12} />Récidive ({iv.recidive_count})
                        </span>
                      )}
                      {(iv.unread_messages_count ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-cream)] bg-[var(--color-terra)] rounded-full px-1.5 py-0.5">
                          <MessageCircle size={12} />{iv.unread_messages_count}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="text-[13px] font-medium text-[var(--color-ink)] truncate inline-flex items-center gap-1">
                    {iv.acp?.nom ?? (iv.source === 'mail' ? (<><AlertTriangle size={12} />ACP à associer</>) : '—')}
                  </div>
                  {adresse && (
                    <div className="text-[10px] text-[var(--color-ink-muted)] truncate">{adresse}</div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-[var(--color-sand-mid)]">
                    <div className="min-w-0">
                      <div className="text-[9px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em]">Type</div>
                      <div className="text-[11px] text-[var(--color-ink)] truncate">{iv.type ?? '—'}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em]">Tech</div>
                      <div className="text-[11px] truncate text-[var(--color-ink)]">
                        {iv.technicien
                          ? `${(iv.technicien.prenom ?? '')[0]}. ${iv.technicien.nom ?? ''}`
                          : <span className="text-[var(--color-terra)] font-semibold">Non assigné</span>}
                      </div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <div className="text-[9px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em]">Créneau</div>
                      <div className="text-[11px] font-mono text-[var(--color-ink)]">{fmtDate(iv.creneau_debut)}</div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <p className="text-[11px] text-[var(--color-ink-muted)] mt-2 px-0.5">
          {filtered.length} intervention{filtered.length > 1 ? 's' : ''}
          {filtered.length !== rows.length ? ` sur ${rows.length}` : ''} · Cliquez une ligne pour ouvrir le détail
        </p>

        {/* 6. Vue par technicien — tout en bas */}
        <div className="mt-5">
          <DashboardTechs
            rows={rows}
            techs={techs}
            dashboard={dashboard}
            onOpenIntervention={openDrawer}
            nowMs={nowMs}
          />
        </div>
      </div>
      </>
      )}

      {/* Drawer (côté liste) ou contenu pleine page */}
      {selected && (
        <div
          onClick={(e) => { if (!fullPage && e.target === e.currentTarget) closeDrawer(); }}
          className={
            fullPage
              ? 'flex flex-col h-full bg-[var(--color-cream)]'
              : 'fixed inset-0 bg-[var(--color-navy-deep)]/45 z-50 flex justify-end'
          }
        >
          <div className={
            fullPage
              ? 'w-full max-w-[1100px] mx-auto bg-[var(--color-cream)] flex-1 overflow-y-auto flex flex-col'
              : 'w-[460px] bg-[var(--color-cream)] h-screen overflow-y-auto shadow-2xl border-l border-[var(--color-sand-border)] flex flex-col'
          }>
            <header className="px-5 pt-5 bg-[var(--color-sand)] border-b border-[var(--color-sand-border)]">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex gap-2 items-center flex-wrap mb-0.5">
                    <span className="font-sora text-xs font-semibold text-[var(--color-navy)] tracking-[0.01em]">{selected.ref ?? '—'}</span>
                    {selected.priorite === 'urgente' && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-full px-2 py-0.5">
                        <Zap size={12} />URGENT
                      </span>
                    )}
                  </div>
                  <div className="font-sora text-base font-light tracking-tight text-[var(--color-ink)] mt-0.5">{selected.acp?.nom ?? '—'}</div>
                  <div className="text-xs text-[var(--color-ink-mid)]">
                    {[selected.acp?.adresse, selected.acp?.ville].filter(Boolean).join(', ')}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {!fullPage && (
                    <button
                      type="button"
                      onClick={() => window.open(`/admin/interventions/${selected.id}`, '_blank')}
                      className="bg-[var(--color-sand-mid)] h-8 px-2 rounded-md text-[var(--color-ink-mid)] hover:bg-[var(--color-sand-border)] text-[12px] font-medium transition-colors"
                      title="Ouvrir dans un nouvel onglet"
                      aria-label="Ouvrir dans un nouvel onglet"
                    >
                      ↗
                    </button>
                  )}
                  <button
                    onClick={closeDrawer}
                    className="bg-[var(--color-sand-mid)] h-8 px-2.5 rounded-md text-[var(--color-ink-mid)] hover:bg-[var(--color-sand-border)] text-[12px] font-medium inline-flex items-center justify-center transition-colors"
                    title={fullPage ? 'Retour à la liste' : 'Fermer'}
                  >
                    {fullPage ? '← Retour' : <X size={14} />}
                  </button>
                </div>
              </div>
              <div className="mt-3"><Pipebar statut={selected.statut} /></div>
              <div className="flex justify-between items-center mt-2 pb-4">
                <Badge statut={selected.statut} big />
                <span className="text-[11px] text-[var(--color-ink-muted)] font-mono">{relTime(selected.updated_at, nowMs)}</span>
              </div>
            </header>

            <nav className="flex bg-[var(--color-cream)] px-5 border-b border-[var(--color-sand-border)] overflow-x-auto">
              {(['dossier','suivi','documents','ia','historique'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-2.5 px-4 text-xs font-medium capitalize border-b-2 transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                    tab === t ? 'text-[var(--color-navy)] border-[var(--color-navy)]' : 'text-[var(--color-ink-muted)] border-transparent hover:text-[var(--color-ink-mid)]'
                  }`}
                >
                  {t === 'ia' ? (<><Sparkles size={14} />Assistant IA</>) : t === 'historique' ? (<><ClipboardList size={14} />Historique</>) : t}
                </button>
              ))}
            </nav>

            <div className="px-5 py-4 flex-1 overflow-y-auto bg-[var(--color-sand)]">
              {tab === 'dossier' && (
                <>
                  {/* Stepper + bandeau — seulement pour interventions source='mail' */}
                  {selected.source === 'mail' && (
                    <>
                      <MailStepper steps={[
                        { key: 'infos',    label: 'Infos',         sectionId: 'section-infos',        done: Boolean(formDraft.nom_client && formDraft.email && formDraft.telephone), active: selected.statut === 'nouvelle' },
                        { key: 'tech',     label: 'Technicien',    sectionId: 'section-technicien',   done: Boolean(selected.technicien_id), active: Boolean(formDraft.nom_client) && !selected.technicien_id },
                        { key: 'creneau',  label: 'Créneau',       sectionId: 'section-creneau',      done: Boolean(selected.creneau_debut), active: Boolean(selected.technicien_id) && !selected.creneau_debut },
                        { key: 'occup',    label: 'Occupants',     sectionId: 'section-occupants',    done: drawerOccupants.some((o) => o.token_sent_at), active: Boolean(selected.creneau_debut) },
                        { key: 'confirm',  label: 'Confirmation',  sectionId: 'section-confirmation', done: selected.statut === 'confirmee' || selected.statut === 'realisee' || selected.statut === 'rapport' || selected.statut === 'cloturee', active: selected.statut === 'attente' },
                      ]} />
                      {/* Bandeau bleu : seulement statut='nouvelle' (intervention non encore traitée) */}
                      {selected.statut === 'nouvelle' && (
                        <div className="bg-navy-pale border border-navy-light rounded-xl px-3 py-2.5 mb-3 text-[12px] text-navy dark:bg-[#1A2540] dark:border-[#2C4878] dark:text-[#A8C4F2]">
                          <div className="font-bold mb-1 inline-flex items-center gap-1.5"><Mail size={14} />Demande reçue par mail — à traiter</div>
                          <DemandeurBadge
                            organisationId={selected.organisation_id}
                            clientId={selected.client_id}
                            referenceExterne={selected.reference_externe}
                          />
                          {reanalyzeMsg && (
                            <div className={
                              'mt-2 text-[11px] font-semibold ' +
                              (reanalyzeMsg.kind === 'ok' ? 'text-ok dark:text-[#7AC9A0]' : 'text-terra')
                            }>
                              {reanalyzeMsg.msg}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 📋 Action requise — extraite par l'IA. Lit en priorité
                          la colonne action_requise (migration 2026-05-20),
                          fallback sur le marker dans notes_tech (compat ancien). */}
                      {(() => {
                        const fromCol = selected.action_requise;
                        const notes = selected.notes_tech ?? '';
                        const m = notes.match(/^\[IA action requise\]\s*([\s\S]+)$/);
                        const text = fromCol ?? (m ? m[1].trim() : null);
                        if (!text) return null;
                        return (
                          <div className="bg-amber-light border border-[var(--color-amber-foxo)]/30 rounded-xl px-3 py-2.5 mb-3 text-[12px] dark:bg-[#3A2A14] dark:border-[#7A5F2A] dark:text-[#F0D896]">
                            <div className="font-bold mb-1 text-[var(--color-amber-foxo)] inline-flex items-center gap-1.5 dark:text-[#F0D896]">
                              <ClipboardList size={14} />Action requise
                            </div>
                            <div className="text-[var(--color-amber-foxo)] dark:text-[#F0D896]">{text}</div>
                          </div>
                        );
                      })()}

                      {/* Bouton Réanalyser — visible pour toute intervention
                          source='mail' avec un source_mail_id, peu importe
                          le statut (nouvelle / attente / confirmee / etc.).
                          Si statut=nouvelle, le bouton se trouve hors du
                          bandeau bleu pour être atteignable même quand le
                          statut a évolué. */}
                      {selected.source_mail_id && (
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          <button
                            type="button"
                            onClick={reanalyzeMail}
                            disabled={reanalyzePending}
                            className="text-[12px] bg-navy text-white px-3 py-1.5 rounded font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                          >
                            <RefreshCw size={14} />
                            {reanalyzePending ? 'Analyse…' : 'Réanalyser le mail'}
                          </button>
                          {selected.statut !== 'nouvelle' && reanalyzeMsg && (
                            <span className={
                              'text-[11px] font-semibold ' +
                              (reanalyzeMsg.kind === 'ok' ? 'text-ok dark:text-[#7AC9A0]' : 'text-terra')
                            }>
                              {reanalyzeMsg.msg}
                            </span>
                          )}
                          <span className="text-[10px] text-ink-muted font-mono dark:text-[#C8C2B8]">
                            mail id : {selected.source_mail_id.slice(0, 16)}…
                          </span>
                        </div>
                      )}

                      {/* Panel de résultat de réanalyse — attend validation admin */}
                      {reanalysis && (
                        <ReanalysisPanel
                          data={reanalysis.analysis}
                          onApply={applyReanalysis}
                          onIgnore={() => { setReanalysis(null); setReanalyzeMsg(null); }}
                          pending={reanalyzePending}
                        />
                      )}
                    </>
                  )}

                  {/* Référence — éditable */}
                  <Block title="Référence">
                    <RefEditor
                      interventionId={selected.id}
                      currentRef={selected.ref}
                      onSaved={(newRef) => {
                        setRows((rs) => rs.map((r) =>
                          r.id === selected.id ? { ...r, ref: newRef } : r,
                        ));
                      }}
                    />
                  </Block>

                  {/* ① Édition rapide des infos */}
                  <Block id="section-infos" title={`Infos${selected.demandeur_type === 'particulier' ? ' particulier' : ''}`}>
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">Nom client</label>
                        <input
                          value={formDraft.nom_client}
                          onChange={(e) => setFormDraft((f) => ({ ...f, nom_client: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid"
                        />
                      </div>
                      <div>
                        <AddressAutocomplete
                          label="Adresse"
                          value={addressFromString(formDraft.adresse)}
                          onChange={(addr) => {
                            const composed = addr.code_postal || addr.ville
                              ? `${addr.adresse}, ${addr.code_postal} ${addr.ville}`.trim()
                              : addr.adresse;
                            setFormDraft((f) => ({ ...f, adresse: composed }));
                          }}
                          placeholder="rue + n°, code postal + ville"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">Téléphone</label>
                          <input
                            value={formDraft.telephone}
                            onChange={(e) => setFormDraft((f) => ({ ...f, telephone: e.target.value }))}
                            placeholder="+32 ..."
                            className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">Email</label>
                          <input
                            type="email"
                            value={formDraft.email}
                            onChange={(e) => setFormDraft((f) => ({ ...f, email: e.target.value }))}
                            className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">Type</label>
                          <select
                            value={formDraft.type}
                            onChange={(e) => setFormDraft((f) => ({ ...f, type: e.target.value }))}
                            className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid"
                          >
                            <option value="">— Choisir —</option>
                            <option value="Fuite canalisation">Fuite canalisation</option>
                            <option value="Fuite chauffage">Fuite chauffage</option>
                            <option value="Fuite infiltration">Fuite infiltration</option>
                            <option value="Surconsommation eau">Surconsommation eau</option>
                            <option value="Autre">Autre</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">Priorité</label>
                          <select
                            value={formDraft.priorite}
                            onChange={(e) => setFormDraft((f) => ({ ...f, priorite: e.target.value as 'normale' | 'urgente' }))}
                            className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid"
                          >
                            <option value="normale">Normale</option>
                            <option value="urgente">Urgente</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">Notes / description</label>
                        <textarea
                          value={formDraft.description}
                          onChange={(e) => setFormDraft((f) => ({ ...f, description: e.target.value }))}
                          rows={3}
                          className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={saveForm}
                          disabled={formPending}
                          className="bg-navy text-white px-3 py-1.5 rounded text-[12px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                        >
                          {formPending ? '…' : (<><Save size={14} />Sauvegarder</>)}
                        </button>
                        {formMsg && (
                          <span className={'text-[11px] font-semibold ' + (formMsg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                            {formMsg.msg}
                          </span>
                        )}
                      </div>
                    </div>
                  </Block>

                  {/* 👤 Demandeur — syndic/courtier + délégué (humain qui a envoyé le mail) */}
                  {(selected.syndic || selected.delegue) && (
                    <Block title={<span className="inline-flex items-center gap-1.5"><User size={12}/>Demandeur</span>}>
                      {selected.syndic && (
                        <div className="mb-2">
                          <Link
                            href={selected.syndic.type === 'syndic' ? `/admin/syndics?id=${selected.syndic.id}` : `/admin/clients?id=${selected.syndic.id}`}
                            className="font-bold text-[13px] text-navy hover:underline dark:text-[#A8C4F2]"
                          >
                            {selected.syndic.nom}
                          </Link>
                          {selected.syndic.type && <TypeBadge type={selected.syndic.type} className="ml-2" />}
                        </div>
                      )}
                      {selected.delegue && (
                        <div className="bg-white border border-sand-border rounded-md px-2.5 py-1.5 text-[12px] dark:bg-[#221E1A] dark:border-[#3D3A32]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-ink dark:text-[#F0ECE4]">
                              {[selected.delegue.prenom, selected.delegue.nom].filter(Boolean).join(' ') || selected.delegue.email}
                            </span>
                            {selected.source === 'mail' && (
                              <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded text-white bg-[var(--color-amber-foxo)]"
                                    title="Délégué identifié automatiquement depuis le mail">
                                <Mail size={10} />mail
                              </span>
                            )}
                          </div>
                          {(selected.delegue.email || selected.delegue.telephone) && (
                            <div className="text-[11px] font-mono text-ink-muted mt-0.5 dark:text-[#C8C2B8] flex flex-wrap gap-2">
                              {selected.delegue.email && (
                                <a href={`mailto:${selected.delegue.email}`} className="hover:text-navy inline-flex items-center gap-1 dark:hover:text-[#A8C4F2]">
                                  <Mail size={12} />{selected.delegue.email}
                                </a>
                              )}
                              {selected.delegue.telephone && (
                                <a href={`tel:${selected.delegue.telephone}`} className="hover:text-navy dark:hover:text-[#A8C4F2]">
                                  {selected.delegue.telephone}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </Block>
                  )}

                  {/* 🏢 ACP / Immeuble — éditable */}
                  <Block title={<span className="inline-flex items-center gap-1.5"><Building2 size={12}/>ACP / Immeuble</span>}>
                    {/* Suggestion automatique du pipeline mail (cf. migration
                        2026-05-26_acp_suggestion). Ne s'affiche que tant qu'aucune
                        ACP n'est associée ET qu'une suggestion est en attente. */}
                    {!selected.acp && selected.acp_suggestion && (
                      <AcpSuggestionBanner
                        suggestion={selected.acp_suggestion}
                        onConfirm={async () => {
                          const sug = selected.acp_suggestion;
                          if (!sug) return;
                          // Optimistic : pose acp_id, clear suggestion. L'objet
                          // selected.acp complet sera rafraîchi par router.refresh().
                          setRows((rs) => rs.map((r) =>
                            r.id === selected.id
                              ? { ...r, acp_id: sug.acp_id_suggere, acp_suggestion: null }
                              : r,
                          ));
                          const res = await confirmAcpSuggestion(selected.id);
                          if (res.error) {
                            setRows((rs) => rs.map((r) =>
                              r.id === selected.id
                                ? { ...r, acp_id: null, acp_suggestion: sug }
                                : r,
                            ));
                            return;
                          }
                          router.refresh();
                        }}
                        onIgnore={async () => {
                          const sug = selected.acp_suggestion;
                          if (!sug) return;
                          setRows((rs) => rs.map((r) =>
                            r.id === selected.id ? { ...r, acp_suggestion: null } : r,
                          ));
                          const res = await ignoreAcpSuggestion(selected.id);
                          if (res.error) {
                            setRows((rs) => rs.map((r) =>
                              r.id === selected.id ? { ...r, acp_suggestion: sug } : r,
                            ));
                          }
                        }}
                      />
                    )}
                    <AcpPicker
                      interventionId={selected.id}
                      organisationId={selected.organisation_id ?? selected.syndic?.id ?? null}
                      currentAcp={selected.acp}
                      onSaved={(acp) => {
                        setRows((rs) => rs.map((r) =>
                          r.id === selected.id ? { ...r, acp_id: acp?.id ?? null, acp: acp ?? null } : r,
                        ));
                      }}
                    />
                  </Block>

                  {/* 🛡️ Assurance — colonne assureur (migration 2026-05-20)
                      avec fallback particulier_contact.assureur (legacy) */}
                  {(() => {
                    type Assureur = {
                      nom?: string | null;
                      nom_contact?: string | null;
                      email: string | null;
                      telephone: string | null;
                      reference_sinistre?: string | null;
                      reference_police: string | null;
                    };
                    const fromCol = selected.assureur as Assureur | null;
                    const fromPc = (selected.particulier_contact as unknown as { assureur?: Assureur } | null)?.assureur ?? null;
                    const ass = fromCol ?? fromPc;
                    if (!ass) return null;
                    const nom = ass.nom ?? ass.nom_contact ?? null;
                    if (!nom && !ass.email && !ass.telephone && !ass.reference_police && !ass.reference_sinistre) return null;
                    return (
                      <Block title={<span className="inline-flex items-center gap-1.5"><Shield size={12}/>Assurance</span>}>
                        <div className="bg-white border border-sand-border rounded-md px-2.5 py-2 text-[12px] dark:bg-[#221E1A] dark:border-[#3D3A32]">
                          {nom && (
                            <div className="font-bold text-ink dark:text-[#F0ECE4]">{nom}</div>
                          )}
                          {(ass.email || ass.telephone) && (
                            <div className="text-[11px] font-mono text-ink-muted mt-0.5 dark:text-[#C8C2B8] flex flex-wrap gap-2">
                              {ass.email && (
                                <a href={`mailto:${ass.email}`} className="hover:text-navy inline-flex items-center gap-1 dark:hover:text-[#A8C4F2]">
                                  <Mail size={12} />{ass.email}
                                </a>
                              )}
                              {ass.telephone && (
                                <a href={`tel:${ass.telephone}`} className="hover:text-navy dark:hover:text-[#A8C4F2]">
                                  {ass.telephone}
                                </a>
                              )}
                            </div>
                          )}
                          {ass.reference_sinistre && (
                            <div className="text-[10px] font-mono text-ink-mid mt-1 dark:text-[#C8C2B8]">
                              <span className="text-[9px] uppercase font-bold tracking-wider text-ink-muted">Sinistre : </span>
                              {ass.reference_sinistre}
                            </div>
                          )}
                          {ass.reference_police && (
                            <div className="text-[10px] font-mono text-ink-mid mt-0.5 dark:text-[#C8C2B8]">
                              <span className="text-[9px] uppercase font-bold tracking-wider text-ink-muted">Réf. police : </span>
                              {ass.reference_police}
                            </div>
                          )}
                        </div>
                      </Block>
                    );
                  })()}

                  {/* 🤝 Courtier mandaté — association admin via dossiers_sinistres */}
                  <CourtierMandatePanel
                    interventionId={selected.id}
                    courtiers={drawerCourtiers}
                    onChanged={refreshCourtiers}
                  />

                  {/* 🔗 Dossiers liés + 📧 Mails liés — fetch via /liens */}
                  <LiensPanel interventionId={selected.id} />

                  {/* ② Technicien — dropdown éditable */}
                  <Block id="section-technicien" title="Technicien">
                    <div className="flex items-center gap-2">
                      <select
                        value={pendingTechId}
                        onChange={(e) => setPendingTechId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid"
                      >
                        <option value="">— Non assigné —</option>
                        {techs.map((t) => (
                          <option key={t.id} value={t.id}>
                            {[t.prenom, t.nom].filter(Boolean).join(' ') || t.email || t.id}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={applyAssignTech}
                        disabled={assignPending || (pendingTechId || '') === (selected.technicien?.id ?? '')}
                        className="bg-navy text-white px-3 py-1.5 rounded text-[12px] font-bold disabled:opacity-50"
                      >
                        Assigner
                      </button>
                    </div>
                    {assignMessage && (
                      <p className={'text-[11px] mt-1.5 font-semibold ' + (assignMessage.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                        {assignMessage.msg}
                      </p>
                    )}
                  </Block>

                  {/* ③ Créneau — picker */}
                  <Block id="section-creneau" title="Créneau">
                    {selected.creneau_debut && (
                      <p className="text-[12px] text-ink-mid mb-2 dark:text-[#C8C2B8]">
                        Actuel : <strong className="text-ink dark:text-[#F0ECE4]">{fmtDate(selected.creneau_debut, true)}</strong>
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => { setScheduleDate(e.target.value); setScheduleCreneauId(null); }}
                        className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid"
                      />
                      <input
                        type="time"
                        value={scheduleHeure}
                        onChange={(e) => { setScheduleHeure(e.target.value); setScheduleCreneauId(null); }}
                        className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid"
                      />
                    </div>
                    {pendingTechId && availableCreneaux.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 dark:text-[#C8C2B8]">
                          Ou choisir un créneau libre du tech
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto">
                          {availableCreneaux.slice(0, 12).map((cr) => {
                            const active = scheduleCreneauId === cr.id;
                            return (
                              <button
                                key={cr.id}
                                type="button"
                                onClick={() => {
                                  setScheduleCreneauId(cr.id);
                                  setScheduleDate(cr.date);
                                  setScheduleHeure(cr.heure_debut.slice(0, 5));
                                }}
                                className={
                                  'text-[10px] font-semibold px-2 py-1 rounded border ' +
                                  (active
                                    ? 'bg-navy text-white border-navy'
                                    : 'bg-ok-light text-ok border-ok-mid hover:opacity-80')
                                }
                              >
                                {new Date(cr.date + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })} · {cr.heure_debut.slice(0, 5)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={applySchedule}
                      disabled={schedulePending || !scheduleDate || !scheduleHeure}
                      className="bg-navy text-white px-3 py-1.5 rounded text-[12px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {schedulePending ? '…' : (<><Calendar size={14} />Planifier</>)}
                    </button>
                    {scheduleMsg && (
                      <p className={'text-[11px] mt-1.5 font-semibold ' + (scheduleMsg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                        {scheduleMsg.msg}
                      </p>
                    )}
                  </Block>

                  <Block title="Couleur">
                    <ColorPicker
                      value={selected.color}
                      onChange={async (color) => {
                        // Update optimiste
                        setRows((rs) => rs.map((r) =>
                          r.id === selected.id ? { ...r, color } : r,
                        ));
                        try {
                          const r = await fetch(`/api/admin/interventions/${selected.id}/color`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ color }),
                          });
                          const data = await r.json();
                          if (!data.ok) {
                            // Revert
                            setRows((rs) => rs.map((rw) =>
                              rw.id === selected.id ? { ...rw, color: selected.color } : rw,
                            ));
                          }
                        } catch {
                          setRows((rs) => rs.map((rw) =>
                            rw.id === selected.id ? { ...rw, color: selected.color } : rw,
                          ));
                        }
                      }}
                    />
                  </Block>

                  <Block id="section-occupants" title={`Appartements / unités (${drawerOccupants.length})`}>
                    {drawerOccupantsLoading ? (
                      <span className="text-ink-muted dark:text-[#C8C2B8]">Chargement…</span>
                    ) : (
                      <div className="space-y-1.5">
                        {drawerOccupants.map((o) => {
                          if (editingOccupantId === o.id) {
                            return (
                              <OccupantEditCard
                                key={o.id}
                                form={occupantForm}
                                onChange={setOccupantForm}
                                onSave={saveOccupant}
                                onCancel={cancelOccupantForm}
                                onDelete={() => deleteOccupant(o.id)}
                                onErase={() => eraseOccupant(o.id)}
                                saving={occupantSaving}
                              />
                            );
                          }
                          const confLabel = o.conf === 'confirme' ? (<span className="inline-flex items-center gap-1"><CheckCircle2 size={12}/>Confirmé</span>)
                            : o.conf === 'decline' ? (<span className="inline-flex items-center gap-1"><XCircle size={12}/>Pas d&apos;accès</span>)
                            : (<span>En attente</span>);
                          const confColor = o.conf === 'confirme' ? 'text-ok dark:text-[#7AC9A0]'
                            : o.conf === 'decline' ? 'text-terra'
                            : 'text-[var(--color-amber-foxo)] dark:text-[#E8C896]';
                          // Marqueur "extrait du mail" posé par le cron
                          const fromMail = (o.instructions ?? '').includes('[extrait du mail]');
                          return (
                            <div key={o.id} className="bg-white border border-sand-border rounded-md px-2.5 py-2 text-[12px] dark:bg-[#221E1A] dark:border-[#3D3A32]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-ink dark:text-[#F0ECE4] flex items-center gap-1.5 flex-wrap">
                                  {o.appartement ?? '—'}
                                  {o.etage ? <span className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">· {o.etage}</span> : null}
                                  {o.proposed_creneau_debut && (
                                    <span
                                      className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[var(--color-navy-light)] text-[var(--color-navy)] border border-[var(--color-navy-light)] dark:bg-[#1B2554] dark:text-[#A8C4F2] dark:border-[#2A4078]"
                                      title="L'occupant a proposé un autre créneau"
                                    >
                                      <RefreshCw size={10} />Propose: {new Date(o.proposed_creneau_debut).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS })}
                                    </span>
                                  )}
                                  {o.type_occupant && (
                                    <span
                                      className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-sand-mid text-ink-mid dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
                                      title="Type d'occupant"
                                    >
                                      {TYPE_OCCUPANT_LABEL[o.type_occupant] ?? o.type_occupant}
                                    </span>
                                  )}
                                  {fromMail && (
                                    <span
                                      className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded text-white bg-[var(--color-amber-foxo)]"
                                      title="Occupant extrait automatiquement depuis les CC du mail"
                                    >
                                      <Mail size={10} />mail
                                    </span>
                                  )}
                                </span>
                                <span className={'text-[10px] font-bold whitespace-nowrap ' + confColor}>
                                  {confLabel}
                                </span>
                              </div>
                              {(o.prenom || o.nom) && (
                                <div className="text-[12px] text-ink-mid mt-0.5 dark:text-[#C8C2B8]">
                                  {[o.prenom, o.nom].filter(Boolean).join(' ')}
                                </div>
                              )}
                              {(o.email || o.telephone) && (
                                <div className="text-[10px] font-mono text-ink-muted mt-0.5 dark:text-[#C8C2B8]">
                                  {[o.email, o.telephone].filter(Boolean).join(' · ')}
                                </div>
                              )}
                              {o.instructions && !fromMail && (
                                <div className="text-[11px] text-ink-mid italic mt-1 dark:text-[#C8C2B8]">
                                  {o.instructions}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {o.proposed_creneau_debut && (
                                  <button
                                    type="button"
                                    onClick={() => acceptCounterProposal(o)}
                                    className="text-[10px] bg-ok text-white px-2 py-1 rounded font-bold hover:opacity-90 inline-flex items-center gap-1"
                                    title="Reprogrammer l'intervention sur le créneau proposé par l'occupant"
                                  >
                                    <CheckCircle2 size={12} />Accepter la proposition
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => startEditOccupant(o)}
                                  className="text-[10px] bg-sand-mid text-ink-mid px-2 py-1 rounded font-bold hover:opacity-90 inline-flex items-center gap-1 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
                                >
                                  <Pencil size={12} />Modifier
                                </button>
                                {o.telephone && (
                                  <button
                                    type="button"
                                    onClick={() => setSmsModal({
                                      name: [o.prenom, o.nom].filter(Boolean).join(' ') || 'Occupant',
                                      phone: o.telephone!,
                                      occupantId: o.id,
                                      templateKey: 'sms_template_lien_occupant',
                                      preferredChannel: o.contact_preference ?? null,
                                    })}
                                    className="text-[10px] bg-[var(--color-amber-foxo)] text-white px-2 py-1 rounded font-bold hover:opacity-90 inline-flex items-center gap-1"
                                  >
                                    <Smartphone size={12} />SMS lien
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {addingOccupant && (
                          <OccupantEditCard
                            form={occupantForm}
                            onChange={setOccupantForm}
                            onSave={saveOccupant}
                            onCancel={cancelOccupantForm}
                            saving={occupantSaving}
                          />
                        )}

                        {!addingOccupant && !editingOccupantId && (
                          <button
                            type="button"
                            onClick={startAddOccupant}
                            className="w-full text-[12px] bg-sand-mid text-navy border border-sand-border border-dashed rounded-md px-2.5 py-2 font-bold hover:bg-sand-hover inline-flex items-center justify-center gap-1.5 dark:bg-[rgba(255,255,255,.04)] dark:border-[#3D3A32] dark:text-[#A8C4F2]"
                          >
                            <Plus size={14} />Ajouter un occupant
                          </button>
                        )}
                      </div>
                    )}
                  </Block>

                  {/* ④ Notifier les occupants — multicanal */}
                  {selected.creneau_debut && drawerOccupants.length > 0 && (
                    <Block title={<span className="inline-flex items-center gap-1.5"><Inbox size={12}/>Notifier les occupants</span>}>
                      <p className="text-[11px] text-ink-mid mb-2 dark:text-[#C8C2B8]">
                        Envoie un lien de confirmation à chaque occupant via le canal préféré
                        (email / SMS / WhatsApp). Décoche pour exclure.
                      </p>
                      <div className="space-y-1 mb-2">
                        {drawerOccupants.map((o) => {
                          const checked = notifySelectedIds.has(o.id);
                          const pref = o.contact_preference ?? 'email';
                          const PrefIcon = pref === 'whatsapp' ? MessageCircle
                            : pref === 'sms' ? Smartphone
                            : Mail;
                          const sentAt = o.token_sent_at;
                          return (
                            <label key={o.id} className="flex items-center gap-2 bg-white border border-sand-border rounded-md px-2 py-1.5 text-[12px] cursor-pointer dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setNotifySelectedIds((s) => {
                                    const n = new Set(s);
                                    if (n.has(o.id)) n.delete(o.id); else n.add(o.id);
                                    return n;
                                  });
                                }}
                                className="w-4 h-4 accent-[var(--color-navy)]"
                              />
                              <PrefIcon size={14} className="flex-shrink-0" />
                              <span className="font-bold flex-1 truncate">
                                {[o.prenom, o.nom].filter(Boolean).join(' ') || 'Occupant'}
                                {o.appartement && <span className="text-ink-muted font-normal ml-1.5">· {o.appartement}</span>}
                              </span>
                              {sentAt && (
                                <span className="text-[9px] text-ok font-bold whitespace-nowrap inline-flex items-center gap-0.5" title={`Envoyé ${new Date(sentAt).toLocaleString('fr-BE', { timeZone: TZ_BRUSSELS })}`}>
                                  <Check size={10} />envoyé
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={notifyOccupants}
                        disabled={notifyPending || notifySelectedIds.size === 0}
                        className="bg-navy text-white px-3 py-2 rounded text-[12px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        {notifyPending ? '…' : (<><Send size={14} />Envoyer ({notifySelectedIds.size})</>)}
                      </button>
                      {notifyMsg && (
                        <p className={'text-[11px] mt-1.5 font-semibold ' + (notifyMsg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                          {notifyMsg.msg}
                        </p>
                      )}
                    </Block>
                  )}

                  {/* ⑤ Confirmation client */}
                  {selected.creneau_debut && (selected.particulier_contact?.email || selected.particulier_contact?.mandant?.email) && (
                    <Block id="section-confirmation" title={<span className="inline-flex items-center gap-1.5"><Send size={12}/>Confirmation client</span>}>
                      <p className="text-[11px] text-ink-mid mb-2 dark:text-[#C8C2B8]">
                        Envoie un récapitulatif (date, heure, adresse, technicien) au demandeur via Gmail.
                      </p>
                      <button
                        type="button"
                        onClick={sendConfirmMail}
                        disabled={confirmMailPending}
                        className="bg-[var(--color-ok)] text-[var(--color-cream)] px-3 py-2 rounded text-[12px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                      >
                        {confirmMailPending ? 'Envoi…' : (<><Send size={14} />Envoyer confirmation au client</>)}
                      </button>
                      {confirmMailMsg && (
                        <p className={'text-[11px] mt-1.5 font-semibold ' + (confirmMailMsg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                          {confirmMailMsg.msg}
                        </p>
                      )}
                    </Block>
                  )}

                  {selected.statut === 'en_suspens' && selected.suspens_motif && (
                    <div className="bg-terra-light border border-terra-mid rounded-lg p-3.5 mb-3">
                      <div className="text-[10px] font-bold text-terra uppercase tracking-wider mb-2">
                        Motif suspension
                      </div>
                      <div className="text-[13px] text-terra">{selected.suspens_motif}</div>
                    </div>
                  )}

                  {/* Suppression — visible uniquement pour statuts précoces */}
                  {(selected.statut === 'nouvelle' || selected.statut === 'attente' || selected.statut === 'en_suspens') && (
                    <div className="mt-6 pt-4 border-t border-sand-border dark:border-[#3D3A32]">
                      <button
                        type="button"
                        onClick={() => { setDeleteConfirmOpen(true); setDeleteMsg(null); }}
                        className="w-full bg-terra text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                        style={{ background: 'var(--color-terra)' }}
                      >
                        <Trash2 size={14} />Supprimer cette intervention
                      </button>
                      {deleteMsg && (
                        <p className={'text-[11px] mt-1.5 font-semibold ' + (deleteMsg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                          {deleteMsg.msg}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {tab === 'suivi' && (
                <>
                  <Block title="Technicien assigné">
                    {selected.technicien ? (
                      <div className="flex items-center gap-2 mb-3 bg-navy-pale border border-navy-light rounded-lg px-3 py-2">
                        <div className="w-8 h-8 rounded-full bg-navy text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                          {((selected.technicien.prenom ?? '')[0] ?? '').toUpperCase() +
                            ((selected.technicien.nom ?? '')[0] ?? '').toUpperCase()}
                        </div>
                        <div>
                          <div className="text-[13px] font-bold text-navy">
                            {selected.technicien.prenom} {selected.technicien.nom}
                          </div>
                          <div className="text-[10px] text-navy/70">Actuellement assigné</div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-terra-light border border-terra-mid rounded-lg px-3 py-2 text-[12px] text-terra font-semibold mb-3 inline-flex items-center gap-1.5">
                        <AlertTriangle size={14} />Aucun technicien assigné
                      </div>
                    )}

                    <select
                      value={pendingTechId}
                      onChange={(e) => setPendingTechId(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg border border-sand-border bg-sand text-xs"
                    >
                      <option value="">— Non assigné —</option>
                      {techs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {[t.prenom, t.nom].filter(Boolean).join(' ') || t.email || t.id}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={applyAssignTech}
                      disabled={
                        assignPending ||
                        (pendingTechId || '') === (selected.technicien?.id ?? '')
                      }
                      className="w-full mt-2.5 bg-navy text-white py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      {assignPending ? 'Assignation…' : 'Assigner'}
                    </button>

                    {assignMessage && (
                      <p className={
                        'text-xs mt-2 font-semibold ' +
                        (assignMessage.kind === 'ok' ? 'text-ok' : 'text-terra')
                      }>
                        {assignMessage.msg}
                      </p>
                    )}
                  </Block>

                  <Block title="Changer le statut">
                    <select
                      value={pendingStatut}
                      onChange={(e) => setPendingStatut(e.target.value as StatutIntervention)}
                      className="w-full px-3 py-2.5 rounded-lg border border-sand-border bg-sand text-xs"
                    >
                      {STATUT_PIPELINE.map((s) => (
                        <option key={s} value={s}>{STATUT_INFO[s].label}</option>
                      ))}
                      <option value="en_suspens">En suspens</option>
                    </select>
                    {pendingStatut === 'en_suspens' && (
                      <textarea
                        value={suspensMotif}
                        onChange={(e) => setSuspensMotif(e.target.value)}
                        placeholder="Motif de suspension…"
                        rows={3}
                        className="w-full mt-2 px-3 py-2 rounded-lg border border-sand-border bg-sand text-xs"
                      />
                    )}
                    <button
                      onClick={applyStatus}
                      disabled={pending || pendingStatut === selected.statut}
                      className="w-full mt-2.5 bg-navy text-white py-2.5 rounded-lg text-xs font-bold disabled:opacity-50"
                    >
                      {pending ? 'Mise à jour…' : 'Appliquer le statut'}
                    </button>
                    {statusMessage && (
                      <p className="text-xs mt-2 text-ok font-semibold">{statusMessage}</p>
                    )}
                  </Block>

                  {rapportInfo && (
                    <Block title="Rapport au syndic">
                        {/* Contenu du rapport : 4 sections (consultation + correction
                            en brouillon) puis galerie photos. Le bloc statut/boutons
                            existant suit en dessous. */}
                        <div className="mb-4 space-y-3">
                          {([
                            { key: 'degats', label: 'Dégâts' },
                            { key: 'inspection', label: 'Inspection' },
                            { key: 'conclusion', label: 'Conclusion' },
                            { key: 'recommandations', label: 'Recommandations' },
                          ] as const).map((s) => (
                            <div key={s.key}>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">{s.label}</div>
                              {rapportInfo.statut === 'brouillon' && rapportEdit ? (
                                <textarea
                                  value={rapportEdit[s.key]}
                                  onChange={(e) => setRapportEdit((cur) => cur ? { ...cur, [s.key]: e.target.value } : cur)}
                                  rows={3}
                                  className="w-full px-2.5 py-2 border border-sand-border rounded-lg text-[12px] bg-white outline-none focus:border-navy-mid leading-relaxed"
                                  placeholder={`Aucun contenu pour « ${s.label} »`}
                                />
                              ) : (
                                <p className="text-[12px] text-ink whitespace-pre-wrap leading-relaxed bg-cream border border-sand-border rounded-lg px-2.5 py-2">
                                  {(rapportInfo[s.key] ?? '').trim() || '—'}
                                </p>
                              )}
                            </div>
                          ))}

                          {/* Techniques d'inspection — 8 cases, éditables en brouillon */}
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">Techniques d&apos;inspection</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                              {RAPPORT_TECHNIQUES.map((tech) => {
                                const checked = rapportTech.has(tech.key);
                                const editable = rapportInfo.statut === 'brouillon';
                                return (
                                  <label
                                    key={tech.key}
                                    className={
                                      'flex items-center gap-1.5 text-[12px] ' +
                                      (editable ? 'cursor-pointer text-ink' : 'text-ink-mid')
                                    }
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={!editable}
                                      onChange={(e) => {
                                        setRapportTech((cur) => {
                                          const next = new Set(cur);
                                          if (e.target.checked) next.add(tech.key);
                                          else next.delete(tech.key);
                                          return next;
                                        });
                                      }}
                                      className="accent-navy"
                                    />
                                    {tech.label}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          {/* Galerie photos */}
                          {rapportPhotos.length > 0 && (
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
                                Photos ({rapportPhotos.length})
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                {rapportPhotos.map((p) => (
                                  <a
                                    key={p.id}
                                    href={p.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block group"
                                    title={p.caption ?? p.filename ?? 'Photo'}
                                  >
                                    <div className="aspect-square rounded-lg overflow-hidden border border-sand-border bg-sand">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={p.url} alt={p.caption ?? p.filename ?? 'Photo'} className="w-full h-full object-cover group-hover:opacity-90" />
                                    </div>
                                    {(p.caption || p.piece) && (
                                      <div className="text-[9px] text-ink-muted mt-0.5 truncate">
                                        {p.piece ? <span className="font-semibold">{p.piece}</span> : null}
                                        {p.piece && p.caption ? ' · ' : ''}
                                        {p.caption ?? ''}
                                      </div>
                                    )}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Brouillon : enregistrer les corrections */}
                          {rapportInfo.statut === 'brouillon' && (
                            <button
                              onClick={saveRapportCorrections}
                              disabled={rapportSavePending}
                              className="w-full bg-sand hover:bg-sand-mid text-ink border border-sand-border py-2 rounded-lg text-xs font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                            >
                              {rapportSavePending ? 'Enregistrement…' : (<><Save size={14} />Enregistrer les corrections</>)}
                            </button>
                          )}

                          {/* Validé : repasser en brouillon pour corriger */}
                          {rapportInfo.statut === 'valide' && (
                            <button
                              onClick={reopenRapport}
                              disabled={rapportReopenPending}
                              className="w-full bg-sand hover:bg-sand-mid text-ink-mid border border-sand-border py-2 rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                            >
                              {rapportReopenPending ? 'Réouverture…' : (<><RefreshCw size={14} />Repasser en brouillon</>)}
                            </button>
                          )}

                          {/* Aperçu PDF fidèle (identique à l'envoi) — brouillon + validé */}
                          {(rapportInfo.statut === 'brouillon' || rapportInfo.statut === 'valide') && (
                            <a
                              href={`/api/admin/rapports/${selected.id}/preview-pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full bg-white hover:bg-sand text-navy border border-navy-mid py-2 rounded-lg text-xs font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                            >
                              <FileText size={14} />Aperçu PDF
                            </a>
                          )}

                          {rapportSaveMsg && (
                            <p className={'text-xs font-semibold ' + (rapportSaveMsg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                              {rapportSaveMsg.msg}
                            </p>
                          )}
                        </div>

                        {/* État 1 — brouillon : validation requise avant envoi */}
                        {rapportInfo.statut === 'brouillon' && (
                          <>
                            <div className="mb-2.5">
                              <span
                                className="inline-block rounded-full text-[11px] font-semibold px-2.5 py-0.5"
                                style={{ color: 'var(--color-ink-mid)', background: 'var(--color-sand-mid)' }}
                              >
                                Brouillon
                              </span>
                            </div>
                            <button
                              onClick={handleValidate}
                              disabled={validatePending}
                              className="w-full bg-navy text-white py-2.5 rounded-lg text-xs font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                            >
                              {validatePending ? 'Validation…' : (<><Check size={14} />Valider le rapport</>)}
                            </button>
                            {validateMessage && (
                              <p className="text-xs mt-2 font-semibold text-ink-mid">{validateMessage}</p>
                            )}
                          </>
                        )}

                        {/* État 2 — validé : prêt à envoyer au syndic */}
                        {rapportInfo.statut === 'valide' && (
                          <>
                            <div className="mb-1.5">
                              <span
                                className="inline-block rounded-full text-[11px] font-semibold px-2.5 py-0.5"
                                style={{ color: 'var(--color-navy)', background: 'var(--color-navy-pale)' }}
                              >
                                Validé
                              </span>
                            </div>
                            <p className="text-[12px] text-ink-mid mb-2">
                              Validé le {fmtDate(rapportInfo.valide_at)}
                            </p>
                            <button
                              onClick={resendRapport}
                              disabled={emailPending}
                              className="w-full bg-[var(--color-amber-foxo)] hover:bg-[var(--color-amber-foxo)]/90 text-[var(--color-cream)] py-2.5 rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5 transition-colors"
                            >
                              {emailPending ? 'Envoi…' : (<><Mail size={14} />Envoyer au syndic</>)}
                            </button>
                            {emailMessage && (
                              <p className={
                                'text-xs mt-2 font-semibold ' +
                                (emailMessage.kind === 'ok' ? 'text-ok' : 'text-terra')
                              }>
                                {emailMessage.msg}
                              </p>
                            )}
                          </>
                        )}

                        {/* État 3 — transmis : traçabilité + renvoi secondaire */}
                        {rapportInfo.statut === 'transmis' && (
                          <>
                            <div className="mb-1.5">
                              <span
                                className="inline-block rounded-full text-[11px] font-semibold px-2.5 py-0.5"
                                style={{ color: 'var(--color-ok)', background: 'var(--color-ok-light)' }}
                              >
                                Transmis
                              </span>
                            </div>
                            <p className="text-[12px] text-ink-mid mb-2">
                              Transmis le {fmtDate(rapportInfo.transmis_at)}
                              {rapportInfo.transmis_a && rapportInfo.transmis_a.length > 0
                                ? ` à ${rapportInfo.transmis_a.join(', ')}`
                                : ''}
                            </p>
                            <button
                              onClick={resendRapport}
                              disabled={emailPending}
                              className="w-full bg-sand hover:bg-sand-mid text-ink-mid border border-sand-border py-2 rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5 transition-colors"
                            >
                              {emailPending ? 'Envoi…' : (<><RefreshCw size={14} />Renvoyer au syndic</>)}
                            </button>
                            <button
                              onClick={reopenTransmitted}
                              disabled={rapportReopenPending}
                              className="w-full mt-2 bg-white hover:bg-sand text-navy border border-navy-mid py-2 rounded-lg text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5 transition-colors"
                            >
                              {rapportReopenPending ? 'Réouverture…' : (<><Pencil size={14} />Rouvrir pour correction</>)}
                            </button>
                            {emailMessage && (
                              <p className={
                                'text-xs mt-2 font-semibold ' +
                                (emailMessage.kind === 'ok' ? 'text-ok' : 'text-terra')
                              }>
                                {emailMessage.msg}
                              </p>
                            )}
                          </>
                        )}
                    </Block>
                  )}

                  {/* Messagerie syndic ↔ admin (panel partagé, polling 30s).
                      Marque automatiquement les messages reçus comme lus
                      (lu_admin = true) au mount, ce qui décrémente le badge
                      💬 sur la ligne au prochain refresh de la liste. */}
                  <div className="mb-3">
                    <MessagesPanel
                      interventionId={selected.id}
                      currentUserEmail={adminEmail}
                      isAdmin
                    />
                  </div>

                  <Block title="Notifications SMS / WhatsApp">
                    <p className="text-[12px] text-ink-mid mb-2 dark:text-[#C8C2B8]">
                      Envoie un SMS de confirmation aux occupants enregistrés.
                    </p>
                    {drawerOccupants.filter((o) => o.telephone).length === 0 ? (
                      <p className="text-[11px] text-ink-muted dark:text-[#C8C2B8]">
                        Aucun occupant n&apos;a de téléphone enregistré.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {drawerOccupants.filter((o) => o.telephone).map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => setSmsModal({
                              name: [o.prenom, o.nom].filter(Boolean).join(' ') || (o.appartement ?? 'Occupant'),
                              phone: o.telephone!,
                              occupantId: o.id,
                              templateKey: 'sms_template_confirmation',
                              preferredChannel: o.contact_preference ?? null,
                            })}
                            className="w-full text-left bg-white hover:bg-navy-pale border border-sand-border rounded-md px-2.5 py-2 text-[12px] flex items-center justify-between gap-2 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <Smartphone size={14} />{[o.prenom, o.nom].filter(Boolean).join(' ') || o.appartement}
                              <span className="text-ink-muted dark:text-[#C8C2B8] ml-1.5 font-mono text-[10px]">{o.telephone}</span>
                            </span>
                            <span className="text-[10px] font-bold text-navy dark:text-[#A8C4F2]">
                              {o.contact_preference === 'whatsapp' ? 'WhatsApp' : 'SMS'} ›
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </Block>

                  <FactureBlock
                    interventionId={selected.id}
                    ref={selected.ref}
                    statut={selected.statut}
                  />
                </>
              )}

              {tab === 'documents' && (
                <>
                  <DocumentRecipients interventionId={selected.id} />
                  <DocumentsBlock interventionId={selected.id} />
                </>
              )}

              {tab === 'ia' && (
                <div className="bg-cream border border-sand-border rounded-2xl p-3 flex flex-col" style={{ minHeight: 480, height: 'calc(100vh - 320px)' }}>
                  {iaSaveMessage && (
                    <div className={
                      'text-[12px] rounded-md px-3 py-2 mb-2 border font-semibold ' +
                      (iaSaveMessage.kind === 'ok'
                        ? 'bg-ok-light border-ok-mid text-ok'
                        : 'bg-terra-light border-terra-mid text-terra')
                    }>
                      {iaSaveMessage.msg}
                    </div>
                  )}
                  {iaSavePending && (
                    <div className="text-[11px] text-ink-muted mb-2">Sauvegarde du brouillon…</div>
                  )}
                  <AssistantChat
                    mode="intervention"
                    interventionId={selected.id}
                    quickActions={DRAWER_AI_ACTIONS}
                    emptyTitle="Que veux-tu faire sur ce dossier ?"
                    emptyHint="Je connais l'historique du dossier (statut, ACP, syndic, occupants, rapport actuel). Clique une action ou pose ta question."
                    onSpecialResult={handleAiRapportSave}
                  />
                </div>
              )}

              {tab === 'historique' && (
                <HistoriquePanel interventionId={selected.id} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({
  num, label, accent, muted, warning,
}: {
  num: number; label: string; accent?: boolean; muted?: boolean; warning?: boolean;
}) {
  let bg = 'bg-cream';
  let border = 'border-sand-border';
  let numColor = 'text-ink';
  if (accent) { bg = 'bg-navy-pale'; border = 'border-navy-light'; numColor = 'text-navy'; }
  if (muted) numColor = 'text-ink-mid';
  if (warning) { bg = 'bg-terra-light'; border = 'border-terra-mid'; numColor = 'text-terra'; }
  return (
    <div className={`${bg} ${border} border rounded-xl px-4 py-3.5`}>
      <div className={`text-[28px] font-extrabold leading-none ${numColor}`}>{num}</div>
      <div className="text-[11px] text-ink-muted mt-1 font-medium">{label}</div>
    </div>
  );
}

// Affiche les destinataires email résolus pour chaque type de document
// (facture / rapport / communication) avec la source de la résolution.
// Charge dynamiquement /api/admin/interventions/[id]/recipients.
function DocumentRecipients({ interventionId }: { interventionId: string }) {
  type Recipient = {
    doc: 'facture' | 'rapport' | 'communication';
    email: string | null;
    source: 'acp' | 'syndic' | 'acp_legacy' | 'syndic_general' | 'particulier' | null;
  };
  const [data, setData] = useState<{
    recipients: Recipient[];
    acp_id: string | null;
    syndic_id: string | null;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/admin/interventions/${interventionId}/recipients`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (mounted && d.ok) setData(d); })
      .catch(() => { /* noop */ });
    return () => { mounted = false; };
  }, [interventionId]);

  if (!data) return null;

  const ICONS: Record<Recipient['doc'], { icon: LucideIcon; label: string }> = {
    facture: { icon: Banknote, label: 'Facture' },
    rapport: { icon: FileText, label: 'Rapport' },
    communication: { icon: Megaphone, label: 'Communication' },
  };
  const sourceLabel = (s: Recipient['source']) => {
    if (s === 'acp') return 'ACP';
    if (s === 'syndic') return 'Syndic';
    if (s === 'acp_legacy') return 'ACP (legacy)';
    if (s === 'syndic_general') return 'Syndic (général)';
    if (s === 'particulier') return 'Particulier';
    return null;
  };

  // Lien "Modifier" : préférer ACP s'il existe, sinon syndic
  const editHref = data.acp_id
    ? `/admin/clients/${data.acp_id}`
    : data.syndic_id
      ? '/admin/syndics'
      : null;

  return (
    <div className="bg-cream border border-sand-border rounded-xl p-3 mb-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted dark:text-[#C8C2B8]">
          Destinataires emails
        </div>
        {editHref && (
          <a
            href={editHref}
            className="text-[10px] text-navy hover:underline inline-flex items-center gap-1 dark:text-[#A8C4F2]"
          >
            <Pencil size={12} />Modifier
          </a>
        )}
      </div>
      <div className="space-y-1">
        {data.recipients.map((r) => {
          const RowIcon = ICONS[r.doc].icon;
          return (
          <div key={r.doc} className="flex items-center gap-2 text-[12px]">
            <span className="font-bold text-ink dark:text-[#F0ECE4] w-[140px] flex-shrink-0 inline-flex items-center gap-1.5">
              <RowIcon size={14} />{ICONS[r.doc].label}
            </span>
            <span className="text-ink-mid dark:text-[#C8C2B8]">→</span>
            {r.email ? (
              <>
                <a
                  href={`mailto:${r.email}`}
                  className="font-mono text-[11px] text-navy hover:underline truncate flex-1 dark:text-[#A8C4F2]"
                >
                  {r.email}
                </a>
                {sourceLabel(r.source) && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sand-mid text-ink-muted flex-shrink-0 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]">
                    {sourceLabel(r.source)}
                  </span>
                )}
              </>
            ) : (
              <span className="italic text-terra text-[11px]">Aucun email configuré</span>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

// Modal de confirmation pour le soft-delete depuis l'icône poubelle de
// la ligne. Plus léger que DeleteInterventionModal (hard-delete cascade) :
// l'opération est récupérable, donc on ne fait pas peur à l'admin avec
// 'irréversible'. L'erreur API (ex: 503 si migration pending) s'affiche
// inline sans fermer la modal.
function SoftDeleteRowModal({
  ref, pending, error, onCancel, onConfirm,
}: {
  ref: string | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onCancel(); }}
      className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
    >
      <div className="bg-cream border border-sand-border rounded-2xl p-5 w-full max-w-[420px] dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <h2 className="text-[14px] font-extrabold text-ink mb-2 inline-flex items-center gap-1.5 dark:text-[#F0ECE4]">
          <Trash2 size={16} />Supprimer cette intervention ?
        </h2>
        <p className="text-[13px] text-ink-mid leading-relaxed dark:text-[#C8C2B8]">
          L&apos;intervention <strong className="font-mono text-ink dark:text-[#F0ECE4]">{ref ?? '?'}</strong> sera retirée de la liste.
          Les données liées (timeline, photos, occupants) sont conservées et restaurables.
        </p>

        {error && (
          <div className="mt-3 bg-terra-light border border-terra-mid text-terra rounded-md px-3 py-2 text-[12px] font-semibold">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-[12px] font-bold border border-sand-border bg-white text-ink-mid disabled:opacity-50 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#C8C2B8]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-[12px] font-bold text-white disabled:opacity-50"
            style={{ background: 'var(--color-terra)' }}
          >
            {pending ? 'Suppression…' : 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteInterventionModal({
  ref, pending, onCancel, onConfirm,
}: {
  ref: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onCancel(); }}
      className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
    >
      <div className="bg-cream border border-terra rounded-2xl p-5 w-full max-w-[460px] dark:bg-[#1C1A16] dark:border-[#7A3F22]">
        <h2 className="text-[14px] font-extrabold text-terra mb-2 inline-flex items-center gap-1.5 dark:text-[#FFB897]">
          <Trash2 size={16} />Supprimer l&apos;intervention
        </h2>
        <p className="text-[13px] text-ink-mid leading-relaxed dark:text-[#C8C2B8]">
          Êtes-vous sûr de vouloir supprimer l&apos;intervention <strong className="font-mono text-ink dark:text-[#F0ECE4]">{ref ?? '?'}</strong> ?
          Cette action est <strong className="text-terra">irréversible</strong>.
        </p>
        <p className="text-[11px] text-ink-muted leading-relaxed mt-2 dark:text-[#C8C2B8]">
          Tous les éléments liés (timeline, SMS logs, photos, occupants) seront aussi supprimés.
          Le créneau réservé sera libéré automatiquement.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-[12px] font-bold border border-sand-border bg-white text-ink-mid disabled:opacity-50 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#C8C2B8]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-[12px] font-bold text-white disabled:opacity-50"
            style={{ background: 'var(--color-terra)' }}
          >
            {pending ? 'Suppression…' : 'Supprimer définitivement'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Panel "Résultat de l'analyse IA" — apparaît après /reanalyze, attend
// que l'admin clique "Appliquer" ou "Ignorer".
type ReanalysisAnalysis = {
  est_demande_intervention: boolean;
  nom_client: string | null;
  adresse: string | null;
  type_probleme: string | null;
  telephone: string | null;
  email: string | null;
  priorite: 'normale' | 'urgente' | null;
  resume: string | null;
  langue: 'fr' | 'nl' | 'en' | null;
  type_demandeur: 'syndic' | 'courtier' | 'particulier' | null;
  nom_societe: string | null;
  nom_immeuble: string | null;
  reference_externe: string | null;
  occupants: { prenom: string; nom: string; email: string; appartement: string; telephone: string }[];
};

function ReanalysisPanel({
  data, onApply, onIgnore, pending,
}: {
  data: ReanalysisAnalysis;
  onApply: () => void;
  onIgnore: () => void;
  pending: boolean;
}) {
  const TypeIcon = data.type_demandeur === 'syndic' ? Building2
    : data.type_demandeur === 'courtier' ? Shield
    : data.type_demandeur === 'particulier' ? User
    : HelpCircle;
  const typeLabel = data.type_demandeur === 'syndic' ? 'Syndic' : data.type_demandeur === 'courtier' ? 'Courtier' : data.type_demandeur === 'particulier' ? 'Particulier' : 'Inconnu';
  return (
    <div className="bg-cream border-2 border-navy-mid rounded-xl p-3 mb-3 dark:bg-[#1C1A16] dark:border-[#A8C4F2]">
      <div className="text-[12px] font-bold text-navy mb-2 inline-flex items-center gap-1.5 dark:text-[#A8C4F2]">
        <BarChart3 size={14} />Résultat de l&apos;analyse IA
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[12px] mb-3">
        <ReanalysisRow label="Type demandeur" value={<span className="inline-flex items-center gap-1.5"><TypeIcon size={12}/>{typeLabel}</span>} />
        {data.nom_societe && <ReanalysisRow label="Société" value={data.nom_societe} />}
        {data.nom_immeuble && <ReanalysisRow label="Immeuble" value={data.nom_immeuble} />}
        <ReanalysisRow label="Nom client" value={data.nom_client} />
        <ReanalysisRow label="Téléphone" value={data.telephone} mono />
        <ReanalysisRow label="Email" value={data.email} mono />
        <ReanalysisRow label="Type problème" value={data.type_probleme} />
        <ReanalysisRow
          label="Priorité"
          value={data.priorite ? (data.priorite === 'urgente' ? (<span className="inline-flex items-center gap-1"><Zap size={12}/>Urgente</span>) : 'Normale') : null}
        />
        {data.reference_externe && (
          <ReanalysisRow label="Réf. externe" value={data.reference_externe} mono />
        )}
        <div className="sm:col-span-2">
          <ReanalysisRow label="Adresse" value={data.adresse} />
        </div>
        <div className="sm:col-span-2">
          <ReanalysisRow label="Résumé" value={data.resume} />
        </div>
        <ReanalysisRow
          label="Occupants extraits"
          value={String(data.occupants?.length ?? 0)}
        />
      </dl>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={pending}
          className="bg-ok text-white px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
          style={{ background: 'var(--color-ok)' }}
        >
          {pending ? '…' : (<><CheckCircle2 size={14} />Appliquer les modifications</>)}
        </button>
        <button
          type="button"
          onClick={onIgnore}
          disabled={pending}
          className="bg-sand-mid text-ink-mid border border-sand-border px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
        >
          <XCircle size={14} />Ignorer
        </button>
      </div>
    </div>
  );
}

function ReanalysisRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-[#C8C2B8]">
        {label}
      </dt>
      <dd className={'text-[12px] dark:text-[#F0ECE4] ' + (mono ? 'font-mono' : '')}>
        {value ?? <span className="text-ink-muted italic dark:text-[#8A8278]">—</span>}
      </dd>
    </>
  );
}

// Affiche le badge type-demandeur (syndic / courtier / particulier) +
// nom de l'organisation/client liée si présent, OU "non identifié" si
// aucun lien n'a été établi par le matching automatique.
function DemandeurBadge({
  organisationId, clientId, referenceExterne,
}: {
  organisationId: string | null;
  clientId: string | null;
  referenceExterne: string | null;
}) {
  type Loaded = {
    kind: 'syndic' | 'courtier' | 'particulier' | 'unknown';
    nom: string;
    isNew: boolean;
  };
  const [info, setInfo] = useState<Loaded | null>(null);

  useEffect(() => {
    let mounted = true;
    if (organisationId) {
      fetch(`/api/admin/organisations/${organisationId}`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!mounted || !data?.ok) { setInfo({ kind: 'unknown', nom: '', isNew: false }); return; }
          setInfo({
            kind: (data.organisation.type as 'syndic' | 'courtier') ?? 'unknown',
            nom: data.organisation.nom ?? '',
            isNew: Boolean(data.organisation.created_at && (Date.now() - Date.parse(data.organisation.created_at)) < 24 * 3600 * 1000),
          });
        })
        .catch(() => mounted && setInfo({ kind: 'unknown', nom: '', isNew: false }));
    } else if (clientId) {
      fetch(`/api/admin/clients/${clientId}`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!mounted || !data?.ok) { setInfo({ kind: 'unknown', nom: '', isNew: false }); return; }
          const c = data.client;
          setInfo({
            kind: 'particulier',
            nom: [c.prenom, c.nom].filter(Boolean).join(' ') || c.nom || '',
            isNew: Boolean(c.created_at && (Date.now() - Date.parse(c.created_at)) < 24 * 3600 * 1000),
          });
        })
        .catch(() => mounted && setInfo({ kind: 'unknown', nom: '', isNew: false }));
    } else {
      // queueMicrotask : hors body sync de l'effect (react-hooks/set-state-in-effect).
      queueMicrotask(() => setInfo({ kind: 'unknown', nom: '', isNew: false }));
    }
    return () => { mounted = false; };
  }, [organisationId, clientId]);

  if (!info) return <span className="text-[10px] opacity-50">…</span>;
  const Icon = info.kind === 'syndic' ? Building2
    : info.kind === 'courtier' ? Shield
    : info.kind === 'particulier' ? User
    : AlertTriangle;
  const label = info.kind === 'syndic' ? 'Syndic' : info.kind === 'courtier' ? 'Courtier' : info.kind === 'particulier' ? 'Particulier' : 'Demandeur non identifié';
  return (
    <div className="text-[11px] flex flex-wrap items-center gap-1.5 mt-0.5">
      <span className="inline-flex items-center gap-1"><Icon size={12} /> <strong>{label}</strong></span>
      {info.nom && <span className="font-mono text-[10px] opacity-90">· {info.nom}</span>}
      {info.isNew && organisationId && (
        <span className="inline-block text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-ok-light text-ok border border-ok-mid dark:bg-[#14281E] dark:text-[#7AC9A0] dark:border-[#2A4F3A]">
          Nouvelle org
        </span>
      )}
      {info.isNew && clientId && (
        <span className="inline-block text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-ok-light text-ok border border-ok-mid dark:bg-[#14281E] dark:text-[#7AC9A0] dark:border-[#2A4F3A]">
          Nouveau client
        </span>
      )}
      {info.kind === 'unknown' && !organisationId && !clientId && (
        <span className="text-terra italic">— à associer manuellement</span>
      )}
      {referenceExterne && (
        <span className="font-mono text-[10px] opacity-80">· réf : {referenceExterne}</span>
      )}
    </div>
  );
}

// Édition de la référence d'intervention. Format imposé YYYY-NNN.
function RefEditor({
  interventionId, currentRef, onSaved,
}: {
  interventionId: string;
  currentRef: string | null;
  onSaved: (newRef: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentRef ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[14px] font-bold text-navy dark:text-[#A8C4F2]">
          {currentRef ?? '—'}
        </span>
        <button
          type="button"
          onClick={() => { setDraft(currentRef ?? ''); setEditing(true); setErr(null); }}
          className="text-[10px] text-ink-muted hover:text-navy underline inline-flex items-center gap-1 dark:text-[#C8C2B8]"
        >
          <Pencil size={12} />Modifier
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="2026-100"
          pattern="\d{4}-\d{3,5}"
          className="px-2 py-1 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid font-mono w-32"
        />
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            if (!/^\d{4}-\d{3,5}$/.test(draft)) {
              setErr('Format invalide (YYYY-NNN).');
              return;
            }
            setSaving(true);
            setErr(null);
            try {
              const r = await fetch(`/api/admin/interventions/${interventionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ref: draft }),
              });
              const data = await r.json();
              if (!data.ok) { setErr(data.error ?? 'Échec sauvegarde.'); return; }
              onSaved(draft);
              setEditing(false);
            } finally {
              setSaving(false);
            }
          }}
          className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold disabled:opacity-50 inline-flex items-center"
        >
          {saving ? '…' : <Save size={12} />}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setErr(null); }}
          className="text-[10px] text-ink-muted hover:text-terra dark:text-[#C8C2B8]"
        >
          Annuler
        </button>
      </div>
      {err && <p className="text-[11px] text-terra mt-1 font-semibold">{err}</p>}
    </div>
  );
}

// Carte éditable pour ajouter / modifier un occupant. Utilisée à la fois
// dans le mode "édition" (existing) et "ajout" (nouveau).
type OccupantEditForm = {
  prenom: string; nom: string; email: string; telephone: string;
  appartement: string; etage: string;
  contact_preference: 'email' | 'sms' | 'whatsapp' | 'both';
  type_occupant: TypeOccupant;
};

function OccupantEditCard({
  form, onChange, onSave, onCancel, onDelete, onErase, saving,
}: {
  form: OccupantEditForm;
  onChange: (next: OccupantEditForm) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  onErase?: () => void;
  saving: boolean;
}) {
  const cls = 'w-full px-2 py-1 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid';
  return (
    <div className="bg-navy-pale border border-navy-light rounded-md px-2.5 py-2 text-[12px] dark:bg-[#1A2540] dark:border-[#2C4878]">
      <div className="grid grid-cols-2 gap-1.5 mb-1.5">
        <input
          value={form.prenom}
          onChange={(e) => onChange({ ...form, prenom: e.target.value })}
          placeholder="Prénom"
          className={cls}
        />
        <input
          value={form.nom}
          onChange={(e) => onChange({ ...form, nom: e.target.value })}
          placeholder="Nom"
          className={cls}
        />
        <input
          value={form.email}
          onChange={(e) => onChange({ ...form, email: e.target.value })}
          placeholder="email"
          className={cls + ' font-mono col-span-2'}
        />
        <input
          value={form.telephone}
          onChange={(e) => onChange({ ...form, telephone: e.target.value })}
          placeholder="téléphone"
          className={cls + ' font-mono'}
        />
        <select
          value={form.contact_preference}
          onChange={(e) => onChange({ ...form, contact_preference: e.target.value as OccupantEditForm['contact_preference'] })}
          className={cls}
        >
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="both">Email & SMS</option>
        </select>
        <input
          value={form.appartement}
          onChange={(e) => onChange({ ...form, appartement: e.target.value })}
          placeholder="Appartement (ex : 101)"
          className={cls}
        />
        <input
          value={form.etage}
          onChange={(e) => onChange({ ...form, etage: e.target.value })}
          placeholder="Étage (ex : 2ème)"
          className={cls}
        />
        <select
          value={form.type_occupant}
          onChange={(e) => onChange({ ...form, type_occupant: e.target.value as TypeOccupant })}
          className={cls + ' col-span-2'}
          title="Type d'occupant"
        >
          {(Object.entries(TYPE_OCCUPANT_LABEL) as [TypeOccupant, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-1.5">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="text-[10px] bg-terra-light text-terra border border-terra-mid px-2 py-1 rounded font-bold disabled:opacity-50 inline-flex items-center gap-1 dark:bg-[#5A2E18] dark:text-[#FFB897] dark:border-[#7A3F22]"
          >
            <Trash2 size={12} />Supprimer
          </button>
        )}
        {onErase && (
          <button
            type="button"
            onClick={onErase}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            title="Effacer definitivement les donnees personnelles (RGPD)"
          >
            <UserX size={12} />
            Effacer (RGPD)
          </button>
        )}
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
          onClick={onSave}
          disabled={saving}
          className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold disabled:opacity-50 inline-flex items-center gap-1"
        >
          {saving ? '…' : (<><Save size={12} />Sauvegarder</>)}
        </button>
      </div>
    </div>
  );
}

// Palette de 10 couleurs alignée avec /api/admin/interventions/[id]/color.
// Le serveur rejette toute valeur hors de cette liste.
const INTERVENTION_COLORS = [
  { name: 'Bleu marine', hex: '#1B3A6B' },
  { name: 'Vert',        hex: '#1F6B45' },
  { name: 'Rouge',       hex: '#C4622D' },
  { name: 'Violet',      hex: '#7C3AED' },
  { name: 'Rose',        hex: '#DB2777' },
  { name: 'Jaune',       hex: '#D97706' },
  { name: 'Cyan',        hex: '#0891B2' },
  { name: 'Gris',        hex: '#6B7280' },
  { name: 'Indigo',      hex: '#4338CA' },
  { name: 'Emeraude',    hex: '#059669' },
] as const;

function ColorPicker({
  value, onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {INTERVENTION_COLORS.map((c) => {
        const active = value?.toUpperCase() === c.hex;
        return (
          <button
            key={c.hex}
            type="button"
            onClick={() => onChange(active ? null : c.hex)}
            aria-label={c.name}
            title={c.name + (active ? ' (cliquer pour réinitialiser)' : '')}
            className="rounded-full transition-transform hover:scale-110"
            style={{
              width: 22,
              height: 22,
              background: c.hex,
              border: active ? '2px solid #FFFFFF' : '2px solid rgba(0,0,0,0.1)',
              boxShadow: active ? '0 0 0 2px #1B3A6B, 0 2px 4px rgba(0,0,0,.2)' : 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        );
      })}
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-1 text-[10px] text-ink-muted hover:text-terra underline dark:text-[#C8C2B8]"
          title="Retirer la couleur"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}

// Bandeau "💡 ACP suggérée" affiché dans le drawer Dossier quand le
// pipeline mail a posé une suggestion (score 60-84 %) sans atteindre le
// seuil d'auto-link. Deux actions : confirmer (pose acp_id) ou ignorer
// (clear la suggestion). Le caller fournit les handlers async — le
// composant gère uniquement l'état pending local pour désactiver les
// boutons pendant la requête.
function AcpSuggestionBanner({
  suggestion,
  onConfirm,
  onIgnore,
}: {
  suggestion: { nom_extrait: string; acp_id_suggere: string; score: number };
  onConfirm: () => Promise<void>;
  onIgnore: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [acpName, setAcpName] = useState<string | null>(null);

  // Charge le nom de l'ACP suggérée (la suggestion ne stocke que l'id).
  // Best-effort : si la query échoue, on retombe sur "ACP suggérée" sans
  // nom, le score reste affiché.
  useEffect(() => {
    let mounted = true;
    fetch(`/api/admin/acps/${suggestion.acp_id_suggere}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!mounted) return;
        const nom = d?.acp?.nom ?? null;
        if (typeof nom === 'string' && nom.trim()) setAcpName(nom.trim());
      })
      .catch(() => { /* noop */ });
    return () => { mounted = false; };
  }, [suggestion.acp_id_suggere]);

  const scorePct = Math.round(suggestion.score * 100);
  const labelAcp = acpName ?? suggestion.nom_extrait;

  return (
    <div className="mb-2 bg-amber-light border border-[var(--color-amber-foxo)]/30 rounded-md px-3 py-2 dark:bg-[#3A2A14] dark:border-[#7A5F2A]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] text-[var(--color-amber-foxo)] dark:text-[#F0D896] flex-1 min-w-[200px]">
          <span className="font-bold inline-flex items-center gap-1"><Lightbulb size={12} />ACP suggérée :</span>{' '}
          <span className="font-semibold">{labelAcp}</span>
          <span className="text-[11px] opacity-80"> (score {scorePct} %)</span>
          {acpName && acpName.trim().toLowerCase() !== suggestion.nom_extrait.trim().toLowerCase() && (
            <div className="text-[10px] opacity-70 mt-0.5">
              Nom extrait du mail : <em>{suggestion.nom_extrait}</em>
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => { await onConfirm(); })}
            className="text-[11px] font-bold bg-ok text-white px-2.5 py-1 rounded hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
            title="Associer cette ACP à l'intervention"
          >
            <CheckCircle2 size={12} />Confirmer
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(async () => { await onIgnore(); })}
            className="text-[11px] font-bold bg-white text-terra border border-terra-mid px-2.5 py-1 rounded hover:bg-terra-light disabled:opacity-50 inline-flex items-center gap-1 dark:bg-[#221E1A] dark:hover:bg-[#3A2A14]"
            title="Effacer la suggestion (l'ACP restera non associée)"
          >
            <XCircle size={12} />Ignorer
          </button>
        </div>
      </div>
    </div>
  );
}

// Picker ACP/Immeuble — recherche filtrée par syndic + bouton lien
// vers création nouvelle ACP. Sauvegarde optimiste via PATCH
// /api/admin/interventions/[id] avec { acp_id }.
function AcpPicker({
  interventionId, organisationId, currentAcp, onSaved,
}: {
  interventionId: string;
  organisationId: string | null;
  currentAcp: Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'> | null;
  onSaved: (acp: Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'> | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville' | 'code_postal'>[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Recherche debounce
  useEffect(() => {
    if (!editing) return;
    // queueMicrotask : hors body sync de l'effect (react-hooks/set-state-in-effect).
    // Le setLoading(false) dans le cleanup et dans le setTimeout sont OK car
    // exécutés en async (cleanup ou callback différé).
    queueMicrotask(() => setLoading(true));
    const t = setTimeout(async () => {
      const res = await searchAcpsForIntervention({ query, organisationId });
      if (res.ok) setResults(res.data);
      setLoading(false);
    }, 250);
    return () => { clearTimeout(t); setLoading(false); };
  }, [query, organisationId, editing]);

  async function selectAcp(acp: Pick<Acp, 'id' | 'nom' | 'adresse' | 'ville'>) {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/interventions/${interventionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acp_id: acp.id }),
      });
      const data = await r.json();
      if (!data.ok) {
        setMsg({ kind: 'err', msg: data.error ?? 'Échec association.' });
        return;
      }
      onSaved(acp);
      setEditing(false);
      setMsg({ kind: 'ok', msg: 'ACP associée.' });
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  async function clearAcp() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/interventions/${interventionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acp_id: null }),
      });
      const data = await r.json();
      if (!data.ok) {
        setMsg({ kind: 'err', msg: data.error ?? 'Échec déliaison.' });
        return;
      }
      onSaved(null);
      setMsg({ kind: 'ok', msg: 'ACP retirée.' });
    } catch (e) {
      setMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSaving(false);
    }
  }

  if (currentAcp && !editing) {
    return (
      <div>
        <div className="bg-white border border-sand-border rounded-md px-2.5 py-2 text-[12px] dark:bg-[#221E1A] dark:border-[#3D3A32]">
          <div className="font-bold text-ink dark:text-[#F0ECE4]">{currentAcp.nom ?? '—'}</div>
          <div className="text-[11px] text-ink-muted dark:text-[#C8C2B8]">
            {[currentAcp.adresse, currentAcp.ville].filter(Boolean).join(', ') || '—'}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <button
            type="button"
            onClick={() => { setEditing(true); setQuery(''); setResults([]); }}
            className="text-[10px] bg-sand-mid text-ink-mid px-2 py-1 rounded font-bold inline-flex items-center gap-1"
          >
            <Pencil size={12} />Changer
          </button>
          <button
            type="button"
            onClick={clearAcp}
            disabled={saving}
            className="text-[10px] bg-terra-light text-terra border border-terra-mid px-2 py-1 rounded font-bold disabled:opacity-50 inline-flex items-center gap-1"
          >
            <X size={12} />Retirer
          </button>
        </div>
        {msg && (
          <div className={'mt-1.5 text-[11px] font-semibold ' + (msg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
            {msg.msg}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {!currentAcp && !editing ? (
        <div>
          <div className="text-[11px] text-ink-muted italic mb-1.5 dark:text-[#C8C2B8]">
            Aucune ACP/immeuble associée à cette intervention.
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => { setEditing(true); setQuery(''); setResults([]); }}
              className="text-[10px] bg-navy text-white px-2.5 py-1.5 rounded font-bold inline-flex items-center gap-1"
            >
              <Search size={12} />Associer une ACP
            </button>
            <Link
              href="/admin/syndics?new=acp"
              target="_blank"
              className="text-[10px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1.5 rounded font-bold inline-flex items-center gap-1"
            >
              <Plus size={12} />Nouvelle ACP
            </Link>
          </div>
          {msg && (
            <div className={'mt-1.5 text-[11px] font-semibold ' + (msg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
              {msg.msg}
            </div>
          )}
        </div>
      ) : (
        <div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={organisationId ? 'Rechercher dans les ACPs du syndic…' : 'Rechercher (nom, adresse, ville)…'}
            autoFocus
            className="w-full px-3 py-2 border border-sand-border rounded-lg text-[12px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
          />
          <div className="mt-2 max-h-[200px] overflow-y-auto bg-white border border-sand-border rounded-md divide-y divide-sand-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:divide-[#3D3A32]">
            {loading && <div className="px-2 py-2 text-[11px] text-ink-muted">Chargement…</div>}
            {!loading && results.length === 0 && (
              <div className="px-2 py-2 text-[11px] text-ink-muted">Aucun résultat.</div>
            )}
            {!loading && results.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => selectAcp(a)}
                disabled={saving}
                className="block w-full text-left px-2.5 py-2 text-[12px] hover:bg-sand disabled:opacity-50 dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
              >
                <div className="font-bold">{a.nom}</div>
                <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">
                  {[a.adresse, a.code_postal, a.ville].filter(Boolean).join(', ') || '—'}
                </div>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-[10px] text-ink-muted underline"
            >
              Annuler
            </button>
            {!organisationId && (
              <span className="text-[10px] text-ink-muted italic inline-flex items-center gap-1">
                <AlertTriangle size={12} />Aucun syndic défini sur cette intervention — recherche élargie à toutes les ACPs.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// HistoriquePanel — fetch + affiche l'historique d'interventions
// associées au dossier courant : par appartement (avec récidive si même
// type < 12 mois), par ACP, et compteur global de récidives.
function HistoriquePanel({ interventionId }: { interventionId: string }) {
  type HistEntry = {
    id: string;
    ref: string | null;
    statut: string;
    type: string | null;
    date: string;
    description: string | null;
    appartements: string[];
    is_recidive: boolean;
  };
  type ParAppartement = {
    appartement: string;
    occupant: { nom: string | null; prenom: string | null; email: string | null } | null;
    interventions: HistEntry[];
  };
  type HistResponse = {
    par_appartement: ParAppartement[];
    par_acp: HistEntry[];
    recidives_detectees: number;
  };

  const [data, setData] = useState<HistResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acpFilter, setAcpFilter] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    // queueMicrotask : hors body sync de l'effect (react-hooks/set-state-in-effect).
    queueMicrotask(() => setLoaded(false));
    fetch(`/api/admin/interventions/${interventionId}/historique`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!mounted) return;
        if (d.ok) setData({ par_appartement: d.par_appartement, par_acp: d.par_acp, recidives_detectees: d.recidives_detectees });
        else setError(d.error ?? 'Erreur chargement.');
        setLoaded(true);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Erreur réseau.');
        setLoaded(true);
      });
    return () => { mounted = false; };
  }, [interventionId]);

  if (!loaded) {
    return <div className="text-[12px] text-ink-mid italic dark:text-[#C8C2B8]">Chargement…</div>;
  }
  if (error) {
    return (
      <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-md px-3 py-2 font-semibold">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const filteredAcp = acpFilter
    ? data.par_acp.filter((iv) => iv.appartements.some((a) => a.toLowerCase().includes(acpFilter.toLowerCase())))
    : data.par_acp;

  const allApts = Array.from(new Set(data.par_acp.flatMap((iv) => iv.appartements))).sort();

  return (
    <div className="space-y-4">
      {data.recidives_detectees > 0 && (
        <div className="bg-amber-light border border-[var(--color-amber-foxo)]/30 rounded-xl px-3 py-2.5 text-[12px] dark:bg-[#3A2A14] dark:border-[#7A5F2A] dark:text-[#F0D896]">
          <div className="font-bold text-[var(--color-amber-foxo)] inline-flex items-center gap-1.5 dark:text-[#F0D896]">
            <RefreshCw size={14} />{data.recidives_detectees} récidive{data.recidives_detectees > 1 ? 's' : ''} détectée{data.recidives_detectees > 1 ? 's' : ''}
          </div>
          <div className="text-[11px] text-[#5A3F15] dark:text-[#F0D896]">
            Même type de problème dans les 12 derniers mois sur les mêmes apparts.
          </div>
        </div>
      )}

      {/* Par appartement */}
      <Block title={<span className="inline-flex items-center gap-1.5"><Home size={12}/>Historique par appartement ({data.par_appartement.length})</span>}>
        {data.par_appartement.length === 0 ? (
          <div className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
            Aucun historique pour les apparts de ce dossier.
          </div>
        ) : (
          <div className="space-y-3">
            {data.par_appartement.map((group) => (
              <div key={group.appartement} className="bg-white border border-sand-border rounded-md overflow-hidden dark:bg-[#221E1A] dark:border-[#3D3A32]">
                <div className="bg-sand px-2.5 py-1.5 border-b border-sand-border dark:bg-[#141210] dark:border-[#2C2A24]">
                  <div className="font-bold text-[12px] text-ink dark:text-[#F0ECE4]">
                    Apt {group.appartement}
                    {(group.occupant?.prenom || group.occupant?.nom) && (
                      <span className="font-normal ml-1 text-ink-mid dark:text-[#C8C2B8]">
                        — {[group.occupant?.prenom, group.occupant?.nom].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-ink-muted inline-flex items-center gap-1 dark:text-[#C8C2B8]">
                    <ClipboardList size={10} />{group.interventions.length} intervention{group.interventions.length !== 1 ? 's' : ''} précédente{group.interventions.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="divide-y divide-sand-mid dark:divide-[#3D3A32]">
                  {group.interventions.map((iv) => <HistEntryRow key={iv.id} iv={iv} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Block>

      {/* Par ACP */}
      <Block title={<span className="inline-flex items-center gap-1.5"><Building2 size={12}/>Historique ACP ({data.par_acp.length})</span>}>
        {data.par_acp.length === 0 ? (
          <div className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
            Aucun historique sur cette ACP.
          </div>
        ) : (
          <>
            {allApts.length > 1 && (
              <select
                value={acpFilter}
                onChange={(e) => setAcpFilter(e.target.value)}
                className="w-full mb-2 px-2 py-1.5 border border-sand-border rounded text-[11px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
              >
                <option value="">Tous les appartements</option>
                {allApts.map((apt) => <option key={apt} value={apt}>Apt {apt}</option>)}
              </select>
            )}
            <div className="bg-white border border-sand-border rounded-md overflow-hidden divide-y divide-sand-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:divide-[#3D3A32]">
              {filteredAcp.map((iv) => <HistEntryRow key={iv.id} iv={iv} />)}
            </div>
          </>
        )}
      </Block>
    </div>
  );
}

function HistEntryRow({ iv }: { iv: { id: string; ref: string | null; statut: string; type: string | null; date: string; description: string | null; appartements: string[]; is_recidive: boolean } }) {
  const date = new Date(iv.date).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <Link
      href={`/admin/interventions/${iv.id}`}
      target="_blank"
      className="block px-2.5 py-2 hover:bg-sand-hover dark:hover:bg-[#2A2520]"
    >
      <div className="flex items-center justify-between gap-2 mb-0.5 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-[11px] font-bold text-navy dark:text-[#A8C4F2]">{iv.ref ?? '?'}</span>
          <span className="text-[10px] font-mono text-ink-muted dark:text-[#C8C2B8]">{date}</span>
          {iv.is_recidive && (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-light text-[var(--color-amber-foxo)] border border-[var(--color-amber-foxo)]/30">
              <RefreshCw size={10} />Récidive
            </span>
          )}
        </div>
        <Badge statut={iv.statut as never} />
      </div>
      <div className="text-[11px] text-ink dark:text-[#F0ECE4]">{iv.type ?? '—'}</div>
      {iv.description && (
        <div className="text-[10px] text-ink-mid mt-0.5 line-clamp-2 dark:text-[#C8C2B8]">{iv.description}</div>
      )}
      {iv.appartements.length > 0 && (
        <div className="text-[10px] text-ink-muted mt-0.5 inline-flex items-center gap-1 dark:text-[#C8C2B8]">
          <MapPin size={10} />Apt {iv.appartements.join(', ')}
        </div>
      )}
    </Link>
  );
}

// CourtierMandatePanel — bloc « Courtier mandaté » du drawer. Affiche les
// courtiers/experts déjà associés au dossier (dossiers_sinistres) avec un
// bouton Retirer (confirm), et propose une recherche d'organisation filtrée
// type courtier/expert + bouton Associer. La liste `courtiers` est fournie par
// le parent (chargée avec les occupants) ; `onChanged` la rafraîchit après
// chaque action.
function CourtierMandatePanel({
  interventionId,
  courtiers,
  onChanged,
}: {
  interventionId: string;
  courtiers: { id: string; nom: string; type: string }[];
  onChanged: () => void | Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [results, setResults] = useState<{ id: string; nom: string; type: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Recherche debouncée (≥ 2 car.), restreinte aux courtiers + experts.
  useEffect(() => {
    if (!showAdd) return;
    const q = searchQ.trim();
    if (q.length < 2) {
      queueMicrotask(() => setResults([]));
      return;
    }
    let mounted = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await searchOrganisations(q, { types: ['courtier', 'expert'] });
      if (!mounted) return;
      setResults(res.ok && res.data ? res.data.map((o) => ({ id: o.id, nom: o.nom, type: o.type })) : []);
      setSearching(false);
    }, 300);
    return () => { mounted = false; clearTimeout(t); };
  }, [searchQ, showAdd]);

  const linkedIds = new Set(courtiers.map((c) => c.id));

  async function associer(courtierId: string) {
    setBusyId(courtierId);
    setMsg(null);
    try {
      const res = await linkCourtierToDossier(interventionId, courtierId);
      if (res.error) { setMsg({ kind: 'err', msg: res.error }); return; }
      setMsg({ kind: 'ok', msg: 'Courtier associé.' });
      setShowAdd(false);
      setSearchQ(''); setResults([]);
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function retirer(c: { id: string; nom: string }) {
    if (!confirm(`Retirer ${c.nom} de ce dossier ?`)) return;
    setBusyId(c.id);
    setMsg(null);
    try {
      const res = await unlinkCourtierFromDossier(interventionId, c.id);
      if (res.error) { setMsg({ kind: 'err', msg: res.error }); return; }
      setMsg({ kind: 'ok', msg: 'Courtier retiré.' });
      await onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Block title={<span className="inline-flex items-center gap-1.5"><Users size={12}/>Courtier mandaté ({courtiers.length})</span>}>
      {courtiers.length === 0 ? (
        <div className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
          Aucun courtier ni expert mandaté sur ce dossier.
        </div>
      ) : (
        <div className="space-y-1.5">
          {courtiers.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 bg-white border border-sand-border rounded-md px-2.5 py-1.5 dark:bg-[#221E1A] dark:border-[#3D3A32]">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Link
                  href={`/admin/${c.type === 'expert' ? 'experts' : 'courtiers'}?id=${c.id}`}
                  className="font-bold text-[12px] text-navy hover:underline dark:text-[#A8C4F2] truncate"
                >
                  {c.nom}
                </Link>
                <TypeBadge type={c.type} />
              </div>
              <button
                type="button"
                onClick={() => retirer(c)}
                disabled={busyId === c.id}
                className="text-[10px] text-terra inline-flex items-center gap-1 font-bold disabled:opacity-50 hover:underline"
              >
                <Trash2 size={12} />Retirer
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => { setShowAdd(!showAdd); setMsg(null); }}
        className="mt-2 text-[10px] bg-sand-mid text-navy border border-sand-border rounded px-2 py-1 font-bold inline-flex items-center gap-1 dark:bg-[rgba(255,255,255,.06)] dark:text-[#A8C4F2] dark:border-[#3D3A32]"
      >
        <Plus size={12} />Associer un courtier
      </button>

      {showAdd && (
        <div className="mt-2 bg-sand border border-sand-border rounded-md p-2.5 space-y-2 dark:bg-[#141210] dark:border-[#2C2A24]">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Nom ou email du courtier / expert…"
              className="w-full pl-7 pr-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32]"
            />
          </div>
          {searching && <div className="text-[10px] text-ink-muted italic">Recherche…</div>}
          {!searching && searchQ.trim().length >= 2 && results.length === 0 && (
            <div className="text-[10px] text-ink-muted italic">Aucun courtier ni expert trouvé.</div>
          )}
          {results.length > 0 && (
            <div className="space-y-1">
              {results.map((o) => {
                const already = linkedIds.has(o.id);
                return (
                  <div key={o.id} className="flex items-center justify-between gap-2 bg-white border border-sand-border rounded px-2 py-1.5 dark:bg-[#221E1A] dark:border-[#3D3A32]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12px] font-bold text-ink truncate dark:text-[#F0ECE4]">{o.nom}</span>
                      <TypeBadge type={o.type} />
                    </div>
                    <button
                      type="button"
                      onClick={() => associer(o.id)}
                      disabled={busyId === o.id || already}
                      className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold disabled:opacity-40 inline-flex items-center gap-1"
                    >
                      {already ? <><Check size={12} />Associé</> : <><Plus size={12} />Associer</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {msg && (
        <div className={'mt-2 text-[11px] font-semibold ' + (msg.kind === 'ok' ? 'text-ok dark:text-[#7AC9A0]' : 'text-terra')}>
          {msg.msg}
        </div>
      )}
    </Block>
  );
}

// LiensPanel — affiche les dossiers liés + mails liés depuis
// /api/admin/interventions/[id]/liens. Si la migration 2026-05-20
// n'est pas appliquée, les sections sont vides (graceful).
function LiensPanel({ interventionId }: { interventionId: string }) {
  type Lien = {
    type_lien: string; source: string; note: string | null; created_at: string;
    liee_id: string; liee_ref: string | null; liee_statut: string; liee_updated_at: string;
  };
  type MailLink = {
    id: string; gmail_message_id: string;
    from_email: string | null; from_name: string | null;
    subject: string | null; date: string | null; snippet: string | null;
    type_mail: string; created_at: string;
  };
  const [liens, setLiens] = useState<Lien[]>([]);
  const [mails, setMails] = useState<MailLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showLier, setShowLier] = useState(false);
  // Lier modal
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; ref: string | null }[]>([]);
  const [lierTarget, setLierTarget] = useState<{ id: string; ref: string | null } | null>(null);
  const [lierType, setLierType] = useState<'meme_dossier' | 'suivi' | 'doublon' | 'related'>('related');
  const [lierNote, setLierNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch(`/api/admin/interventions/${interventionId}/liens`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) {
          setLiens(data.liens ?? []);
          setMails(data.mails ?? []);
        }
        setLoaded(true);
      })
      .catch(() => mounted && setLoaded(true));
    return () => { mounted = false; };
  }, [interventionId]);

  // Recherche d'interventions à lier (par ref ou client)
  useEffect(() => {
    if (!showLier) return;
    const q = searchQ.trim();
    if (q.length < 2) {
      // queueMicrotask : hors body sync de l'effect (react-hooks/set-state-in-effect).
      queueMicrotask(() => setSearchResults([]));
      return;
    }
    const t = setTimeout(async () => {
      // Recherche directe via une query simple sur la table interventions
      // exposée à l'admin via RLS. On utilise le /admin/interventions/search
      // s'il existait — sinon, query côté drawer non disponible. À défaut,
      // on offre un fallback : coller un UUID directement.
      try {
        const r = await fetch(`/api/admin/mails?q=${encodeURIComponent(q)}`);
        // Pas d'endpoint dédié — on n'utilise pas ce fetch
        void r;
      } catch { /* noop */ }
      setSearchResults([]);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, showLier]);

  async function lierManually() {
    if (!lierTarget) {
      setMsg({ kind: 'err', msg: 'Choisis une intervention.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/interventions/${interventionId}/lier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intervention_liee_id: lierTarget.id,
          type_lien: lierType,
          note: lierNote || null,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setMsg({ kind: 'err', msg: data.error ?? 'Échec création lien.' });
        return;
      }
      setMsg({ kind: 'ok', msg: 'Lien créé.' });
      setShowLier(false);
      setLierTarget(null); setLierNote(''); setSearchQ('');
      // Recharge
      const r2 = await fetch(`/api/admin/interventions/${interventionId}/liens`, { cache: 'no-store' });
      const data2 = await r2.json();
      if (data2.ok) {
        setLiens(data2.liens ?? []);
        setMails(data2.mails ?? []);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  // Bandeau "doublon possible" si un lien type_lien='doublon' existe
  const doublonLink = liens.find((l) => l.type_lien === 'doublon');

  // Bandeau "dossier antérieur non résolu" : tout lien (sauf le doublon
  // déjà signalé ci-dessus) pointant vers une intervention dont le statut
  // n'est pas 'cloturee'. Cohérent avec la fenêtre de détection 12 mois
  // côté cron (lib/cron/check-mails.ts) et historique du drawer.
  const unresolvedLinks = liens.filter(
    (l) => l.type_lien !== 'doublon' && l.liee_statut !== 'cloturee',
  );

  return (
    <>
      {doublonLink && (
        <div className="bg-amber-light border border-[var(--color-amber-foxo)]/30 rounded-xl px-3 py-2.5 mb-3 text-[12px] dark:bg-[#3A2A14] dark:border-[#7A5F2A] dark:text-[#F0D896]">
          <div className="font-bold mb-0.5 text-[var(--color-amber-foxo)] inline-flex items-center gap-1.5 dark:text-[#F0D896]"><AlertTriangle size={12} />Doublon possible</div>
          <div className="text-[#5A3F15] dark:text-[#F0D896]">
            Lié à <Link href={`/admin/interventions/${doublonLink.liee_id}`} target="_blank" className="font-mono font-bold underline">{doublonLink.liee_ref ?? '?'}</Link>
            {doublonLink.note && <> · <span className="italic">{doublonLink.note}</span></>}
          </div>
        </div>
      )}

      {unresolvedLinks.length > 0 && (
        <div className="bg-terra-light border border-terra-mid rounded-xl px-3 py-2.5 mb-3 text-[12px] dark:bg-[#3A1F14] dark:border-[#7A3F2A] dark:text-[#F0AE96]">
          <div className="font-bold mb-1 text-terra inline-flex items-center gap-1.5 dark:text-[#F0AE96]">
            <AlertTriangle size={14} />Dossier antérieur non résolu possible — voir historique
          </div>
          <div className="text-[#7A2F15] dark:text-[#F0AE96] flex flex-wrap items-center gap-x-2 gap-y-1">
            {unresolvedLinks.length === 1 ? (
              <>
                Lié à{' '}
                <Link
                  href={`/admin/interventions/${unresolvedLinks[0].liee_id}`}
                  target="_blank"
                  className="font-mono font-bold underline"
                >
                  {unresolvedLinks[0].liee_ref ?? '?'}
                </Link>{' '}
                ({unresolvedLinks[0].liee_statut})
                {unresolvedLinks[0].note && (
                  <> · <span className="italic">{unresolvedLinks[0].note}</span></>
                )}
              </>
            ) : (
              <>
                <span>{unresolvedLinks.length} dossiers liés non clôturés :</span>
                {unresolvedLinks.map((l) => (
                  <Link
                    key={l.liee_id}
                    href={`/admin/interventions/${l.liee_id}`}
                    target="_blank"
                    className="font-mono font-bold underline"
                    title={`${l.liee_statut}${l.note ? ' · ' + l.note : ''}`}
                  >
                    {l.liee_ref ?? '?'}
                  </Link>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Dossiers liés */}
      <Block title={<span className="inline-flex items-center gap-1.5"><Link2 size={12}/>Dossiers liés ({liens.length})</span>}>
        {liens.length === 0 ? (
          <div className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
            Aucun lien pour ce dossier.
          </div>
        ) : (
          <div className="space-y-1.5">
            {liens.map((l) => (
              <div key={l.liee_id} className="flex items-center justify-between gap-2 bg-white border border-sand-border rounded-md px-2.5 py-1.5 dark:bg-[#221E1A] dark:border-[#3D3A32]">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <Link href={`/admin/interventions/${l.liee_id}`} target="_blank" className="font-mono text-[12px] font-bold text-navy hover:underline dark:text-[#A8C4F2]">
                    {l.liee_ref ?? '?'}
                  </Link>
                  <LienBadge type={l.type_lien} source={l.source} />
                  {l.note && <span className="text-[10px] text-ink-muted italic truncate dark:text-[#C8C2B8]">{l.note}</span>}
                </div>
                <span className="text-[10px] text-ink-muted whitespace-nowrap dark:text-[#C8C2B8]">{l.liee_statut}</span>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowLier(!showLier)}
          className="mt-2 text-[10px] bg-sand-mid text-navy border border-sand-border rounded px-2 py-1 font-bold inline-flex items-center gap-1 dark:bg-[rgba(255,255,255,.06)] dark:text-[#A8C4F2] dark:border-[#3D3A32]"
        >
          <Link2 size={12} />Lier manuellement
        </button>
        {showLier && (
          <div className="mt-2 bg-sand border border-sand-border rounded-md p-2.5 space-y-2 dark:bg-[#141210] dark:border-[#2C2A24]">
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="UUID de l'intervention liée (copie depuis l'autre drawer)"
              className="w-full px-2 py-1.5 border border-sand-border rounded text-[11px] bg-white outline-none focus:border-navy-mid font-mono dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
            {searchQ.trim().length >= 8 && (
              <button
                type="button"
                onClick={() => setLierTarget({ id: searchQ.trim(), ref: null })}
                className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold"
              >
                Utiliser cet ID
              </button>
            )}
            {searchResults.length > 0 && (
              <div className="bg-white border border-sand-border rounded-md max-h-[160px] overflow-y-auto dark:bg-[#221E1A] dark:border-[#3D3A32]">
                {searchResults.map((res) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => { setLierTarget(res); setSearchQ(res.ref ?? res.id); }}
                    className="block w-full text-left px-2 py-1.5 text-[11px] hover:bg-sand dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
                  >
                    <span className="font-mono font-bold">{res.ref ?? '?'}</span>
                    <span className="ml-2 text-[10px] text-ink-muted">{res.id.slice(0, 8)}…</span>
                  </button>
                ))}
              </div>
            )}
            {lierTarget && (
              <>
                <div className="text-[11px] text-ok dark:text-[#7AC9A0]">
                  Cible : <span className="font-mono font-bold">{lierTarget.ref ?? lierTarget.id.slice(0, 8) + '…'}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['meme_dossier', 'suivi', 'doublon', 'related'] as const).map((t) => (
                    <label key={t} className={
                      'px-2 py-1 border rounded text-[10px] font-bold cursor-pointer text-center ' +
                      (lierType === t
                        ? 'bg-navy text-white border-navy'
                        : 'bg-white text-ink-mid border-sand-border dark:bg-[#221E1A] dark:text-[#C8C2B8] dark:border-[#3D3A32]')
                    }>
                      <input type="radio" checked={lierType === t} onChange={() => setLierType(t)} className="sr-only" />
                      {t === 'meme_dossier' ? 'Même dossier' : t === 'suivi' ? 'Suivi' : t === 'doublon' ? 'Doublon' : 'Lié'}
                    </label>
                  ))}
                </div>
                <input
                  value={lierNote}
                  onChange={(e) => setLierNote(e.target.value)}
                  placeholder="Note (optionnel)"
                  className="w-full px-2 py-1.5 border border-sand-border rounded text-[11px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={lierManually}
                    disabled={saving}
                    className="text-[10px] bg-navy text-white px-2.5 py-1 rounded font-bold disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {saving ? '…' : (<><Save size={12} />Créer le lien</>)}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowLier(false); setLierTarget(null); }}
                    className="text-[10px] bg-sand-mid text-ink-mid px-2.5 py-1 rounded font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
                  >
                    Annuler
                  </button>
                </div>
              </>
            )}
            {msg && (
              <div className={'text-[10px] font-semibold ' + (msg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                {msg.msg}
              </div>
            )}
          </div>
        )}
      </Block>

      {/* Mails liés */}
      <Block title={<span className="inline-flex items-center gap-1.5"><Mail size={12}/>Mails liés ({mails.length})</span>}>
        {mails.length === 0 ? (
          <div className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
            Aucun mail rattaché.
          </div>
        ) : (
          <div className="space-y-1.5">
            {mails.map((m) => (
              <Link
                key={m.id}
                href={`/admin/mails?id=${encodeURIComponent(m.gmail_message_id)}`}
                className="block bg-white border border-sand-border rounded-md px-2.5 py-1.5 hover:bg-sand-hover dark:bg-[#221E1A] dark:border-[#3D3A32]"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-bold text-[12px] text-ink dark:text-[#F0ECE4] flex-1 truncate">
                    {m.subject ?? '(sans sujet)'}
                  </div>
                  <MailTypeBadge type={m.type_mail} />
                </div>
                <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8] truncate mt-0.5">
                  {m.from_name || m.from_email || '—'}
                  {m.date && <span className="ml-2 font-mono">{new Date(m.date).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Block>
    </>
  );
}

function LienBadge({ type, source }: { type: string; source: string }) {
  const label = type === 'meme_dossier' ? 'Même dossier'
    : type === 'suivi' ? 'Suivi'
    : type === 'doublon' ? 'Doublon'
    : 'Lié';
  const color = type === 'doublon' ? 'bg-amber-light text-[var(--color-amber-foxo)] border-[var(--color-amber-foxo)]/30'
    : type === 'meme_dossier' ? 'bg-navy-pale text-navy border-navy-light'
    : type === 'suivi' ? 'bg-ok-light text-ok border-ok-mid'
    : 'bg-sand-mid text-ink-mid border-sand-border';
  return (
    <span className={`inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${color}`}>
      {label}{source === 'auto' ? ' · auto' : ''}
    </span>
  );
}

function MailTypeBadge({ type }: { type: string }) {
  const label = type === 'entrant' ? 'Entrant'
    : type === 'suivi' ? 'Suivi'
    : type === 'assurance' ? 'Assurance'
    : type === 'confirmation' ? 'Confirmation'
    : type === 'annulation' ? 'Annulation'
    : type === 'rapport_demande' ? 'Rapport'
    : type;
  return (
    <span className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sand-mid text-ink-mid border border-sand-border dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]">
      {label}
    </span>
  );
}

function Block({ title, children, id }: { title: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <div
      id={id}
      className="bg-[var(--color-cream)] rounded-[10px] px-3.5 py-3 mb-3 scroll-mt-4"
      style={{ boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' }}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className="w-[3px] h-3.5 rounded-sm bg-[var(--color-navy)]"></span>
        <div className="font-sora text-[10px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em] flex-1">
          {title}
        </div>
      </div>
      <div className="text-[13px] text-[var(--color-ink)] leading-relaxed">{children}</div>
    </div>
  );
}
