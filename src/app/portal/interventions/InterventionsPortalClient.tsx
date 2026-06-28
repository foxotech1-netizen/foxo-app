'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Zap, FileText, MapPin, Wrench, MessageCircle } from 'lucide-react';
import type { StatutIntervention } from '@/lib/types/database';
import { StatutBadge } from '@/components/StatutBadge';
import { relTime, TZ_BRUSSELS } from '@/lib/format';
import { useOrgType, useVocab, useT, useLang } from '../PortalContext';
import { localeFor, type PortalStringKey } from '@/lib/portal/i18n';
import type { InterventionPortalItem } from './page';

type ChipId = 'tous' | 'enCours' | 'enAttente' | 'rapportPret' | 'cloture';
interface Chip {
  id: ChipId;
  match: (s: StatutIntervention) => boolean;
}
const CHIPS: Chip[] = [
  { id: 'tous',        match: () => true },
  { id: 'enCours',     match: (s) => s === 'nouvelle' || s === 'confirmee' || s === 'realisee' },
  { id: 'enAttente',   match: (s) => s === 'attente' || s === 'en_suspens' },
  { id: 'rapportPret', match: (s) => s === 'rapport' },
  { id: 'cloture',     match: (s) => s === 'cloturee' },
];

const PERIODES = [
  { id: 'tout', jours: null as number | null },
  { id: '30j', jours: 30 },
  { id: '3m', jours: 90 },
  { id: '12m', jours: 365 },
] as const;
type PeriodeId = (typeof PERIODES)[number]['id'];

// Cles i18n des libelles de chips / periodes (le texte vit dans STRINGS).
const CHIP_KEY: Record<ChipId, PortalStringKey> = {
  tous: 'chipAll', enCours: 'chipInProgress', enAttente: 'chipPending', rapportPret: 'chipReportReady', cloture: 'chipClosed',
};
const PERIODE_KEY: Record<PeriodeId, PortalStringKey> = {
  tout: 'periodAll', '30j': 'period30d', '3m': 'period3m', '12m': 'period12m',
};

function chipFromStatutParam(s: string | null): ChipId {
  if (!s) return 'tous';
  if (s === 'rapport') return 'rapportPret';
  if (s === 'cloturee') return 'cloture';
  if (s === 'nouvelle' || s === 'confirmee' || s === 'realisee') return 'enCours';
  if (s === 'attente' || s === 'en_suspens') return 'enAttente';
  return 'tous';
}

