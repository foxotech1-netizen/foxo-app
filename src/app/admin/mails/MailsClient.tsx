'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MailListItem, MailDetail } from '@/lib/gmail';

type FilterMode = 'tous' | 'unread' | 'lies';

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

// "Avec intervention liée" est un filtre client-side : on regarde si la
// chaîne `interventionRefs` (regex 2026-XXX) apparaît dans le sujet ou le
// snippet — heuristique simple qui évite un appel DB en plus.
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

  // Charge la liste au mount + quand le filtre serveur change
  useEffect(() => {
    if (!initialConnected) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '30' });
    if (filter === 'unread') params.set('filter', 'unread');
    fetch(`/api/admin/mails?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (!data.ok) { setError(data.error ?? 'Erreur'); return; }
        setMails(data.mails ?? []);
      })
      .catch((e) => mounted && setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [initialConnected, filter]);

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
          // Optimistic : marque le mail comme lu côté UI
          setMails((arr) => arr.map((m) => m.id === selectedId ? { ...m, unread: false } : m));
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

  function createIntervention() {
    if (!detail) return;
    // Stocke l'analyse dans sessionStorage et redirige vers le planning.
    // L'admin clique ensuite un créneau libre — le modal lira le prefill.
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

  if (!initialConnected) {
    return null;     // bandeau déjà affiché dans la page server
  }

  return (
    <div className="h-full flex">
      {/* Liste à gauche */}
      <aside
        className={
          'flex flex-col w-full sm:w-[380px] border-r border-sand-border bg-cream dark:bg-[#1C1A16] dark:border-[#2C2A24] ' +
          (selectedId ? 'hidden sm:flex' : 'flex')
        }
      >
        {/* Filtres */}
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
            onClick={() => setFilter((f) => f)}     // re-trigger l'effect
            className="w-full text-[11px] text-ink-muted hover:text-navy underline dark:text-[#C8C2B8]"
            disabled={loading}
          >
            {loading ? 'Chargement…' : '↻ Actualiser'}
          </button>
        </div>

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
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                className={
                  'w-full text-left px-3 py-2.5 border-b border-sand-mid hover:bg-sand-hover transition-colors dark:border-[#3D3A32] dark:hover:bg-[#2A2520] ' +
                  (active ? 'bg-navy-pale dark:bg-[#1B3A6B]' : '')
                }
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
                <div className="text-[11px] text-ink-muted truncate mt-0.5 dark:text-[#C8C2B8]">
                  {m.snippet}
                </div>
              </button>
            );
          })}
        </div>
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
                      // Le HTML est rendu tel quel — confiance émetteur Google.
                      // Pour durcir : utiliser DOMPurify côté client.
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
