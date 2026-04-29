'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DashboardData } from './page';
import { Dashboard, DashboardTechs } from './Dashboard';
import {
  STATUT_INFO,
  STATUT_PIPELINE,
  type InterventionRow,
  type StatutIntervention,
} from '@/lib/types/database';
import type { Utilisateur } from '@/lib/types/database';
import { updateInterventionStatus, resendRapportToSyndic, assignTechnician, saveRapportDraftFromAdmin } from './actions';
import { FactureBlock } from './FactureBlock';
import { DocumentsBlock } from './DocumentsBlock';
import { AssistantChat, type QuickAction } from './assistant/AssistantChat';
import { TypeBadge } from '@/components/TypeBadge';
import { SendSmsModal } from '@/components/SendSmsModal';
import { MailStepper } from './MailStepper';

const DRAWER_AI_ACTIONS: QuickAction[] = [
  { icon: '📝', label: 'Rédiger le rapport', prompt: 'Génère les 4 sections du rapport (degats, inspection, conclusion, recommandations) en JSON pur, en te basant sur la description initiale, le contexte du dossier et les données disponibles. Respecte les règles FoxO ("capteur d\'humidité", formulations prudentes, prose française).' },
  { icon: '✉️', label: 'Email au syndic', prompt: 'Rédige un email professionnel au syndic adapté au statut actuel du dossier. Inclus l\'objet et le corps, prêt à copier-coller. Référence la ref FoxO et l\'ACP.' },
  { icon: '👥', label: 'Email aux occupants', prompt: 'Rédige un message court, clair et bienveillant à envoyer aux occupants pour les informer (intervention prévue / replanifiée / clôturée selon le statut). Inclus l\'heure si elle est connue.' },
  { icon: '🔎', label: 'Résumé du dossier', prompt: 'Donne-moi un résumé synthétique du dossier en 3 lignes maximum : la situation, où on en est, ce qui reste à faire.' },
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
        hour: '2-digit', minute: '2-digit',
      })
    : d.toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
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
        <div className="h-[3px] flex-1 rounded-md bg-[#F7EDE5] border border-[#E8C4AF]" />
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
}: {
  initialRows: InterventionRow[];
  techs: Utilisateur[];
  loadError: string | null;
  dashboard: DashboardData;
  serverNowIso: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const techFilter = searchParams.get('tech');
  const statutParam = searchParams.get('statut');   // 'nouvelle' | 'en_cours' | 'en_suspens' | 'rapport' | 'cloturee' | null

  // Source de temps SSR-stable. Initialisée avec la valeur serveur pour
  // que le SSR et la 1ʳᵉ hydratation produisent le même HTML (React #418).
  // Mise à jour côté client après mount + chaque minute pour rafraîchir
  // les "il y a Xh" relatifs.
  const [nowMs, setNowMs] = useState<number>(() => Date.parse(serverNowIso));
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<typeof STATUTS_FILTRE[number]>('tous');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'dossier' | 'suivi' | 'documents' | 'ia'>('dossier');
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
  };
  const [drawerOccupants, setDrawerOccupants] = useState<DrawerOccupant[]>([]);
  const [drawerOccupantsLoading, setDrawerOccupantsLoading] = useState(false);

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

  // "En cours" est synthétique → confirmee + realisee. Pour le mois en cours
  // sur "cloturee", on filtre aussi par updated_at dans le mois courant.
  const today = useMemo(() => new Date(), []);
  function statutMatches(ivStatut: StatutIntervention, ivUpdatedAt: string | null): boolean {
    if (!statutParam) return true;
    if (statutParam === 'en_cours') return ivStatut === 'confirmee' || ivStatut === 'realisee';
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
      return matchQuery && matchSelectFilter && matchUrlStatut && matchTech;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filter, techFilter, statutParam]);

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

  function openDrawer(id: string) {
    const iv = rows.find((r) => r.id === id);
    setSelectedId(id);
    setTab('dossier');
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

    // Lazy-load occupants
    setDrawerOccupants([]);
    setDrawerOccupantsLoading(true);
    fetch(`/api/admin/occupants/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setDrawerOccupants(data.occupants ?? []);
          // Cocher tous les occupants par défaut pour la notif
          setNotifySelectedIds(new Set((data.occupants ?? []).map((o: { id: string }) => o.id)));
        }
      })
      .catch(() => { /* noop */ })
      .finally(() => setDrawerOccupantsLoading(false));
  }
  function closeDrawer() {
    setSelectedId(null);
    setStatusMessage(null);
    setAssignMessage(null);
    setIaSaveMessage(null);
    setDrawerOccupants([]);
  }

  function handleAiRapportSave(sections: { degats: string; inspection: string; conclusion: string; recommandations: string }) {
    if (!selected) return;
    setIaSaveMessage(null);
    startIaSaveTransition(async () => {
      const res = await saveRapportDraftFromAdmin(selected.id, sections);
      if (res.error) {
        setIaSaveMessage({ kind: 'err', msg: res.error });
      } else {
        setIaSaveMessage({ kind: 'ok', msg: '✓ Brouillon sauvegardé. Le tech le verra dans son onglet Rapport.' });
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
        msg: newTech ? `✓ Assigné à ${newTech.prenom ?? ''} ${newTech.nom ?? ''}`.trim() : '✓ Désassigné',
      });
    });
  }

  function resendRapport() {
    if (!selected) return;
    setEmailMessage(null);
    startEmailTransition(async () => {
      const res = await resendRapportToSyndic(selected.id);
      if (res.error) setEmailMessage({ kind: 'err', msg: res.error });
      else setEmailMessage({ kind: 'ok', msg: 'Rapport envoyé au syndic ✓' });
    });
  }

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
      setStatusMessage('✓ Statut mis à jour');
    });
  }

  // ── Workflow actions ────────────────────────────────────────────────

  // Charge les créneaux libres du technicien sélectionné, pour le picker.
  useEffect(() => {
    if (!selectedId || !pendingTechId) {
      setAvailableCreneaux([]);
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
        setFormMsg({ kind: 'ok', msg: '✓ Sauvegardé' });
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
        setScheduleMsg({ kind: 'ok', msg: '✓ Créneau planifié — statut "attente"' });
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
          msg: `✓ ${data.sent} envoi(s) OK${data.failed ? ` · ${data.failed} échec(s)` : ''}`,
        });
      } catch (e) {
        setNotifyMsg({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
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
        setConfirmMailMsg({ kind: 'ok', msg: '✓ Confirmation envoyée — statut "confirmée"' });
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

      {/* Topbar */}
      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Tableau de bord</h1>
          <p className="text-[11px] text-ink-muted mt-0.5 capitalize">
            {new Date(nowMs).toLocaleDateString('fr-BE', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
        {techFilterName && (
          <div className="bg-[#A17244] text-white rounded-full px-3 py-1.5 text-[11px] font-bold flex items-center gap-2">
            <span>🔎 Filtré : {techFilterName}</span>
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="hover:opacity-70 leading-none"
              title="Retirer le filtre"
            >
              ✕
            </button>
          </div>
        )}
      </header>

      {loadError && (
        <div className="mx-6 mt-3 px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold flex-shrink-0">
          Connexion à la base limitée : {loadError}
        </div>
      )}

      {/* Dashboard sections 1-4 : Stats → Alertes → Mail → À faire aujourd'hui */}
      <div className="px-6 pt-4 flex-shrink-0">
        <Dashboard
          rows={rows}
          dashboard={dashboard}
          onOpenIntervention={openDrawer}
          statutFilter={statutParam}
          nowMs={nowMs}
        />
      </div>

      {/* Section 4 : Liste des interventions */}
      <div className="px-6 pt-5 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <h3 className="text-[11px] font-bold text-ink-muted uppercase tracking-widest dark:text-[#C8C2B8]">
            {statutFilterLabel
              ? <>Interventions — <span className="text-navy dark:text-[#A8C4F2]">{statutFilterLabel}</span> ({filtered.length})</>
              : `Toutes les interventions (${filtered.length})`}
          </h3>
          {statutFilterLabel && (
            <a
              href={techFilter ? `/admin?tech=${techFilter}` : '/admin'}
              className="text-[11px] text-navy underline hover:no-underline dark:text-[#A8C4F2]"
            >
              ✕ Effacer le filtre
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => router.push('/admin')}
            className={
              'px-3 py-1.5 rounded-md text-[12px] font-semibold border ' +
              (!techFilter
                ? 'bg-navy text-white border-navy'
                : 'bg-white text-ink-mid border-sand-border hover:border-navy-mid')
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
                  'px-3 py-1.5 rounded-md text-[12px] font-semibold border ' +
                  (active
                    ? 'bg-[#A17244] text-white border-[#A17244]'
                    : 'bg-white text-ink-mid border-sand-border hover:border-[#A17244]')
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
          className="flex-1 px-3.5 py-2.5 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream cursor-pointer"
        >
          <option value="tous">Tous statuts</option>
          {STATUT_PIPELINE.map((s) => (
            <option key={s} value={s}>{STATUT_INFO[s].label}</option>
          ))}
          <option value="en_suspens">En suspens</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 pt-3 pb-4">
        <div className="bg-cream rounded-xl border border-sand-border overflow-hidden">
          <table className="w-full border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-sand">
                {['Réf.', 'ACP', 'Type', 'Syndic', 'Technicien', 'Créneau', 'Statut', 'Màj'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-ink-muted text-[13px]">
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
                      className={`cursor-pointer border-b border-sand-mid transition-colors ${
                        sel ? 'bg-navy-pale' : 'bg-cream hover:bg-sand-hover'
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
                          <div className="font-mono text-xs font-medium text-navy">{iv.ref ?? '—'}</div>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {iv.priorite === 'urgente' && (
                            <span className="inline-block text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-1.5 py-0.5">
                              ⚡ URGENT
                            </span>
                          )}
                          {iv.source === 'mail' && (
                            <span
                              className="inline-block text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white"
                              style={{ background: '#A17244' }}
                              title="Demande créée automatiquement depuis un mail entrant"
                            >
                              📧 Mail
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-bold text-[13px]">{iv.acp?.nom ?? '—'}</div>
                        <div className="text-[10px] text-ink-muted truncate max-w-[200px]">
                          {[iv.acp?.adresse, iv.acp?.ville].filter(Boolean).join(', ') || '—'}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid whitespace-nowrap">
                        {iv.type ?? '—'}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="text-xs font-semibold">{iv.syndic?.nom ?? '—'}</div>
                        {iv.syndic?.type && <TypeBadge type={iv.syndic.type} className="mt-1" />}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs">
                        {iv.technicien ? (
                          <span>{(iv.technicien.prenom ?? '')[0]}. {iv.technicien.nom}</span>
                        ) : (
                          <span className="text-terra font-semibold text-[11px]">Non assigné</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                        {fmtDate(iv.creneau_debut)}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <Badge statut={iv.statut} />
                        <Pipebar statut={iv.statut} />
                      </td>
                      <td className="px-3.5 py-2.5 text-[10px] text-ink-muted font-mono whitespace-nowrap">
                        {relTime(iv.updated_at, nowMs)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-muted mt-2 px-0.5">
          {filtered.length} intervention(s)
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

      {/* Drawer */}
      {selected && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeDrawer(); }}
          className="fixed inset-0 bg-navy-deep/45 z-50 flex justify-end"
        >
          <div className="w-[460px] bg-cream h-screen overflow-y-auto shadow-2xl border-l border-sand-border flex flex-col">
            <header className="px-5 pt-5 bg-sand border-b border-sand-border">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex gap-2 items-center flex-wrap mb-0.5">
                    <span className="font-mono text-xs text-ink-muted">{selected.ref ?? '—'}</span>
                    {selected.priorite === 'urgente' && (
                      <span className="text-[9px] font-bold text-terra bg-terra-light border border-terra-mid rounded-full px-2 py-0.5">
                        ⚡ URGENT
                      </span>
                    )}
                  </div>
                  <div className="text-base font-extrabold text-ink mt-0.5">{selected.acp?.nom ?? '—'}</div>
                  <div className="text-xs text-ink-mid">
                    {[selected.acp?.adresse, selected.acp?.ville].filter(Boolean).join(', ')}
                  </div>
                </div>
                <button
                  onClick={closeDrawer}
                  className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border"
                >
                  ✕
                </button>
              </div>
              <div className="mt-3"><Pipebar statut={selected.statut} /></div>
              <div className="flex justify-between items-center mt-2 pb-4">
                <Badge statut={selected.statut} big />
                <span className="text-[11px] text-ink-muted font-mono">{relTime(selected.updated_at, nowMs)}</span>
              </div>
            </header>

            <nav className="flex bg-cream px-5 border-b border-sand-border">
              {(['dossier','suivi','documents','ia'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-2.5 px-4 text-xs font-medium capitalize border-b-2 transition-colors ${
                    tab === t ? 'text-navy border-navy font-bold' : 'text-ink-muted border-transparent hover:text-ink-mid'
                  }`}
                >
                  {t === 'ia' ? '✨ Assistant IA' : t}
                </button>
              ))}
            </nav>

            <div className="px-5 py-4 flex-1 overflow-y-auto bg-sand">
              {tab === 'dossier' && (
                <>
                  {/* Stepper + bandeau — seulement pour interventions source='mail' */}
                  {selected.source === 'mail' && (
                    <>
                      <MailStepper steps={[
                        { key: 'infos',    label: 'Infos',         done: Boolean(formDraft.nom_client && formDraft.email && formDraft.telephone), active: selected.statut === 'nouvelle' },
                        { key: 'tech',     label: 'Technicien',    done: Boolean(selected.technicien_id), active: Boolean(formDraft.nom_client) && !selected.technicien_id },
                        { key: 'creneau',  label: 'Créneau',       done: Boolean(selected.creneau_debut), active: Boolean(selected.technicien_id) && !selected.creneau_debut },
                        { key: 'occup',    label: 'Occupants',     done: drawerOccupants.some((o) => o.token_sent_at), active: Boolean(selected.creneau_debut) },
                        { key: 'confirm',  label: 'Confirmation',  done: selected.statut === 'confirmee' || selected.statut === 'realisee' || selected.statut === 'rapport' || selected.statut === 'cloturee', active: selected.statut === 'attente' },
                      ]} />
                      {selected.statut === 'nouvelle' && (
                        <div className="bg-navy-pale border border-navy-light rounded-xl px-3 py-2.5 mb-3 text-[12px] text-navy font-semibold dark:bg-[#1A2540] dark:border-[#2C4878] dark:text-[#A8C4F2]">
                          📧 Demande reçue par mail — à traiter
                        </div>
                      )}
                    </>
                  )}

                  {/* ① Édition rapide des infos */}
                  <Block title={`Infos${selected.demandeur_type === 'particulier' ? ' particulier' : ''}`}>
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
                        <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">Adresse</label>
                        <input
                          value={formDraft.adresse}
                          onChange={(e) => setFormDraft((f) => ({ ...f, adresse: e.target.value }))}
                          placeholder="rue + n°, code postal + ville"
                          className="w-full px-2.5 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid"
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
                            <option value="urgente">⚡ Urgente</option>
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
                          className="bg-navy text-white px-3 py-1.5 rounded text-[12px] font-bold disabled:opacity-50"
                        >
                          {formPending ? '…' : '💾 Sauvegarder'}
                        </button>
                        {formMsg && (
                          <span className={'text-[11px] font-semibold ' + (formMsg.kind === 'ok' ? 'text-ok' : 'text-terra')}>
                            {formMsg.msg}
                          </span>
                        )}
                      </div>
                    </div>
                  </Block>

                  {selected.demandeur_type !== 'particulier' && selected.syndic && (
                    <Block title="Demandeur (syndic)">
                      <div className="font-bold text-[13px]">{selected.syndic.nom}</div>
                      {selected.syndic.type && <TypeBadge type={selected.syndic.type} className="mt-1" />}
                    </Block>
                  )}

                  {/* ② Technicien — dropdown éditable */}
                  <Block title="Technicien">
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
                  <Block title="Créneau">
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
                      className="bg-navy text-white px-3 py-1.5 rounded text-[12px] font-bold disabled:opacity-50"
                    >
                      {schedulePending ? '…' : '📅 Planifier'}
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

                  <Block title={`Appartements / unités (${drawerOccupants.length})`}>
                    {drawerOccupantsLoading ? (
                      <span className="text-ink-muted dark:text-[#C8C2B8]">Chargement…</span>
                    ) : drawerOccupants.length === 0 ? (
                      <span className="text-ink-muted dark:text-[#C8C2B8]">Aucune unité enregistrée.</span>
                    ) : (
                      <div className="space-y-1.5">
                        {drawerOccupants.map((o) => {
                          const confLabel = o.conf === 'confirme' ? '✅ Confirmé'
                            : o.conf === 'decline' ? '❌ Pas d\'accès'
                            : '⏳ En attente';
                          const confColor = o.conf === 'confirme' ? 'text-ok dark:text-[#7AC9A0]'
                            : o.conf === 'decline' ? 'text-terra'
                            : 'text-[#8A5A1A] dark:text-[#E8C896]';
                          return (
                            <div key={o.id} className="bg-white border border-sand-border rounded-md px-2.5 py-2 text-[12px] dark:bg-[#221E1A] dark:border-[#3D3A32]">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-ink dark:text-[#F0ECE4]">
                                  {o.appartement ?? '—'}
                                  {o.etage ? <span className="text-[10px] text-ink-muted dark:text-[#C8C2B8] ml-1.5">· {o.etage}</span> : null}
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
                              {o.instructions && (
                                <div className="text-[11px] text-ink-mid italic mt-1 dark:text-[#C8C2B8]">
                                  {o.instructions}
                                </div>
                              )}
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
                                  className="text-[10px] mt-1.5 bg-[#A17244] text-white px-2 py-1 rounded font-bold hover:opacity-90"
                                >
                                  📱 Envoyer le lien par {o.contact_preference === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Block>

                  {/* ④ Notifier les occupants — multicanal */}
                  {selected.creneau_debut && drawerOccupants.length > 0 && (
                    <Block title="📨 Notifier les occupants">
                      <p className="text-[11px] text-ink-mid mb-2 dark:text-[#C8C2B8]">
                        Envoie un lien de confirmation à chaque occupant via le canal préféré
                        (email / SMS / WhatsApp). Décoche pour exclure.
                      </p>
                      <div className="space-y-1 mb-2">
                        {drawerOccupants.map((o) => {
                          const checked = notifySelectedIds.has(o.id);
                          const pref = o.contact_preference ?? 'email';
                          const icon = pref === 'whatsapp' ? '💬' : pref === 'sms' ? '📱' : pref === 'both' ? '📧📱' : '📧';
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
                                className="w-4 h-4 accent-[#1B3A6B]"
                              />
                              <span className="text-[14px] flex-shrink-0">{icon}</span>
                              <span className="font-bold flex-1 truncate">
                                {[o.prenom, o.nom].filter(Boolean).join(' ') || 'Occupant'}
                                {o.appartement && <span className="text-ink-muted font-normal ml-1.5">· {o.appartement}</span>}
                              </span>
                              {sentAt && (
                                <span className="text-[9px] text-ok font-bold whitespace-nowrap" title={`Envoyé ${new Date(sentAt).toLocaleString('fr-BE')}`}>
                                  ✓ envoyé
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
                        className="bg-navy text-white px-3 py-2 rounded text-[12px] font-bold disabled:opacity-50"
                      >
                        {notifyPending ? '…' : `📤 Envoyer (${notifySelectedIds.size})`}
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
                    <Block title="📤 Confirmation client">
                      <p className="text-[11px] text-ink-mid mb-2 dark:text-[#C8C2B8]">
                        Envoie un récapitulatif (date, heure, adresse, technicien) au demandeur via Gmail.
                      </p>
                      <button
                        type="button"
                        onClick={sendConfirmMail}
                        disabled={confirmMailPending}
                        className="bg-[#1F6B45] text-white px-3 py-2 rounded text-[12px] font-bold disabled:opacity-50"
                      >
                        {confirmMailPending ? 'Envoi…' : '📤 Envoyer confirmation au client'}
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
                      <div className="bg-terra-light border border-terra-mid rounded-lg px-3 py-2 text-[12px] text-terra font-semibold mb-3">
                        ⚠ Aucun technicien assigné
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

                  {(selected.statut === 'rapport' || selected.statut === 'cloturee') && (
                    <Block title="Rapport au syndic">
                      <p className="text-[12px] text-ink-mid mb-2">
                        Renvoie le PDF du rapport à l&apos;email enregistré du syndic.
                      </p>
                      <button
                        onClick={resendRapport}
                        disabled={emailPending}
                        className="w-full bg-[#A17244] text-white py-2.5 rounded-lg text-xs font-bold hover:bg-[#8A613B] disabled:opacity-50"
                      >
                        {emailPending ? 'Envoi…' : '✉ Envoyer le rapport au syndic'}
                      </button>
                      {emailMessage && (
                        <p className={
                          'text-xs mt-2 font-semibold ' +
                          (emailMessage.kind === 'ok' ? 'text-ok' : 'text-terra')
                        }>
                          {emailMessage.msg}
                        </p>
                      )}
                    </Block>
                  )}

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
                            <span>
                              📱 {[o.prenom, o.nom].filter(Boolean).join(' ') || o.appartement}
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
                <DocumentsBlock interventionId={selected.id} />
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

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-cream rounded-xl px-3.5 py-3 border border-sand-border mb-3">
      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-wider mb-2">
        {title}
      </div>
      <div className="text-[13px] text-ink leading-relaxed">{children}</div>
    </div>
  );
}