export function InterventionsPortalClient({
  items,
  initialQuery,
  initialStatut,
  loadError,
}: {
  items: InterventionPortalItem[];
  initialQuery: string;
  initialStatut: string | null;
  loadError: string | null;
}) {
  const orgType = useOrgType();
  const v = useVocab();
  const t = useT();
  const lang = useLang();
  const locale = localeFor(lang);
  const isCourtier = orgType === 'courtier';
  const accentBg = isCourtier
    ? 'bg-[#1D6FA4] hover:bg-[#175E8E]'
    : orgType === 'expert'
      ? 'bg-[#F59E0B] hover:bg-[#D97706]'
      : 'bg-navy hover:bg-navy-mid';

  const [query, setQuery] = useState(initialQuery);
  const [chip, setChip] = useState<ChipId>(chipFromStatutParam(initialStatut));
  const [periode, setPeriode] = useState<PeriodeId>('tout');
  const [acpFilter, setAcpFilter] = useState<string>('tous');

  const activeChip = CHIPS.find((c) => c.id === chip) ?? CHIPS[0];

  const acpOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const iv of items) {
      if (iv.acp_id && iv.acp_nom) map.set(iv.acp_id, iv.acp_nom);
    }
    return Array.from(map, ([id, nom]) => ({ id, nom }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((iv) => {
      if (!activeChip.match(iv.statut)) return false;
      if (acpFilter !== 'tous' && iv.acp_id !== acpFilter) return false;
      const periodeDef = PERIODES.find((p) => p.id === periode);
      if (periodeDef && periodeDef.jours != null) {
        // eslint-disable-next-line react-hooks/purity
        const seuil = Date.now() - periodeDef.jours * 24 * 60 * 60 * 1000;
        if (new Date(iv.created_at).getTime() < seuil) return false;
      }
      if (!q) return true;
      const haystack = [
        iv.ref,
        iv.acp_nom,
        iv.acp_adresse,
        iv.adresse,
        iv.acp_bce,
        iv.ref_courtier,
        iv.reference_externe,
        iv.assureur_nom,
        iv.type,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase())
        .join(' ');
      return haystack.includes(q);
    });
  }, [items, query, activeChip, periode, acpFilter]);

  const counts = useMemo(() => {
    const out: Record<ChipId, number> = {
      tous: items.length,
      enCours: 0,
      enAttente: 0,
      rapportPret: 0,
      cloture: 0,
    };
    for (const iv of items) {
      for (const c of CHIPS) {
        if (c.id !== 'tous' && c.match(iv.statut)) out[c.id] += 1;
      }
    }
    return out;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            {v.myInterventions}
          </h1>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
            <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
            {items.length} {t('totalLabel')}
          </div>
        </div>
        {v.newRequestVerb && (
          <Link
            href="/portal/nouveau"
            className={`text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm ${accentBg}`}
          >
            {v.newRequestVerb}
          </Link>
        )}
      </div>

      {loadError && (
        <div className="px-4 py-2.5 bg-amber-light border border-[#E8C896] text-[#8A5A1A] rounded-lg text-xs font-semibold">
          {t('dbLimited')} {loadError}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isCourtier ? t('searchSinistre') : t('searchSyndic')}
          className="flex-1 min-w-[160px] px-3.5 py-2.5 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
        {orgType === 'syndic' && acpOptions.length > 1 && (
          <select
            value={acpFilter}
            onChange={(e) => setAcpFilter(e.target.value)}
            aria-label={v.acpLabel}
            className="max-w-[200px] px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream text-ink-mid outline-none focus:border-navy-mid cursor-pointer"
          >
            <option value="tous">— {v.acpLabel} —</option>
            {acpOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.nom}</option>
            ))}
          </select>
        )}
        <select
          value={periode}
          onChange={(e) => setPeriode(e.target.value as PeriodeId)}
          aria-label={t('periodAll')}
          className="px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream text-ink-mid outline-none focus:border-navy-mid cursor-pointer"
        >
          {PERIODES.map((p) => (
            <option key={p.id} value={p.id}>{t(PERIODE_KEY[p.id])}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((c) => {
          const active = c.id === chip;
          const n = counts[c.id];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setChip(c.id)}
              className={
                'text-[11px] font-bold px-3 py-1.5 rounded-full border transition-colors ' +
                (active
                  ? 'bg-navy text-white border-navy'
                  : 'bg-cream text-ink-mid border-sand-border hover:bg-sand-mid')
              }
            >
              {t(CHIP_KEY[c.id])}
              <span className={'ml-1.5 text-[10px] font-semibold ' + (active ? 'opacity-80' : 'opacity-60')}>
                ({n})
              </span>
            </button>
          );
        })}
      </div>


      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <p className="text-xs text-ink-muted bg-cream border border-sand-border rounded-lg p-6 text-center">
            {v.emptyList}
          </p>
        ) : filtered.map((iv) => (
          <Link
            key={iv.id}
            href={`/portal/interventions/${iv.id}`}
            className="block bg-cream rounded-lg border border-sand-border p-3.5 hover:bg-sand-hover"
          >
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[11px] font-semibold text-navy">{iv.ref ?? '—'}</span>
                  {iv.priorite === 'urgente' && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-terra"><Zap size={12} /> {t('urgent')}</span>
                  )}
                  {iv.has_rapport && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-ok"><FileText size={12} /> {t('reportBadge')}</span>
                  )}
                  {iv.unread_messages_count > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-[9px] font-bold text-navy"
                      title={`${iv.unread_messages_count} ${t('unreadFromFoxo')}`}
                    >
                      <MessageCircle size={12} /> {iv.unread_messages_count}
                    </span>
                  )}
                </div>
                <div className="font-bold text-[13px] mt-0.5 truncate">{iv.acp_nom ?? '—'}</div>
                {orgType === 'syndic' && iv.reference_externe && (
                  <div className="text-[10px] text-ink-muted font-mono mt-0.5 truncate">{v.referenceLabel} {iv.reference_externe}</div>
                )}
                {(iv.acp_adresse || iv.adresse) && (
                  <div className="inline-flex items-center gap-1.5 text-[11px] text-ink-mid mt-0.5 truncate">
                    <MapPin size={12} /> {iv.acp_adresse ?? iv.adresse}
                  </div>
                )}
                <div className="text-[10px] text-ink-muted mt-1 flex items-center gap-2 flex-wrap">
                  <span>{t('createdLabel')} {new Date(iv.created_at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long', timeZone: TZ_BRUSSELS })}</span>
                  {iv.technicien_nom && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1"><Wrench size={12} /> {iv.technicien_nom}</span>
                    </>
                  )}
                </div>
              </div>
              <StatutBadge statut={iv.statut} />
            </div>
            {iv.creneau_debut && (
              <div className="mt-2 text-[10px] text-ink-muted font-mono">
                {t('slotLabel')} {new Date(iv.creneau_debut).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS })}
              </div>
            )}
          </Link>
        ))}
      </div>

      <div className="hidden md:block bg-cream rounded-xl border border-sand-border overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-sand">
              {[
                { key: 'ref', node: t('thRef') },
                { key: 'acp', node: v.acpLabel },
                { key: 'adresse', node: t('thAddress') },
                { key: 'statut', node: t('thStatus') },
                { key: 'cree', node: t('thCreated') },
                { key: 'tech', node: t('thTechnician') },
                { key: 'rapport', node: <FileText size={14} /> },
              ].map((h) => (
                <th
                  key={h.key}
                  className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap"
                >
                  {h.node}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px]">
                  {v.emptyList}
                </td>
              </tr>
            ) : filtered.map((iv) => (
              <tr
                key={iv.id}
                className="border-b border-sand-mid hover:bg-sand-hover cursor-pointer"
                onClick={() => { window.location.href = `/portal/interventions/${iv.id}`; }}
              >
                <td className="px-3.5 py-3 whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-navy">{iv.ref ?? '—'}</span>
                  {iv.priorite === 'urgente' && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-bold text-terra"><Zap size={12} /> {t('urgent')}</span>
                  )}
                </td>
                <td className="px-3.5 py-3">
                  <div className="font-bold text-[13px]">{iv.acp_nom ?? '—'}</div>
                  {iv.acp_bce && (
                    <div className="text-[10px] text-ink-muted font-mono mt-0.5">{t('bceLabel')} {iv.acp_bce}</div>
                  )}
                  {orgType === 'syndic' && iv.reference_externe && (
                    <div className="text-[10px] text-ink-muted font-mono mt-0.5">{v.referenceLabel} {iv.reference_externe}</div>
                  )}
                </td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid">
                  {iv.acp_adresse ?? iv.adresse ?? <span className="text-ink-muted">—</span>}
                </td>
                <td className="px-3.5 py-3">
                  <div className="inline-flex items-center gap-1.5">
                    <StatutBadge statut={iv.statut} />
                    {iv.unread_messages_count > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-[9px] font-bold text-navy"
                        title={`${iv.unread_messages_count} ${t('unreadFromFoxo')}`}
                      >
                        <MessageCircle size={12} />{iv.unread_messages_count}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                  {new Date(iv.created_at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long', timeZone: TZ_BRUSSELS })}
                  <div className="text-[10px] text-ink-muted">{relTime(iv.updated_at)}</div>
                </td>
                <td className="px-3.5 py-3 text-[11px] text-ink-mid whitespace-nowrap">
                  {iv.technicien_nom ?? <span className="text-ink-muted italic">{t('notAssigned')}</span>}
                </td>
                <td className="px-3.5 py-3 text-center">
                  {iv.has_rapport && (
                    <span className="inline-flex" title={t('reportAvailable')}><FileText size={14} /></span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink-muted">
        {filtered.length} {v.countSuffix}
        {filtered.length !== items.length ? ` ${t('ofTotal')} ${items.length}` : ''}
      </p>
    </div>
  );
}
