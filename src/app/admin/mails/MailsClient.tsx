'use client';

import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  X, Trash2, Star, Bot, ClipboardList, CheckCircle2, Mail, Sparkles,
  Zap, Paperclip, Circle, Tag, Archive, Undo2,
} from 'lucide-react';
import type { MailListItem, MailDetail, GmailLabel } from '@/lib/gmail';
import type { MailAnalyse } from './MailAnalyseTypes';
import { MailAnalyseBadges } from './MailAnalyseBadges';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { MailAnalyseActions } from './MailAnalyseActions';
import {
  MAIL_CLASSIFICATIONS,
  CLASSIFICATION_LABEL_FR,
  toCanonicalClassification,
  type MailClassification,
} from '@/lib/mail/categories';

// Onglets métier (Mails V2 P1) — résolus côté serveur en query Gmail
// (cf. api/admin/mails/route.ts). a_traiter = non lus inbox hors plateforme.
type FilterMode = 'a_traiter' | 'demandes' | 'occupants' | 'tous' | 'archives' | 'system' | 'trash';
type CategoryFilter = MailClassification | 'toutes';
type BulkAction =
  | 'read' | 'unread' | 'archive'
  | 'label' | 'important' | 'trash' | 'restore' | 'delete-permanent';

interface MailAnalysis {
  nom_client: string | null;
  adresse: string | null;
  type_probleme: string | null;
  telephone: string | null;
  email: string | null;
  date_souhaitee: string | null;
  priorite: 'normale' | 'urgente' | null;
  resume: string | null;
}

const HIDDEN_BADGE_LABEL_IDS = new Set([
  'INBOX', 'UNREAD', 'IMPORTANT', 'STARRED', 'SENT', 'DRAFT',
  'SPAM', 'TRASH', 'CHAT',
]);

const LABEL_COLORS: { name: string; text: string; bg: string }[] = [
  { name: 'Aucune', text: '', bg: '' },
  { name: 'Rouge',   text: '#ffffff', bg: '#fb4c2f' },
  { name: 'Orange',  text: '#ffffff', bg: '#ffad47' },
  { name: 'Jaune',   text: '#000000', bg: '#fad165' },
  { name: 'Vert',    text: '#ffffff', bg: '#16a766' },
  { name: 'Bleu',    text: '#ffffff', bg: '#4a86e8' },
  { name: 'Violet',  text: '#ffffff', bg: '#a479e2' },
  { name: 'Rose',    text: '#ffffff', bg: '#f691b3' },
];

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return fmtTime(iso);
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', timeZone: TZ_BRUSSELS });
}

function senderName(from: string): string {
  const m = from.match(/^"?([^"<]+?)"?\s*<.+>$/);
  return (m ? m[1] : from).trim();
}

function senderEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

