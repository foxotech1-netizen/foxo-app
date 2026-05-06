'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { Article } from '@/lib/types/database';
import { saveArticle, deleteArticle, type ArticleInput } from '../facturation/actions';
import { RowMenu } from '@/components/RowMenu';

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function ttc(htva: number, tvaPct: number): number {
  return Math.round(htva * (1 + tvaPct / 100) * 100) / 100;
}

// Clés triables. La valeur de chaque clé est dérivée à la volée pour
// éviter d'enrichir le shape Article avec un prix_ttc précalculé.
type SortKey = 'code' | 'description' | 'prix_htva' | 'tva_pct' | 'prix_ttc' | 'actif';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'tous' | 'actifs' | 'inactifs';

function compareValues(a: string | number | boolean, b: string | number | boolean): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'fr-BE', { numeric: true, sensitivity: 'base' });
}

export function ArticlesClient({ initial }: { initial: Article[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [editing, setEditing] = useState<Article | 'new' | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('tous');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Précalcule prix_ttc pour permettre filtrage texte + tri en une passe.
  const enriched = useMemo(
    () => initial.map((a) => ({ ...a, prix_ttc: ttc(Number(a.prix_htva), Number(a.tva_pct ?? 21)) })),
    [initial],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((a) => {
      // Filtre statut
      if (statusFilter === 'actifs' && !a.actif) return false;
      if (statusFilter === 'inactifs' && a.actif) return false;
      // Filtre texte (code, description, prix HT/TTC affichés en €)
      if (!q) return true;
      const haystack = [
        a.code ?? '',
        a.description,
        String(a.prix_htva),
        String(a.prix_ttc),
        fmtMoney(Number(a.prix_htva)),
        fmtMoney(a.prix_ttc),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [enriched, query, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: string | number | boolean;
      let bv: string | number | boolean;
      switch (sortKey) {
        case 'code':         av = a.code ?? '';         bv = b.code ?? '';         break;
        case 'description':  av = a.description;        bv = b.description;        break;
        case 'prix_htva':    av = Number(a.prix_htva);  bv = Number(b.prix_htva);  break;
        case 'tva_pct':      av = Number(a.tva_pct);    bv = Number(b.tva_pct);    break;
        case 'prix_ttc':     av = a.prix_ttc;           bv = b.prix_ttc;           break;
        case 'actif':        av = a.actif;              bv = b.actif;              break;
      }
      const c = compareValues(av, bv);
      return sortDir === 'asc' ? c : -c;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function handleDelete(id: string) {
    if (!confirm('Supprimer cet article du catalogue ?')) return;
    startTransition(async () => {
      const res = await deleteArticle(id);
      if (!res.ok) setFeedback({ kind: 'err', msg: res.error });
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4 max-w-[860px]">
      {/* Actions globales */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — code, description, prix…"
          className="flex-1 min-w-[200px] px-3.5 py-2.5 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2.5 border border-sand-border rounded-lg text-xs bg-cream cursor-pointer"
          title="Filtrer par statut"
        >
          <option value="tous">Tous statuts</option>
          <option value="actifs">Actifs</option>
          <option value="inactifs">Inactifs</option>
        </select>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="bg-navy text-white px-3.5 py-2.5 rounded-lg text-xs font-bold hover:opacity-90"
        >
          + Nouvel article
        </button>
      </div>

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

      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead>
              <tr className="bg-[var(--table-bg)]">
                <SortableTh label="Code"        sortKey="code"        currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Description" sortKey="description" currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Prix TTC"    sortKey="prix_ttc"    currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="TVA"         sortKey="tva_pct"     currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Prix HT"     sortKey="prix_htva"   currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortableTh label="Statut"      sortKey="actif"       currentKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px]">
                    {query.trim() || statusFilter !== 'tous'
                      ? 'Aucun article ne correspond au filtre.'
                      : 'Aucun article. Crée-en un pour démarrer.'}
                  </td>
                </tr>
              ) : sorted.map((a) => (
                <tr key={a.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-2.5 font-mono text-xs font-bold text-navy">
                    {a.code ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[13px]">{a.description}</td>
                  <td className="px-3.5 py-2.5 text-[13px] font-mono font-bold whitespace-nowrap dark:text-white">
                    {fmtMoney(a.prix_ttc)}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                    {a.tva_pct}%
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap">
                    {fmtMoney(Number(a.prix_htva))}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span className={
                      'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
                      (a.actif
                        ? 'bg-ok-light text-ok dark:text-white'
                        : 'bg-sand-mid text-ink-mid')
                    }>
                      {a.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    <RowMenu
                      direction="up"
                      items={[
                        { icon: Pencil, label: 'Modifier', onClick: () => setEditing(a) },
                        {
                          icon: Trash2,
                          label: 'Supprimer',
                          destructive: true,
                          disabled: pending,
                          onClick: () => handleDelete(a.id),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ArticleEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// Header de colonne triable. Affiche un indicateur ArrowUp ou ArrowDown
// quand la colonne est active, ArrowUpDown en dimmed sinon pour signaler
// la cliquabilité.
function SortableTh({
  label, sortKey, currentKey, dir, onClick,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === currentKey;
  const Indicator = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      onClick={() => onClick(sortKey)}
      className={
        'px-3.5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider border-b border-sand-border whitespace-nowrap cursor-pointer select-none transition-colors ' +
        (active
          ? 'text-navy'
          : 'text-ink-muted hover:text-ink') +
        ''
      }
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={active ? 'opacity-100' : 'opacity-40'}>
          <Indicator size={12} />
        </span>
      </span>
    </th>
  );
}

function ArticleEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Article | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState(initial?.code ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tvaPct, setTvaPct] = useState(initial ? Number(initial.tva_pct ?? 21) : 21);
  const [prixTtc, setPrixTtc] = useState<number>(
    initial ? ttc(Number(initial.prix_htva), Number(initial.tva_pct ?? 21)) : 0,
  );
  const [actif, setActif] = useState(initial?.actif ?? true);

  const prixHtva = useMemo(
    () => Math.round((prixTtc / (1 + tvaPct / 100)) * 100) / 100,
    [prixTtc, tvaPct],
  );

  function submit() {
    setError(null);
    const input: ArticleInput = {
      id: initial?.id,
      code,
      description,
      prix_ttc: prixTtc,
      tva_pct: tvaPct,
      actif,
    };
    startTransition(async () => {
      const res = await saveArticle(input);
      if (!res.ok) setError(res.error);
      else onSaved();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-cream w-full sm:max-w-[520px] sm:rounded-2xl rounded-t-2xl border border-sand-border max-h-[90vh] flex flex-col shadow-2xl">
        <header className="px-5 py-4 border-b border-sand-border">
          <h2 className="text-base font-extrabold text-ink">
            {initial ? 'Modifier l\'article' : 'Nouvel article'}
          </h2>
        </header>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Code *</Label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="DEP001"
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Description *</Label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Déplacement"
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prix TTC * (en €)</Label>
              <input
                type="number"
                step="0.01"
                value={prixTtc}
                onChange={(e) => setPrixTtc(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
              />
            </div>
            <div>
              <Label>TVA %</Label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={tvaPct}
                onChange={(e) => setTvaPct(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid font-mono"
              />
            </div>
          </div>

          <div className="bg-sand border border-sand-border rounded-lg px-3 py-2 text-[12px]">
            <div className="flex justify-between items-center text-ink-mid">
              <span>HTVA calculé</span>
              <span className="font-mono font-bold">{fmtMoney(prixHtva)}</span>
            </div>
            <div className="flex justify-between items-center mt-0.5 text-ink-mid">
              <span>TVA {tvaPct}%</span>
              <span className="font-mono">{fmtMoney(prixTtc - prixHtva)}</span>
            </div>
            <div className="flex justify-between items-center mt-1 pt-1 border-t border-sand-border">
              <span className="font-bold text-ink">Total TTC</span>
              <span className="font-mono font-extrabold text-navy dark:text-white">{fmtMoney(prixTtc)}</span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} className="accent-[#1B3A6B]" />
            Article actif (sélectionnable dans les factures)
          </label>

          {error && (
            <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-lg px-3 py-2 font-semibold">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-sand-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="bg-sand-mid text-ink-mid px-3.5 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="bg-navy text-white px-4 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
          >
            {pending ? '…' : initial ? 'Enregistrer' : 'Créer'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-ink-mid block mb-1">
      {children}
    </label>
  );
}
