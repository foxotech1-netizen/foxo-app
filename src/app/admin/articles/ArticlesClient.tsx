'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Article } from '@/lib/types/database';
import { saveArticle, deleteArticle, type ArticleInput } from '../facturation/actions';
import { RowMenu } from '@/components/RowMenu';

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function ttc(htva: number, tvaPct: number): number {
  return Math.round(htva * (1 + tvaPct / 100) * 100) / 100;
}

export function ArticlesClient({ initial }: { initial: Article[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [editing, setEditing] = useState<Article | 'new' | null>(null);

  const sorted = useMemo(
    () => [...initial].sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')),
    [initial],
  );

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
      <button
        type="button"
        onClick={() => setEditing('new')}
        className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:opacity-90"
      >
        + Nouvel article
      </button>

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

      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead>
              <tr className="bg-sand dark:bg-[#221E1A]">
                {['Code', 'Description', 'Prix TTC', 'TVA', 'HTVA', 'Statut', 'Actions'].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px] dark:text-[#C8C2B8]">
                    Aucun article. Crée-en un pour démarrer.
                  </td>
                </tr>
              ) : sorted.map((a) => {
                const prixTtc = ttc(Number(a.prix_htva), Number(a.tva_pct ?? 21));
                return (
                  <tr key={a.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#3D3A32] dark:hover:bg-[#2A2520]">
                    <td className="px-3.5 py-2.5 font-mono text-xs font-bold text-navy dark:text-[#A8C4F2]">
                      {a.code ?? '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-[13px] dark:text-[#F0ECE4]">{a.description}</td>
                    <td className="px-3.5 py-2.5 text-[13px] font-mono font-bold whitespace-nowrap dark:text-white">
                      {fmtMoney(prixTtc)}
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">
                      {a.tva_pct}%
                    </td>
                    <td className="px-3.5 py-2.5 text-[11px] text-ink-mid font-mono whitespace-nowrap dark:text-[#C8C2B8]">
                      {fmtMoney(Number(a.prix_htva))}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <span className={
                        'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
                        (a.actif
                          ? 'bg-ok-light text-ok dark:bg-[#1F6B45] dark:text-white'
                          : 'bg-sand-mid text-ink-mid dark:bg-[#3D3A32] dark:text-[#C8C2B8]')
                      }>
                        {a.actif ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <RowMenu
                        items={[
                          { icon: '✏️', label: 'Modifier', onClick: () => setEditing(a) },
                          {
                            icon: '🗑️',
                            label: 'Supprimer',
                            destructive: true,
                            disabled: pending,
                            onClick: () => handleDelete(a.id),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
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
      <div className="bg-cream w-full sm:max-w-[520px] sm:rounded-2xl rounded-t-2xl border border-sand-border max-h-[90vh] flex flex-col shadow-2xl dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <header className="px-5 py-4 border-b border-sand-border dark:border-[#2C2A24]">
          <h2 className="text-base font-extrabold text-ink dark:text-[#F0ECE4]">
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

          <div className="bg-sand border border-sand-border rounded-lg px-3 py-2 text-[12px] dark:bg-[#221E1A] dark:border-[#3D3A32]">
            <div className="flex justify-between items-center text-ink-mid dark:text-[#C8C2B8]">
              <span>HTVA calculé</span>
              <span className="font-mono font-bold dark:text-[#F0ECE4]">{fmtMoney(prixHtva)}</span>
            </div>
            <div className="flex justify-between items-center mt-0.5 text-ink-mid dark:text-[#C8C2B8]">
              <span>TVA {tvaPct}%</span>
              <span className="font-mono dark:text-[#C8C2B8]">{fmtMoney(prixTtc - prixHtva)}</span>
            </div>
            <div className="flex justify-between items-center mt-1 pt-1 border-t border-sand-border dark:border-[#3D3A32]">
              <span className="font-bold text-ink dark:text-[#F0ECE4]">Total TTC</span>
              <span className="font-mono font-extrabold text-navy dark:text-white">{fmtMoney(prixTtc)}</span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] cursor-pointer dark:text-[#F0ECE4]">
            <input type="checkbox" checked={actif} onChange={(e) => setActif(e.target.checked)} className="accent-[#1B3A6B]" />
            Article actif (sélectionnable dans les factures)
          </label>

          {error && (
            <div className="bg-terra-light border border-terra-mid text-terra text-[12px] rounded-lg px-3 py-2 font-semibold">
              {error}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-sand-border flex justify-end gap-2 dark:border-[#2C2A24]">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="bg-sand-mid text-ink-mid px-3.5 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
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
    <label className="text-xs font-semibold text-ink-mid block mb-1 dark:text-[#C8C2B8]">
      {children}
    </label>
  );
}