export function MailsClient({ initialConnected }: { initialConnected: boolean }) {
  const router = useRouter();
  const [mails, setMails] = useState<MailListItem[]>([]);
  const [loading, setLoading] = useState(initialConnected);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Recherche serveur (Mails V2 P1) : la saisie est debouncée 400 ms puis
  // relayée telle quelle à GET /api/admin/mails?search=… qui la combine à
  // la query Gmail de l'onglet actif. Champ vidé → retour au comportement
  // normal de l'onglet (debouncedQuery '').
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);
  const [filter, setFilter] = useState<FilterMode>('a_traiter');
  // Filtre métier par classification canonique (U4). Purement client :
  // croise la Map des analyses (thread_id → MailAnalyse). 'toutes' = pas
  // de filtre. Un mail non analysé est exclu dès qu'une catégorie précise
  // est sélectionnée.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('toutes');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [analysis, setAnalysis] = useState<MailAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);

  // Sélection multiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkLabelMenuOpen, setBulkLabelMenuOpen] = useState(false);

  // Compteur de rafraîchissement — incrémenter force le re-fetch des mails
  // (setFilter avec la même valeur ne re-rend pas, donc inutile).
  const [refreshTick, setRefreshTick] = useState(0);

  // Labels
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(initialConnected);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  // Analyses Claude (T5 → mails_analyses). Map thread_id → MailAnalyse.
  // Chargée en batch après le mount des mails (1 requête pour tous les
  // thread_id visibles) puis rafraîchie ponctuellement après chaque action
  // (analyse-deep, draft-reply, calendar event).
  const [analyses, setAnalyses] = useState<Map<string, MailAnalyse>>(new Map());

  // Modals
  const [createLabelOpen, setCreateLabelOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);

  // Drawer : ajout de label + panel réponse
  const [addLabelMenuOpen, setAddLabelMenuOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);

  // Présélection via ?id=… (liens profonds : File de validation, drawer
  // intervention « mails liés »). Lu une fois au mount — window.location
  // évite le boundary Suspense exigé par useSearchParams.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setSelectedId(id);
  }, []);

  // Charge la liste — déclenché au mount + quand filter/activeLabel/refreshTick changent.
  // `t=Date.now()` casse tout cache navigateur/Vercel/Cloudflare. `cache: 'no-store'`
  // ajoute une ceinture côté fetch.
  useEffect(() => {
    if (!initialConnected) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '50', t: String(Date.now()) });
    // L'onglet est toujours relayé : la résolution en query Gmail est
    // entièrement côté serveur ('tous' = défaut serveur).
    params.set('filter', filter);
    if (activeLabel) params.set('label', activeLabel);
    if (debouncedQuery) params.set('search', debouncedQuery);
    fetch(`/api/admin/mails?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (!data.ok) { setError(data.error ?? 'Erreur'); return; }
        setMails(data.mails ?? []);
        setSelectedIds(new Set());
      })
      .catch((e) => mounted && setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [initialConnected, filter, activeLabel, refreshTick, debouncedQuery]);

  // Charge les analyses Claude pour tous les thread_id visibles. Évite
  // d'attendre le clic d'un mail pour savoir s'il a déjà été analysé
  // (les badges TYPE / URGENT / Dossier sont visibles dans la liste).
  // L'API retourne {} si thread_ids vide → on retombe naturellement
  // sur une Map vide via la même branche d'écriture (pas de setState
  // synchrone dans l'effect en cas de liste vide).
  useEffect(() => {
    let cancelled = false;
    const threadIds = Array.from(new Set(mails.map((m) => m.thread_id).filter(Boolean)));
    const url = `/api/admin/mails/analyses?thread_ids=${encodeURIComponent(threadIds.join(','))}`;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success) return;
        const next = new Map<string, MailAnalyse>();
        for (const [tid, raw] of Object.entries((data.analyses ?? {}) as Record<string, unknown>)) {
          next.set(tid, raw as MailAnalyse);
        }
        setAnalyses(next);
      })
      .catch(() => { /* silent — l'UI fonctionne sans les badges */ });
    return () => { cancelled = true; };
  }, [mails]);

  // Refresh ciblé d'une analyse après une action (analyse-deep, draft-reply,
  // calendar event). Met à jour la Map sans refetch global.
  const refreshAnalyse = async (threadId: string) => {
    try {
      const r = await fetch(`/api/admin/mails/analyses?thread_ids=${encodeURIComponent(threadId)}`, { cache: 'no-store' });
      const data = await r.json();
      if (!data.success) return;
      const fresh = (data.analyses ?? {})[threadId] as MailAnalyse | undefined;
      if (!fresh) return;
      setAnalyses((prev) => {
        const next = new Map(prev);
        next.set(threadId, fresh);
        return next;
      });
    } catch { /* noop */ }
  };

  // Compteur « non lus » harmonisé — même source et même définition que le
  // badge sidebar : /api/admin/mails/unread-count → in:inbox is:unread hors
  // mails système (cf. countUnreadMails, filtrage D1). Rafraîchi au mount,
  // sur ↻ Actualiser et sur l'event foxo:mails-updated (lecture, actions
  // en masse) — comme la Sidebar.
  const [inboxUnread, setInboxUnread] = useState(0);
  useEffect(() => {
    if (!initialConnected) return;
    let cancelled = false;
    const load = () => {
      fetch('/api/admin/mails/unread-count', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => { if (!cancelled && d?.ok) setInboxUnread(d.count ?? 0); })
        .catch((e) => console.warn('[mails] compteur non-lus indisponible', e));
    };
    load();
    window.addEventListener('foxo:mails-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('foxo:mails-updated', load);
    };
  }, [initialConnected, refreshTick]);

  // Charge les labels Gmail
  useEffect(() => {
    if (!initialConnected) return;
    let mounted = true;
    setLabelsLoading(true);
    fetch('/api/admin/mails/labels')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) setLabels(data.labels ?? []);
      })
      .catch((e) => console.warn('[admin/mails] chargement labels Gmail échoué (best-effort)', e))
      .finally(() => { if (mounted) setLabelsLoading(false); });
    return () => { mounted = false; };
  }, [initialConnected]);

  // Charge le détail quand selectedId change.
  // L'API serveur marque le mail comme lu (retire UNREAD côté Gmail).
  useEffect(() => {
    if (!selectedId) { setDetail(null); setAnalysis(null); setReplyOpen(false); return; }
    let mounted = true;
    setDetailLoading(true);
    setAnalysis(null);
    setReplyOpen(false);
    setReplyBody('');
    fetch(`/api/admin/mails/${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) {
          setDetail(data.mail);
          setMails((arr) => arr.map((m) => m.id === selectedId
            ? { ...m, unread: false, label_ids: m.label_ids.filter((l) => l !== 'UNREAD') }
            : m));
          window.dispatchEvent(new Event('foxo:mails-updated'));
        } else {
          setError(data.error ?? 'Erreur détail');
        }
      })
      .catch((e) => mounted && setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => { if (mounted) setDetailLoading(false); });
    return () => { mounted = false; };
  }, [selectedId]);

  // La recherche texte est désormais serveur (query Gmail) — seul le
  // filtre catégorie reste client (croisement avec la Map analyses).
  const filtered = useMemo(() => {
    return mails.filter((m) => {
      if (categoryFilter !== 'toutes') {
        const analyse = analyses.get(m.thread_id);
        // Pas d'analyse → pas de classification → exclu du filtre métier.
        if (!analyse) return false;
        const cat = toCanonicalClassification(analyse.classification ?? analyse.type);
        if (cat !== categoryFilter) return false;
      }
      return true;
    });
  }, [mails, categoryFilter, analyses]);

  const labelById = useMemo(() => {
    const m = new Map<string, GmailLabel>();
    for (const l of labels) m.set(l.id, l);
    return m;
  }, [labels]);

  function userBadgesForMail(mail: { label_ids: string[] }): GmailLabel[] {
    return mail.label_ids
      .filter((id) => !HIDDEN_BADGE_LABEL_IDS.has(id))
      .map((id) => labelById.get(id))
      .filter((l): l is GmailLabel => Boolean(l));
  }

  function toggleSelect(id: string) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selectedIds.has(m.id));
  function toggleSelectAll() {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (allFilteredSelected) {
        for (const m of filtered) next.delete(m.id);
      } else {
        for (const m of filtered) next.add(m.id);
      }
      return next;
    });
  }

  async function applyBulkAction(action: BulkAction, labelId?: string) {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkLoading(true);
    setFeedback(null);
    setBulkLabelMenuOpen(false);
    try {
      const r = await fetch('/api/admin/mails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, labelId }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Action en masse échouée.' });
        return;
      }
      // Notifie la Sidebar — re-fetch debounced (cf. components/Sidebar.tsx).
      window.dispatchEvent(new Event('foxo:mails-updated'));
      // Update optimiste
      setMails((arr) => {
        if (action === 'archive' || action === 'trash' || action === 'delete-permanent') {
          // Le mail disparaît de la vue actuelle
          return arr.filter((m) => !selectedIds.has(m.id));
        }
        if (action === 'restore') {
          // En vue trash : le mail disparaît puisqu'il quitte la corbeille
          return arr.filter((m) => !selectedIds.has(m.id));
        }
        if (action === 'read') {
          return arr.map((m) => selectedIds.has(m.id)
            ? { ...m, unread: false, label_ids: m.label_ids.filter((l) => l !== 'UNREAD') }
            : m);
        }
        if (action === 'unread') {
          return arr.map((m) => selectedIds.has(m.id)
            ? { ...m, unread: true, label_ids: m.label_ids.includes('UNREAD') ? m.label_ids : [...m.label_ids, 'UNREAD'] }
            : m);
        }
        if (action === 'important') {
          return arr.map((m) => selectedIds.has(m.id)
            ? { ...m, label_ids: m.label_ids.includes('IMPORTANT') ? m.label_ids : [...m.label_ids, 'IMPORTANT'] }
            : m);
        }
        if (action === 'label' && labelId) {
          return arr.map((m) => selectedIds.has(m.id)
            ? { ...m, label_ids: m.label_ids.includes(labelId) ? m.label_ids : [...m.label_ids, labelId] }
            : m);
        }
        return arr;
      });
      setSelectedIds(new Set());
      const labelMap: Record<BulkAction, string> = {
        read: 'marqué(s) comme lu',
        unread: 'marqué(s) comme non lu',
        archive: 'archivé(s)',
        label: 'libellé appliqué',
        important: 'marqué(s) important',
        trash: 'envoyé(s) à la corbeille',
        restore: 'restauré(s)',
        'delete-permanent': 'supprimé(s) définitivement',
      };
      setFeedback({ kind: 'ok', msg: `${ids.length} mail(s) — ${labelMap[action]}` });
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setBulkLoading(false);
    }
  }

  async function analyzeMail() {
    if (!detail) return;
    setAnalysis(null);
    setAnalysisLoading(true);
    setFeedback(null);
    try {
      const r = await fetch(`/api/admin/mails/${detail.id}/analyze`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Analyse échouée.' });
      } else {
        setAnalysis(data.analysis);
      }
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function modifyLabelOnDetail(args: { addId?: string; removeId?: string }) {
    if (!detail) return;
    setFeedback(null);
    try {
      const r = await fetch(`/api/admin/mails/${detail.id}/labels`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addLabelIds: args.addId ? [args.addId] : undefined,
          removeLabelIds: args.removeId ? [args.removeId] : undefined,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec mise à jour libellé.' });
        return;
      }
      setDetail((d) => {
        if (!d) return d;
        let next = d.label_ids.slice();
        if (args.addId && !next.includes(args.addId)) next = [...next, args.addId];
        if (args.removeId) next = next.filter((id) => id !== args.removeId);
        return { ...d, label_ids: next };
      });
      setMails((arr) => arr.map((m) => {
        if (m.id !== detail.id) return m;
        let next = m.label_ids.slice();
        if (args.addId && !next.includes(args.addId)) next = [...next, args.addId];
        if (args.removeId) next = next.filter((id) => id !== args.removeId);
        return { ...m, label_ids: next };
      }));
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    }
  }

  async function refreshLabels() {
    try {
      const r = await fetch('/api/admin/mails/labels');
      const data = await r.json();
      if (data.ok) setLabels(data.labels ?? []);
    } catch { /* noop */ }
  }

  async function sendReply() {
    if (!detail || !replyBody.trim()) return;
    setReplyLoading(true);
    setFeedback(null);
    try {
      const r = await fetch(`/api/admin/mails/${detail.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec envoi.' });
        return;
      }
      setFeedback({ kind: 'ok', msg: 'Réponse envoyée' });
      setReplyBody('');
      setReplyOpen(false);
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setReplyLoading(false);
    }
  }

  async function deletePermanentConfirmed(ids: string[]) {
    setBulkLoading(true);
    setFeedback(null);
    try {
      const r = await fetch('/api/admin/mails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'delete-permanent' }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec suppression.' });
        return;
      }
      window.dispatchEvent(new Event('foxo:mails-updated'));
      setMails((arr) => arr.filter((m) => !ids.includes(m.id)));
      setSelectedIds(new Set());
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
      setFeedback({ kind: 'ok', msg: `${ids.length} mail(s) supprimé(s) définitivement` });
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setBulkLoading(false);
      setConfirmDelete(null);
    }
  }

  function createIntervention() {
    if (!detail) return;
    if (analysis) {
      try {
        sessionStorage.setItem('foxo_mail_prefill', JSON.stringify({
          source_mail_id: detail.id,
          analysis,
        }));
      } catch { /* noop */ }
    }
    router.push('/admin/planning');
  }

  if (!initialConnected) return null;

  const inTrash = filter === 'trash';

  return (
    <div className="h-full flex">
      {createLabelOpen && (
        <CreateLabelModal
          onClose={() => setCreateLabelOpen(false)}
          onCreated={async () => {
            setCreateLabelOpen(false);
            await refreshLabels();
            setFeedback({ kind: 'ok', msg: 'Libellé créé' });
          }}
          onError={(msg) => setFeedback({ kind: 'err', msg })}
        />
      )}

      {confirmDelete && (
        <ConfirmDeleteModal
          count={confirmDelete.ids.length}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deletePermanentConfirmed(confirmDelete.ids)}
          pending={bulkLoading}
        />
      )}

      {/* Liste à gauche — position relative pour ancrer la BulkActionBar
          en absolute bottom (la chaîne min-h-screen → flex-1 → h-full ne
          garantit pas une hauteur bornée, donc on ne peut pas se reposer
          sur flex-shrink-0 pour épingler la barre au bas de l'aside).
          Largeur ~40% bornée : la lecture occupe ~60%, la liste ne flotte
          plus seule sur les grands écrans. */}
      <aside
        className={
          'relative flex flex-col w-full sm:w-[40%] sm:min-w-[340px] sm:max-w-[520px] border-r border-sand-border bg-cream ' +
          (selectedId ? 'hidden sm:flex' : 'flex')
        }
      >
        {/* Filtres + Recherche */}
        <div className="p-3 border-b border-sand-border space-y-2 flex-shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher — expéditeur, sujet…"
            className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          />
          {/* Onglets métier (Mails V2 P1) — chips compactes, passage sur
              2 lignes accepté sur mobile. Compteur non-lus sur « À traiter »
              uniquement (inboxUnread déjà chargé, aucun compteur ajouté). */}
          <div className="flex flex-wrap gap-1.5">
            {([
              ['a_traiter', 'À traiter', null],
              ['demandes', 'Demandes', null],
              ['occupants', 'Occupants', null],
              ['tous', 'Tous', null],
              ['archives', 'Archivés', Archive],
              ['system', 'Système', null],
              ['trash', 'Corbeille', Trash2],
            ] as [FilterMode, string, typeof Trash2 | null][]).map(([f, label, Icon]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={
                  'px-2 py-1.5 rounded text-[11px] font-bold border inline-flex items-center justify-center gap-1 ' +
                  (filter === f
                    ? 'bg-navy text-white border-navy'
                    : 'bg-white text-ink-mid border-sand-border')
                }
              >
                {Icon && <Icon size={12} />}
                {label}
                {f === 'a_traiter' && inboxUnread > 0 && (
                  <span
                    className={
                      'text-[9px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ' +
                      (filter === f ? 'bg-white/25 text-white' : 'bg-terra-light text-terra')
                    }
                  >
                    {inboxUnread}
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Filtre par catégorie métier (classification canonique U4). */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
            aria-label="Filtrer par catégorie"
            className={
              'w-full px-2 py-1.5 rounded text-[11px] font-bold border outline-none focus:border-navy-mid ' +
              (categoryFilter !== 'toutes'
                ? 'bg-navy text-white border-navy'
                : 'bg-white text-ink-mid border-sand-border')
            }
          >
            <option value="toutes">Toutes les catégories</option>
            {MAIL_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {CLASSIFICATION_LABEL_FR[c]}
              </option>
            ))}
          </select>
          <button
            ref={refreshRef}
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            className="w-full text-[11px] text-ink-muted hover:text-navy underline"
            disabled={loading}
          >
            {loading ? 'Chargement…' : '↻ Actualiser'}
          </button>
        </div>

        {/* Barre d'actions — sticky top-0 quand mails sélectionnés.
            Placée juste après les filtres pour rester visible en haut
            de l'aside, indépendamment du scroll de la liste. */}
        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            inTrash={inTrash}
            disabled={bulkLoading}
            labels={labels}
            menuOpen={bulkLabelMenuOpen}
            setMenuOpen={setBulkLabelMenuOpen}
            onAction={applyBulkAction}
            onClear={() => setSelectedIds(new Set())}
            onRequestPermanentDelete={() => setConfirmDelete({ ids: Array.from(selectedIds) })}
          />
        )}

        {/* Section Libellés */}
        <div className="p-3 border-b border-sand-border flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">
              Libellés{inboxUnread > 0 ? ` · ${inboxUnread} non lus` : ''}
            </span>
            <button
              type="button"
              onClick={() => setCreateLabelOpen(true)}
              className="text-[10px] font-bold text-navy hover:underline"
            >
              + Nouveau libellé
            </button>
          </div>

          {activeLabel && (
            <button
              type="button"
              onClick={() => setActiveLabel(null)}
              className="w-full text-left mb-1.5 text-[11px] bg-amber-light border border-[#E8C896] rounded px-2 py-1 text-[#8A5A1A] font-semibold inline-flex items-center gap-1.5"
            >
              <X size={12} />
              Filtre actif : {activeLabel}
            </button>
          )}

          {labelsLoading ? (
            <div className="space-y-2 py-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ) : labels.length === 0 ? (
            <div className="text-[11px] text-ink-muted italic">
              Aucun libellé personnalisé.
            </div>
          ) : (
            // ~10 libellés visibles (~26px/ligne) avant de scroller.
            <ul className="space-y-0.5 max-h-[260px] overflow-y-auto">
              {labels.map((l) => {
                const active = activeLabel === l.name;
                const swatch = l.color ?? null;
                return (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => setActiveLabel(active ? null : l.name)}
                      className={
                        'w-full flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors text-left ' +
                        (active
                          ? 'bg-navy text-white'
                          : 'hover:bg-sand-hover text-ink')
                      }
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-black/10"
                        style={swatch ? { background: swatch.background_color } : { background: '#A17244' }}
                      />
                      <span className="font-semibold truncate flex-1">{l.name}</span>
                      {l.messages_unread > 0 && (
                        <span className={
                          'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' +
                          (active ? 'bg-white/25 text-white' : 'bg-terra-light text-terra')
                        }>
                          {l.messages_unread}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Header sélection */}
        {filtered.length > 0 && (
          <div className="px-3 py-2 border-b border-sand-border bg-sand flex items-center gap-2 flex-shrink-0">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              aria-label="Tout sélectionner"
              className="w-4 h-4 accent-[#1B3A6B] cursor-pointer"
            />
            <span className="text-[11px] text-ink-muted">
              {selectedIds.size > 0
                ? `${selectedIds.size} sélectionné(s)`
                : `${filtered.length} affiché(s)${inTrash ? ' (corbeille)' : ''}`}
            </span>
          </div>
        )}

        {/* Liste — `min-h-0` permet le shrink en flex-col. */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {error && (
            <div className="m-3 text-[12px] bg-terra-light border border-terra-mid text-terra rounded-md px-3 py-2 font-semibold">
              {error}
            </div>
          )}
          {loading && !error && (
            <div className="px-3 py-2 space-y-px">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="py-2.5 border-b border-sand-border/60 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-14 ml-auto" />
                  </div>
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))}
            </div>
          )}
          {filtered.length === 0 && !loading && !error && (
            <div className="text-[13px] text-ink-muted text-center py-12">
              {inTrash ? 'Corbeille vide.' : 'Aucun mail.'}
            </div>
          )}
          {!loading && filtered.map((m) => {
            const active = selectedId === m.id;
            const checked = selectedIds.has(m.id);
            const badges = userBadgesForMail(m);
            const isImportant = m.label_ids.includes('IMPORTANT');
            const analyse = analyses.get(m.thread_id) ?? null;
            return (
              <div
                key={m.id}
                className={
                  'relative group flex items-start gap-2 px-3 py-2.5 border-b border-sand-mid hover:bg-sand-hover transition-colors ' +
                  (active ? 'bg-navy-pale' : '')
                }
              >
                {/* Actions rapides au survol (desktop) — superposées en
                    haut à droite sur fond sand pour ne pas chevaucher
                    l'heure/les badges. Mobile (<sm) : rien, le tap ouvre
                    le mail comme avant. */}
                <div className="absolute right-2 top-1.5 z-10 hidden sm:group-hover:flex items-center gap-0.5 bg-sand-hover border border-sand-border rounded-md px-0.5 py-0.5">
                  {inTrash ? (
                    <RowQuickBtn
                      title="Restaurer"
                      disabled={bulkLoading}
                      onClick={() => applyBulkActionForOne(m.id, 'restore')}
                    ><Undo2 size={14} /></RowQuickBtn>
                  ) : (
                    <>
                      <RowQuickBtn
                        title="Archiver"
                        disabled={bulkLoading}
                        onClick={() => applyBulkActionForOne(m.id, 'archive')}
                      ><Archive size={14} /></RowQuickBtn>
                      <RowQuickBtn
                        title={m.unread ? 'Marquer comme lu' : 'Marquer comme non lu'}
                        disabled={bulkLoading}
                        onClick={() => applyBulkActionForOne(m.id, m.unread ? 'read' : 'unread')}
                      >{m.unread ? <CheckCircle2 size={14} /> : <Circle size={14} />}</RowQuickBtn>
                      <RowQuickBtn
                        title="Marquer important"
                        disabled={bulkLoading || isImportant}
                        onClick={() => applyBulkActionForOne(m.id, 'important')}
                      ><Star size={14} /></RowQuickBtn>
                    </>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSelect(m.id)}
                  aria-label={`Sélectionner mail de ${senderName(m.from)}`}
                  className="w-4 h-4 mt-1 accent-[#1B3A6B] cursor-pointer flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    {m.unread && (
                      <span className="w-2 h-2 rounded-full bg-terra flex-shrink-0" aria-label="Non lu" />
                    )}
                    {isImportant && (
                      <span className="flex-shrink-0 text-[#D4A547]" title="Marqué important" aria-label="Important">
                        <Star size={12} fill="currentColor" />
                      </span>
                    )}
                    <div className={'text-[12px] font-bold truncate flex-1 ' + (active ? 'text-navy dark:text-white' : 'text-ink')}>
                      {senderName(m.from)}
                    </div>
                    <span className="text-[10px] text-ink-muted whitespace-nowrap">
                      {fmtDate(m.date)}
                    </span>
                  </div>
                  <div className={'text-[12px] truncate ' + (m.unread ? 'font-semibold text-ink' : 'text-ink-mid')}>
                    {m.subject}
                  </div>
                  {badges.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {badges.map((l) => (
                        <LabelBadge key={l.id} label={l} small />
                      ))}
                    </div>
                  )}
                  {analyse && (
                    <div className="mt-1.5">
                      <MailAnalyseBadges analyse={analyse} />
                    </div>
                  )}
                  <div className="text-[11px] text-ink-muted truncate mt-0.5">
                    {m.snippet}
                  </div>
                </button>
              </div>
            );
          })}
        </div>

      </aside>

      {/* Détail à droite (drawer sur mobile) */}
      <main
        className={
          'flex-1 bg-sand overflow-y-auto ' +
          (selectedId ? 'flex' : 'hidden sm:flex') + ' flex-col'
        }
      >
        {!selectedId && (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3 bg-cream border border-sand-border rounded-xl px-10 py-8 text-center">
              <Mail size={28} className="text-ink-muted" aria-hidden />
              <div className="text-[13px] font-bold text-ink-mid">
                Sélectionne un mail pour le lire
              </div>
              <div className="text-[11px] text-ink-muted">
                Le contenu, les libellés et les actions s&apos;affichent ici.
              </div>
            </div>
          </div>
        )}

        {selectedId && (
          <>
            <header className="px-4 py-3 border-b border-sand-border bg-cream flex items-start justify-between gap-3 flex-shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="sm:hidden text-[12px] text-navy underline"
                  >
                    ← Retour
                  </button>
                  <h2 className="fxs-block-title text-ink truncate">
                    {detail?.subject ?? '…'}
                  </h2>
                </div>
                {detail && (
                  <div className="text-[11px] text-ink-muted mt-1">
                    <span className="font-semibold">{senderName(detail.from)}</span>
                    <span className="ml-1 font-mono text-[10px]">&lt;{senderEmail(detail.from)}&gt;</span>
                    <span className="mx-1.5">·</span>
                    {new Date(detail.date).toLocaleString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS })}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="hidden sm:inline-flex bg-sand-mid w-8 h-8 rounded-md text-ink-mid items-center justify-center dark:bg-[rgba(255,255,255,.06)]"
                aria-label="Fermer"
              ><X size={16} /></button>
            </header>

            <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-sand-border bg-sand flex-shrink-0">
              <button
                type="button"
                onClick={() => setReplyOpen((v) => !v)}
                disabled={!detail}
                className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px]"
              >
                ↩ Répondre
              </button>
              <button
                type="button"
                onClick={analyzeMail}
                disabled={analysisLoading || !detail}
                className="bg-white text-navy border border-navy px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
              >
                <Bot size={14} />
                {analysisLoading ? 'Analyse…' : 'Analyser avec IA'}
              </button>
              <button
                type="button"
                onClick={createIntervention}
                disabled={!detail}
                className="bg-[#1F6B45] text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
              >
                <ClipboardList size={14} />
                Créer une intervention
              </button>
              <button
                type="button"
                onClick={() => detail && applyBulkActionForOne(detail.id, 'archive')}
                disabled={bulkLoading || !detail}
                className="bg-[#A17244] text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
              >
                <Archive size={14} />
                Archiver
              </button>
              {/* Actions trash spécifiques au mail courant */}
              {inTrash && detail && (
                <>
                  <button
                    type="button"
                    onClick={() => applyBulkActionForOne(detail.id, 'restore')}
                    disabled={bulkLoading}
                    className="bg-sand-mid text-ink-mid border border-sand-border px-3 py-2 rounded-lg text-[12px] font-bold dark:bg-[rgba(255,255,255,.06)] min-h-[44px]"
                  >
                    ↺ Restaurer
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete({ ids: [detail.id] })}
                    disabled={bulkLoading}
                    className="bg-terra-light text-terra border border-terra-mid px-3 py-2 rounded-lg text-[12px] font-bold min-h-[44px] inline-flex items-center gap-1.5"
                  >
                    <Trash2 size={14} />
                    Supprimer définitivement
                  </button>
                </>
              )}
              {detail && (
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${detail.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-sand-mid text-ink-mid px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center min-h-[44px] dark:bg-[rgba(255,255,255,.06)]"
                >
                  ↗ Voir dans Gmail
                </a>
              )}
            </div>

            {feedback && (
              <div
                className={
                  'mx-4 mt-3 px-3 py-2 text-[12px] font-semibold border rounded-md ' +
                  (feedback.kind === 'ok'
                    ? 'bg-ok-light border-ok-mid text-ok dark:text-white'
                    : 'bg-terra-light border-terra-mid text-terra')
                }
              >
                {feedback.msg}
              </div>
            )}

            {/* Sprint Mails enrichis : actions 1-clic sur l'analyse Claude
                approfondie (T5/T6). Bouton 'Analyser approfondi' si pas
                encore analysé, sinon 3 actions (brouillon syndic / confirmer
                occupant / event Calendar) + accordion détail. Coexiste
                avec les boutons legacy ('Analyser avec IA' simple, 'Créer
                une intervention') ci-dessus pour ne pas casser le flow
                actuel. */}
            {detail && (
              <MailAnalyseActions
                threadId={detail.thread_id}
                analyse={analyses.get(detail.thread_id) ?? null}
                onAnalyseRefresh={refreshAnalyse}
              />
            )}

            {/* Panel "Répondre" */}
            {replyOpen && detail && (
              <div className="mx-4 mt-3 bg-cream border border-navy rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-1">
                  Réponse à <span className="font-mono">{senderEmail(detail.from)}</span>
                </div>
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={6}
                  placeholder="Écris ta réponse ici. Le sujet et le threading sont gérés automatiquement."
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => { setReplyOpen(false); setReplyBody(''); }}
                    disabled={replyLoading}
                    className="px-3 py-2 rounded-lg text-[12px] font-bold border border-sand-border bg-white text-ink-mid"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={sendReply}
                    disabled={replyLoading || !replyBody.trim()}
                    className="px-3 py-2 rounded-lg text-[12px] font-bold bg-navy text-white disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {replyLoading ? 'Envoi…' : (<><Mail size={14} />Envoyer</>)}
                  </button>
                </div>
              </div>
            )}

            {/* Section Libellés du mail */}
            {detail && (
              <div className="mx-4 mt-3 bg-cream border border-sand-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                    Libellés
                  </span>
                  <button
                    type="button"
                    onClick={() => setAddLabelMenuOpen((v) => !v)}
                    className="text-[11px] font-bold text-navy hover:underline inline-flex items-center gap-1"
                    aria-expanded={addLabelMenuOpen}
                  >
                    {addLabelMenuOpen ? (<><X size={12} />Annuler</>) : '+ Libellé'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {userBadgesForMail(detail).length === 0 && !addLabelMenuOpen && (
                    <span className="text-[11px] text-ink-muted italic">
                      Aucun libellé sur ce mail.
                    </span>
                  )}
                  {userBadgesForMail(detail).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => modifyLabelOnDetail({ removeId: l.id })}
                      title="Cliquer pour retirer ce libellé"
                      className="group inline-flex items-center"
                    >
                      <LabelBadge label={l} removable />
                    </button>
                  ))}
                </div>

                {addLabelMenuOpen && (
                  <div className="mt-2 pt-2 border-t border-sand-border">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
                      Choisir un libellé à ajouter
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
                      {labels
                        .filter((l) => !detail.label_ids.includes(l.id))
                        .map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => {
                              modifyLabelOnDetail({ addId: l.id });
                              setAddLabelMenuOpen(false);
                            }}
                          >
                            <LabelBadge label={l} />
                          </button>
                        ))}
                      {labels.filter((l) => !detail.label_ids.includes(l.id)).length === 0 && (
                        <span className="text-[11px] text-ink-muted italic">
                          Tous les libellés sont déjà appliqués.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {analysis && (
              <div className="mx-4 mt-3 bg-cream border border-sand-border rounded-xl p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2 inline-flex items-center gap-1.5">
                  <Sparkles size={12} />
                  Analyse IA
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  <AnalysisRow label="Client" value={analysis.nom_client} />
                  <AnalysisRow label="Téléphone" value={analysis.telephone} mono />
                  <AnalysisRow label="Email" value={analysis.email} mono />
                  <AnalysisRow label="Type" value={analysis.type_probleme} />
                  <AnalysisRow label="Priorité" value={analysis.priorite ? (analysis.priorite === 'urgente' ? (<span className="inline-flex items-center gap-1"><Zap size={12} />Urgente</span>) : 'Normale') : null} />
                  <AnalysisRow label="Date souhaitée" value={analysis.date_souhaitee} />
                  <div className="sm:col-span-2">
                    <AnalysisRow label="Adresse" value={analysis.adresse} />
                  </div>
                  <div className="sm:col-span-2">
                    <AnalysisRow label="Résumé" value={analysis.resume} />
                  </div>
                </dl>
              </div>
            )}

            <div className="flex-1 px-4 py-4">
              {detailLoading && (
                <div className="bg-cream border border-sand-border rounded-xl p-4 max-w-[800px] space-y-2.5">
                  <Skeleton className="h-4 w-2/5" />
                  <SkeletonText lines={5} className="pt-2" />
                </div>
              )}
              {!detailLoading && detail && (
                <div className="bg-cream border border-sand-border rounded-xl p-4 max-w-[800px]">
                  {detail.body_html ? (
                    <div
                      className="text-[13px] text-ink"
                      style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                      dangerouslySetInnerHTML={{ __html: detail.body_html }}
                    />
                  ) : (
                    <pre className="text-[13px] text-ink whitespace-pre-wrap font-sans">
                      {detail.body_text || detail.snippet}
                    </pre>
                  )}
                  {detail.attachments.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-sand-border">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-1.5">
                        Pièces jointes
                      </div>
                      <ul className="text-[12px] text-ink-mid space-y-1">
                        {detail.attachments.map((a, i) => (
                          <li key={i} className="font-mono inline-flex items-center gap-1.5 w-full">
                            <Paperclip size={12} />
                            {a.filename} <span className="text-ink-muted">· {Math.round(a.size / 1024)} KB</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );

  // Helper local pour appliquer une action sur 1 seul mail (survol de
  // ligne ou volet de lecture) sans toucher la sélection en masse.
  // Update optimiste aligné sur applyBulkAction : archive/trash/restore
  // font quitter la vue courante (et ferment le volet si ouvert) ;
  // lu/non-lu/important mettent à jour la ligne ET le détail en place.
  async function applyBulkActionForOne(id: string, action: BulkAction) {
    setBulkLoading(true);
    setFeedback(null);
    try {
      const r = await fetch('/api/admin/mails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id], action }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Action échouée.' });
        return;
      }
      if (action === 'archive' || action === 'trash' || action === 'restore' || action === 'delete-permanent') {
        setMails((arr) => arr.filter((m) => m.id !== id));
        if (selectedId === id) setSelectedId(null);
      } else if (action === 'read' || action === 'unread') {
        const unread = action === 'unread';
        const patchLabels = (ids: string[]) => unread
          ? (ids.includes('UNREAD') ? ids : [...ids, 'UNREAD'])
          : ids.filter((l) => l !== 'UNREAD');
        setMails((arr) => arr.map((m) => m.id === id
          ? { ...m, unread, label_ids: patchLabels(m.label_ids) }
          : m));
        setDetail((d) => d && d.id === id ? { ...d, label_ids: patchLabels(d.label_ids) } : d);
      } else if (action === 'important') {
        const patchLabels = (ids: string[]) => ids.includes('IMPORTANT') ? ids : [...ids, 'IMPORTANT'];
        setMails((arr) => arr.map((m) => m.id === id ? { ...m, label_ids: patchLabels(m.label_ids) } : m));
        setDetail((d) => d && d.id === id ? { ...d, label_ids: patchLabels(d.label_ids) } : d);
      }
      window.dispatchEvent(new Event('foxo:mails-updated'));
      const oneActionMsg: Record<BulkAction, string> = {
        read: 'Marqué comme lu',
        unread: 'Marqué comme non lu',
        archive: 'Mail archivé',
        label: 'Libellé appliqué',
        important: 'Marqué important',
        trash: 'Mail envoyé à la corbeille',
        restore: 'Mail restauré',
        'delete-permanent': 'Mail supprimé définitivement',
      };
      setFeedback({ kind: 'ok', msg: oneActionMsg[action] });
    } finally {
      setBulkLoading(false);
    }
  }
}

function BulkActionBar({
  count, inTrash, disabled, labels, menuOpen, setMenuOpen,
  onAction, onClear, onRequestPermanentDelete,
}: {
  count: number;
  inTrash: boolean;
  disabled: boolean;
  labels: GmailLabel[];
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  onAction: (action: BulkAction, labelId?: string) => void;
  onClear: () => void;
  onRequestPermanentDelete: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-sand-border px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-navy">
          {count} sélectionné(s)
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] text-ink-muted hover:text-terra inline-flex items-center gap-1"
          title="Désélectionner tout"
        >
          <X size={12} />
          Désélectionner
        </button>
      </div>

      {inTrash ? (
        <div className="grid grid-cols-2 gap-1.5">
          <BulkBtn onClick={() => onAction('restore')} disabled={disabled} color="navy">
            ↺ Restaurer
          </BulkBtn>
          <BulkBtn onClick={onRequestPermanentDelete} disabled={disabled} color="terra">
            <Trash2 size={14} />
            Supprimer
          </BulkBtn>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <BulkBtn onClick={() => onAction('read')} disabled={disabled} color="navy">
              <CheckCircle2 size={14} />
              Lu
            </BulkBtn>
            <BulkBtn onClick={() => onAction('unread')} disabled={disabled} color="navy-outline">
              <Circle size={14} />
              Non lu
            </BulkBtn>
            <BulkBtn onClick={() => onAction('important')} disabled={disabled} color="amber">
              <Star size={14} />
              Important
            </BulkBtn>
            <BulkBtn onClick={() => setMenuOpen(!menuOpen)} disabled={disabled || labels.length === 0} color="muted">
              <Tag size={14} />
              Libellé
            </BulkBtn>
            <BulkBtn onClick={() => onAction('archive')} disabled={disabled} color="muted">
              <Archive size={14} />
              Archiver
            </BulkBtn>
            <BulkBtn onClick={() => onAction('trash')} disabled={disabled} color="terra-soft">
              <Trash2 size={14} />
              Corbeille
            </BulkBtn>
          </div>

          {menuOpen && (
            <div className="absolute top-full left-3 right-3 mt-2 bg-cream border border-sand-border rounded-card p-2 shadow-raised max-h-[220px] overflow-y-auto z-20">
              <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
                Appliquer un libellé
              </div>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => onAction('label', l.id)}
                  >
                    <LabelBadge label={l} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BulkBtn({
  onClick, disabled, color, children,
}: {
  onClick: () => void;
  disabled: boolean;
  color: 'navy' | 'navy-outline' | 'amber' | 'muted' | 'terra' | 'terra-soft';
  children: React.ReactNode;
}) {
  const className = {
    'navy': 'bg-navy text-white border border-navy',
    'navy-outline': 'bg-white text-navy border border-navy',
    'amber': 'bg-amber-light text-[#8A5A1A] border border-[#E8C896]',
    'muted': 'bg-sand-mid text-ink-mid border border-sand-border dark:bg-[rgba(255,255,255,.06)]',
    'terra': 'bg-terra text-white border border-terra',
    'terra-soft': 'bg-terra-light text-terra border border-terra-mid',
  }[color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={'px-2 py-2 rounded-lg text-[11px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[40px] inline-flex items-center justify-center gap-1.5 ' + className}
    >
      {children}
    </button>
  );
}

// Bouton icône discret des actions rapides au survol d'une ligne.
// stopPropagation : l'action ne doit jamais ouvrir le mail.
function RowQuickBtn({
  title, disabled, onClick, children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="p-1.5 rounded text-ink-mid hover:text-navy hover:bg-sand-mid disabled:opacity-40 inline-flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function LabelBadge({ label, small, removable }: { label: GmailLabel; small?: boolean; removable?: boolean }) {
  const bg = label.color?.background_color ?? '#A17244';
  const fg = label.color?.text_color ?? '#ffffff';
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded font-semibold border border-black/10 ' +
        (small ? 'text-[9px] px-1.5 py-0.5' : 'text-[11px] px-2 py-1')
      }
      style={{ background: bg, color: fg }}
    >
      {label.name}
      {removable && <span aria-hidden className="opacity-70 group-hover:opacity-100">×</span>}
    </span>
  );
}

function CreateLabelModal({
  onClose, onCreated, onError,
}: {
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [colorIdx, setColorIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const c = LABEL_COLORS[colorIdx];
      const r = await fetch('/api/admin/mails/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          textColor: c.text || undefined,
          backgroundColor: c.bg || undefined,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        onError(data.error ?? 'Création échouée.');
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
    >
      <div className="bg-cream border border-sand-border rounded-2xl p-5 w-full max-w-[420px]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="fxs-block-title text-ink">
            Nouveau libellé Gmail
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid dark:bg-[rgba(255,255,255,.06)] inline-flex items-center justify-center"
            aria-label="Fermer"
          ><X size={16} /></button>
        </div>

        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1">
          Nom du libellé
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex : Devis en cours"
          className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          autoFocus
        />

        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5">
            Couleur
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LABEL_COLORS.map((c, i) => {
              const active = colorIdx === i;
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setColorIdx(i)}
                  aria-label={c.name}
                  className={
                    'w-9 h-9 rounded-lg border-2 flex items-center justify-center text-[10px] font-bold ' +
                    (active ? 'border-navy ring-2 ring-navy/30' : 'border-sand-border')
                  }
                  style={c.bg ? { background: c.bg, color: c.text } : { background: 'white', color: '#666' }}
                >
                  {!c.bg && '—'}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 rounded-lg text-[12px] font-bold border border-sand-border bg-white text-ink-mid"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-3 py-2 rounded-lg text-[12px] font-bold bg-navy text-white disabled:opacity-50"
          >
            {submitting ? 'Création…' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({
  count, onCancel, onConfirm, pending,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onCancel(); }}
      className="fixed inset-0 bg-navy-deep/50 z-50 flex items-center justify-center p-4"
    >
      <div className="bg-cream border border-terra rounded-2xl p-5 w-full max-w-[420px]">
        <h2 className="fxs-block-title text-terra mb-2 inline-flex items-center gap-1.5">
          <Trash2 size={14} />
          Supprimer définitivement
        </h2>
        <p className="text-[12px] text-ink-mid leading-relaxed">
          Tu vas supprimer définitivement <strong>{count} mail{count > 1 ? 's' : ''}</strong>.
          Cette action est <strong className="text-terra">irréversible</strong> — les mails ne seront pas récupérables même depuis la corbeille Gmail.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-[12px] font-bold border border-sand-border bg-white text-ink-mid"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="px-3 py-2 rounded-lg text-[12px] font-bold bg-terra text-white disabled:opacity-50"
          >
            {pending ? 'Suppression…' : 'Supprimer définitivement'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalysisRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd className={'text-[12px] ' + (mono ? 'font-mono' : '')}>
        {value ?? <span className="text-ink-muted italic">—</span>}
      </dd>
    </>
  );
}
