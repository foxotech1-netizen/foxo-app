'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MailListItem, MailDetail, GmailLabel } from '@/lib/gmail';

type FilterMode = 'tous' | 'unread' | 'lies';
type BulkAction = 'read' | 'unread' | 'traite' | 'archive';

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

// IDs de labels système Gmail à ne PAS afficher en badge sur la liste
// (ce sont des marqueurs internes : boîte, étoile, importance, brouillon).
// Note : les labels CATEGORY_* sont aussi de type 'system' et donc déjà
// exclus de la liste /labels (filtre type=user côté serveur).
const HIDDEN_BADGE_LABEL_IDS = new Set([
  'INBOX', 'UNREAD', 'IMPORTANT', 'STARRED', 'SENT', 'DRAFT',
  'SPAM', 'TRASH', 'CHAT',
]);

// Palette restreinte de couleurs valides côté Gmail API. Sortir de cette
// liste fait échouer la création de label avec HTTP 400.
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
  if (sameDay) return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' });
}

function senderName(from: string): string {
  const m = from.match(/^"?([^"<]+?)"?\s*<.+>$/);
  return (m ? m[1] : from).trim();
}

function senderEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

function hasInterventionRef(m: MailListItem): boolean {
  return /\b\d{4}-\d{3,5}\b/.test(`${m.subject} ${m.snippet}`);
}

export function MailsClient({ initialConnected }: { initialConnected: boolean }) {
  const router = useRouter();
  const [mails, setMails] = useState<MailListItem[]>([]);
  const [loading, setLoading] = useState(initialConnected);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('tous');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [analysis, setAnalysis] = useState<MailAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [traiteLoading, setTraiteLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);

  // Sélection multiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Labels
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(initialConnected);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  // Modal de création de label
  const [createLabelOpen, setCreateLabelOpen] = useState(false);

  // Dropdown "ajouter un label" dans le drawer
  const [addLabelMenuOpen, setAddLabelMenuOpen] = useState(false);

  // Charge la liste au mount + quand le filtre serveur change
  useEffect(() => {
    if (!initialConnected) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '30' });
    if (filter === 'unread') params.set('filter', 'unread');
    if (activeLabel) params.set('label', activeLabel);
    fetch(`/api/admin/mails?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (!data.ok) { setError(data.error ?? 'Erreur'); return; }
        setMails(data.mails ?? []);
        setSelectedIds(new Set());     // reset sélection sur changement de filtre
      })
      .catch((e) => mounted && setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [initialConnected, filter, activeLabel]);

  // Charge les labels Gmail (1 fois)
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
      .catch(() => { /* noop */ })
      .finally(() => { if (mounted) setLabelsLoading(false); });
    return () => { mounted = false; };
  }, [initialConnected]);

  // Charge le détail quand selectedId change
  useEffect(() => {
    if (!selectedId) { setDetail(null); setAnalysis(null); return; }
    let mounted = true;
    setDetailLoading(true);
    setAnalysis(null);
    fetch(`/api/admin/mails/${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (data.ok) {
          setDetail(data.mail);
          setMails((arr) => arr.map((m) => m.id === selectedId
            ? { ...m, unread: false, label_ids: m.label_ids.filter((l) => l !== 'UNREAD') }
            : m));
        } else {
          setError(data.error ?? 'Erreur détail');
        }
      })
      .catch((e) => mounted && setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => { if (mounted) setDetailLoading(false); });
    return () => { mounted = false; };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mails.filter((m) => {
      if (q) {
        const matches = [m.from, m.subject, m.snippet].some((s) => s.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (filter === 'lies' && !hasInterventionRef(m)) return false;
      return true;
    });
  }, [mails, query, filter]);

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

  async function applyBulkAction(action: BulkAction) {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkLoading(true);
    setFeedback(null);
    try {
      const r = await fetch('/api/admin/mails/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Action en masse échouée.' });
        return;
      }
      // Optimistic update
      setMails((arr) => {
        if (action === 'archive') return arr.filter((m) => !selectedIds.has(m.id));
        if (action === 'traite') return arr.filter((m) => !selectedIds.has(m.id));
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
        return arr;
      });
      setSelectedIds(new Set());
      const labelMap: Record<BulkAction, string> = {
        read: 'marqué(s) comme lu',
        unread: 'marqué(s) comme non lu',
        traite: 'marqué(s) FOXO_TRAITE',
        archive: 'archivé(s)',
      };
      setFeedback({ kind: 'ok', msg: `${ids.length} mail(s) ${labelMap[action]} ✓` });
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

  async function markTraite() {
    if (!detail) return;
    setTraiteLoading(true);
    setFeedback(null);
    try {
      const r = await fetch(`/api/admin/mails/${detail.id}/mark-traite`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec marquage.' });
      } else {
        setFeedback({ kind: 'ok', msg: 'Mail marqué FOXO_TRAITE ✓' });
        setMails((arr) => arr.filter((m) => m.id !== detail.id));
        setSelectedId(null);
      }
    } finally {
      setTraiteLoading(false);
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
      // Optimistic : met à jour labelIds dans detail + dans la liste
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

  const totalUnread = labels.reduce((acc, l) => acc + l.messages_unread, 0);

  return (
    <div className="h-full flex">
      {createLabelOpen && (
        <CreateLabelModal
          onClose={() => setCreateLabelOpen(false)}
          onCreated={async () => {
            setCreateLabelOpen(false);
            await refreshLabels();
            setFeedback({ kind: 'ok', msg: 'Libellé créé ✓' });
          }}
          onError={(msg) => setFeedback({ kind: 'err', msg })}
        />
      )}

      {/* Liste à gauche */}
      <aside
        className={
          'flex flex-col w-full sm:w-[380px] border-r border-sand-border bg-cream dark:bg-[#1C1A16] dark:border-[#2C2A24] ' +
          (selectedId ? 'hidden sm:flex' : 'flex')
        }
      >
        {/* Filtres + Recherche */}
        <div className="p-3 border-b border-sand-border dark:border-[#2C2A24] space-y-2 flex-shrink-0">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher — expéditeur, sujet…"
            className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
          />
          <div className="grid grid-cols-3 gap-1.5">
            {(['tous', 'unread', 'lies'] as FilterMode[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={
                  'px-2 py-1.5 rounded text-[11px] font-bold border ' +
                  (filter === f
                    ? 'bg-navy text-white border-navy'
                    : 'bg-white text-ink-mid border-sand-border dark:bg-[#221E1A] dark:text-[#C8C2B8] dark:border-[#3D3A32]')
                }
              >
                {f === 'tous' ? 'Tous' : f === 'unread' ? 'Non lus' : 'Avec interv.'}
              </button>
            ))}
          </div>
          <button
            ref={refreshRef}
            type="button"
            onClick={() => setFilter((f) => f)}
            className="w-full text-[11px] text-ink-muted hover:text-navy underline dark:text-[#C8C2B8]"
            disabled={loading}
          >
            {loading ? 'Chargement…' : '↻ Actualiser'}
          </button>
        </div>

        {/* Section Libellés */}
        <div className="p-3 border-b border-sand-border dark:border-[#2C2A24] flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted dark:text-[#C8C2B8]">
              Libellés{totalUnread > 0 ? ` · ${totalUnread} non lus` : ''}
            </span>
            <button
              type="button"
              onClick={() => setCreateLabelOpen(true)}
              className="text-[10px] font-bold text-navy hover:underline dark:text-[#A8C4F2]"
            >
              + Nouveau libellé
            </button>
          </div>

          {activeLabel && (
            <button
              type="button"
              onClick={() => setActiveLabel(null)}
              className="w-full text-left mb-1.5 text-[11px] bg-amber-light border border-[#E8C896] rounded px-2 py-1 text-[#8A5A1A] font-semibold dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]"
            >
              ✕ Filtre actif : {activeLabel}
            </button>
          )}

          {labelsLoading ? (
            <div className="text-[11px] text-ink-muted dark:text-[#C8C2B8]">Chargement…</div>
          ) : labels.length === 0 ? (
            <div className="text-[11px] text-ink-muted dark:text-[#C8C2B8] italic">
              Aucun libellé personnalisé.
            </div>
          ) : (
            <ul className="space-y-0.5 max-h-[180px] overflow-y-auto">
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
                          : 'hover:bg-sand-hover text-ink dark:text-[#F0ECE4] dark:hover:bg-[#2A2520]')
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
                          (active ? 'bg-white/25 text-white' : 'bg-terra-light text-terra dark:bg-[#5A2E18] dark:text-[#FFB897]')
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
          <div className="px-3 py-2 border-b border-sand-border dark:border-[#2C2A24] bg-sand dark:bg-[#141210] flex items-center gap-2 flex-shrink-0">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              aria-label="Tout sélectionner"
              className="w-4 h-4 accent-[#1B3A6B] cursor-pointer"
            />
            <span className="text-[11px] text-ink-muted dark:text-[#C8C2B8]">
              {selectedIds.size > 0
                ? `${selectedIds.size} sélectionné(s)`
                : `${filtered.length} mail(s)`}
            </span>
          </div>
        )}

        {/* Liste */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-3 text-[12px] bg-terra-light border border-terra-mid text-terra rounded-md px-3 py-2 font-semibold">
              {error}
            </div>
          )}
          {filtered.length === 0 && !loading && !error && (
            <div className="text-[13px] text-ink-muted text-center py-12 dark:text-[#C8C2B8]">
              Aucun mail.
            </div>
          )}
          {filtered.map((m) => {
            const active = selectedId === m.id;
            const checked = selectedIds.has(m.id);
            const badges = userBadgesForMail(m);
            return (
              <div
                key={m.id}
                className={
                  'flex items-start gap-2 px-3 py-2.5 border-b border-sand-mid hover:bg-sand-hover transition-colors dark:border-[#3D3A32] dark:hover:bg-[#2A2520] ' +
                  (active ? 'bg-navy-pale dark:bg-[#1B3A6B]' : '')
                }
              >
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
                    <div className={'text-[12px] font-bold truncate flex-1 ' + (active ? 'text-navy dark:text-white' : 'text-ink dark:text-[#F0ECE4]')}>
                      {senderName(m.from)}
                    </div>
                    <span className="text-[10px] text-ink-muted whitespace-nowrap dark:text-[#C8C2B8]">
                      {fmtDate(m.date)}
                    </span>
                  </div>
                  <div className={'text-[12px] truncate ' + (m.unread ? 'font-semibold text-ink dark:text-[#F0ECE4]' : 'text-ink-mid dark:text-[#C8C2B8]')}>
                    {m.subject}
                  </div>
                  {badges.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {badges.map((l) => (
                        <LabelBadge key={l.id} label={l} small />
                      ))}
                    </div>
                  )}
                  <div className="text-[11px] text-ink-muted truncate mt-0.5 dark:text-[#C8C2B8]">
                    {m.snippet}
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* Barre d'actions sticky en masse */}
        {selectedIds.size > 0 && (
          <div className="border-t border-sand-border bg-cream px-3 py-2.5 flex-shrink-0 sticky bottom-0 z-10 shadow-[0_-4px_12px_rgba(0,0,0,.06)] dark:bg-[#1C1A16] dark:border-[#2C2A24]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2 dark:text-[#C8C2B8]">
              {selectedIds.size} mail(s) sélectionné(s)
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <BulkButton
                onClick={() => applyBulkAction('read')}
                disabled={bulkLoading}
                color="navy"
              >
                ✅ Marquer lu
              </BulkButton>
              <BulkButton
                onClick={() => applyBulkAction('unread')}
                disabled={bulkLoading}
                color="navy-outline"
              >
                📧 Marquer non lu
              </BulkButton>
              <BulkButton
                onClick={() => applyBulkAction('traite')}
                disabled={bulkLoading}
                color="terra-brand"
              >
                ✅ FOXO_TRAITE
              </BulkButton>
              <BulkButton
                onClick={() => applyBulkAction('archive')}
                disabled={bulkLoading}
                color="muted"
              >
                🗑 Archiver
              </BulkButton>
            </div>
          </div>
        )}
      </aside>

      {/* Détail à droite (drawer sur mobile) */}
      <main
        className={
          'flex-1 bg-sand overflow-y-auto dark:bg-[#141210] ' +
          (selectedId ? 'flex' : 'hidden sm:flex') + ' flex-col'
        }
      >
        {!selectedId && (
          <div className="flex-1 flex items-center justify-center text-[13px] text-ink-muted dark:text-[#C8C2B8]">
            Sélectionnez un mail pour l&apos;ouvrir.
          </div>
        )}

        {selectedId && (
          <>
            <header className="px-4 py-3 border-b border-sand-border bg-cream flex items-start justify-between gap-3 flex-shrink-0 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="sm:hidden text-[12px] text-navy underline dark:text-[#A8C4F2]"
                  >
                    ← Retour
                  </button>
                  <h2 className="text-[14px] font-extrabold text-ink truncate dark:text-[#F0ECE4]">
                    {detail?.subject ?? '…'}
                  </h2>
                </div>
                {detail && (
                  <div className="text-[11px] text-ink-muted mt-1 dark:text-[#C8C2B8]">
                    <span className="font-semibold">{senderName(detail.from)}</span>
                    <span className="ml-1 font-mono text-[10px]">&lt;{senderEmail(detail.from)}&gt;</span>
                    <span className="mx-1.5">·</span>
                    {new Date(detail.date).toLocaleString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="hidden sm:inline-flex bg-sand-mid w-8 h-8 rounded-md text-ink-mid items-center justify-center dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
                aria-label="Fermer"
              >✕</button>
            </header>

            <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-sand-border bg-sand flex-shrink-0 dark:bg-[#141210] dark:border-[#2C2A24]">
              <button
                type="button"
                onClick={analyzeMail}
                disabled={analysisLoading || !detail}
                className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px]"
              >
                🤖 {analysisLoading ? 'Analyse…' : 'Analyser avec IA'}
              </button>
              <button
                type="button"
                onClick={createIntervention}
                disabled={!detail}
                className="bg-[#1F6B45] text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px]"
              >
                📋 Créer une intervention
              </button>
              <button
                type="button"
                onClick={markTraite}
                disabled={traiteLoading || !detail}
                className="bg-[#A17244] text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px]"
              >
                ✅ {traiteLoading ? 'Marquage…' : 'Marquer traité'}
              </button>
              {detail && (
                <a
                  href={`https://mail.google.com/mail/u/0/#inbox/${detail.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-sand-mid text-ink-mid px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center min-h-[44px] dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
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
                    ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A]'
                    : 'bg-terra-light border-terra-mid text-terra')
                }
              >
                {feedback.msg}
              </div>
            )}

            {/* Section Libellés du mail */}
            {detail && (
              <div className="mx-4 mt-3 bg-cream border border-sand-border rounded-xl p-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink-muted dark:text-[#C8C2B8]">
                    Libellés
                  </span>
                  <button
                    type="button"
                    onClick={() => setAddLabelMenuOpen((v) => !v)}
                    className="text-[11px] font-bold text-navy hover:underline dark:text-[#A8C4F2]"
                    aria-expanded={addLabelMenuOpen}
                  >
                    {addLabelMenuOpen ? '✕ Annuler' : '+ Ajouter'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {userBadgesForMail(detail).length === 0 && !addLabelMenuOpen && (
                    <span className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
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
                  <div className="mt-2 pt-2 border-t border-sand-border dark:border-[#3D3A32]">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5 dark:text-[#C8C2B8]">
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
                        <span className="text-[11px] text-ink-muted italic dark:text-[#C8C2B8]">
                          Tous les libellés sont déjà appliqués.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {analysis && (
              <div className="mx-4 mt-3 bg-cream border border-sand-border rounded-xl p-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-2 dark:text-[#C8C2B8]">
                  ✨ Analyse IA
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  <AnalysisRow label="Client" value={analysis.nom_client} />
                  <AnalysisRow label="Téléphone" value={analysis.telephone} mono />
                  <AnalysisRow label="Email" value={analysis.email} mono />
                  <AnalysisRow label="Type" value={analysis.type_probleme} />
                  <AnalysisRow label="Priorité" value={analysis.priorite ? (analysis.priorite === 'urgente' ? '⚡ Urgente' : 'Normale') : null} />
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
                <div className="text-[13px] text-ink-muted text-center py-12 dark:text-[#C8C2B8]">Chargement…</div>
              )}
              {!detailLoading && detail && (
                <div className="bg-cream border border-sand-border rounded-xl p-4 max-w-[800px] dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                  {detail.body_html ? (
                    <div
                      className="text-[13px] text-ink dark:text-[#F0ECE4]"
                      style={{
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                      }}
                      dangerouslySetInnerHTML={{ __html: detail.body_html }}
                    />
                  ) : (
                    <pre className="text-[13px] text-ink whitespace-pre-wrap font-sans dark:text-[#F0ECE4]">
                      {detail.body_text || detail.snippet}
                    </pre>
                  )}
                  {detail.attachments.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-sand-border dark:border-[#3D3A32]">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-muted mb-1.5 dark:text-[#C8C2B8]">
                        Pièces jointes
                      </div>
                      <ul className="text-[12px] text-ink-mid space-y-1 dark:text-[#C8C2B8]">
                        {detail.attachments.map((a, i) => (
                          <li key={i} className="font-mono">
                            📎 {a.filename} <span className="text-ink-muted">· {Math.round(a.size / 1024)} KB</span>
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

function BulkButton({
  onClick, disabled, color, children,
}: {
  onClick: () => void;
  disabled: boolean;
  color: 'navy' | 'navy-outline' | 'terra-brand' | 'muted';
  children: React.ReactNode;
}) {
  const className = {
    'navy': 'bg-navy text-white border border-navy',
    'navy-outline': 'bg-white text-navy border border-navy dark:bg-[#221E1A] dark:text-[#A8C4F2]',
    'terra-brand': 'bg-[#A17244] text-white border border-[#A17244]',
    'muted': 'bg-sand-mid text-ink-mid border border-sand-border dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]',
  }[color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={'px-2.5 py-2 rounded-lg text-[11px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[40px] ' + className}
    >
      {children}
    </button>
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
      <div className="bg-cream border border-sand-border rounded-2xl p-5 w-full max-w-[420px] dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[14px] font-extrabold text-ink dark:text-[#F0ECE4]">
            Nouveau libellé Gmail
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
            aria-label="Fermer"
          >✕</button>
        </div>

        <label className="block text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 dark:text-[#C8C2B8]">
          Nom du libellé
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex : Devis en cours"
          className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
          autoFocus
        />

        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1.5 dark:text-[#C8C2B8]">
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
            className="px-3 py-2 rounded-lg text-[12px] font-bold border border-sand-border bg-white text-ink-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#C8C2B8]"
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

function AnalysisRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
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
