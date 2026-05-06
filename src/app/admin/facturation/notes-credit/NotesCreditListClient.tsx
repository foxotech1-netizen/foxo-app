'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { Pencil, FileText, Undo2, Trash2 } from 'lucide-react';
import type { Facture, StatutFacture } from '@/lib/types/database';
import { RowMenu } from '@/components/RowMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { deleteFacture, revertToBrouillon } from '../actions';

const STATUT_LABEL: Partial<Record<StatutFacture, string>> = {
  brouillon: 'Brouillon',
  envoyee:   'Émis',
  annulee:   'Annulé',
};

const STATUT_COLOR: Partial<Record<StatutFacture, { fg: string; bg: string }>> = {
  brouillon: { fg: '#6B6558', bg: '#EDEAE3' },
  envoyee:   { fg: '#2A5298', bg: '#D6E4F7' },
  annulee:   { fg: '#6B6558', bg: '#E4DFD4' },
};

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

type ConfirmKind = 'delete' | 'revert';
interface ConfirmState {
  kind: ConfirmKind;
  avoir: Facture;
}

export function NotesCreditListClient({
  initial,
  origineMap,
}: {
  initial: Facture[];
  origineMap: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const [avoirsList, setAvoirsList] = useState<Facture[]>(initial);
  const [lastInit, setLastInit] = useState(initial);
  if (lastInit !== initial) {
    setLastInit(initial);
    setAvoirsList(initial);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return avoirsList;
    return avoirsList.filter((a) =>
      [a.numero, a.client_nom, a.reference, a.facture_origine_id ? origineMap[a.facture_origine_id] : null]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [avoirsList, query, origineMap]);

  function patchAvoir(id: string, patch: Partial<Facture>) {
    setAvoirsList((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function performDelete(avoir: Facture) {
    const snapshot = avoirsList;
    setAvoirsList((prev) => prev.filter((a) => a.id !== avoir.id));
    setConfirmState(null);
    startTransition(async () => {
      const res = await deleteFacture(avoir.id);
      if (!res.ok) {
        setAvoirsList(snapshot);
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: `Brouillon ${avoir.numero} supprimé.` });
    });
  }

  function performRevert(avoir: Facture) {
    const previous = avoir.statut;
    patchAvoir(avoir.id, { statut: 'brouillon', sent_at: null });
    setConfirmState(null);
    startTransition(async () => {
      const res = await revertToBrouillon(avoir.id);
      if (!res.ok) {
        patchAvoir(avoir.id, { statut: previous });
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: `${avoir.numero} remis en brouillon.` });
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — numéro, client, facture d'origine…"
          className="flex-1 min-w-[240px] px-3.5 py-2 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
      </div>

      {feedback && (
        <div className={
          'mb-3 px-3 py-2 text-xs rounded-md font-semibold ' +
          (feedback.kind === 'ok' ? 'bg-ok-light border border-ok-mid text-ok' : 'bg-terra-light border border-terra-mid text-terra')
        }>
          {feedback.msg}
        </div>
      )}

      <div className="bg-cream border border-sand-border rounded-xl overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-sand">
              {['N° avoir', 'Facture d\'origine', 'Client', 'Date', 'Montant TTC', 'Statut', 'Actions'].map((h) => (
                <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px]">
                  Aucune note de crédit pour l&apos;instant. Crée un avoir depuis la fiche d&apos;une facture.
                </td>
              </tr>
            ) : filtered.map((a) => {
              const sc = STATUT_COLOR[a.statut] ?? { fg: '#6B6558', bg: '#EDEAE3' };
              const label = STATUT_LABEL[a.statut] ?? a.statut;
              const origNum = a.facture_origine_id ? origineMap[a.facture_origine_id] : null;
              return (
                <tr key={a.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-3 font-mono text-xs font-bold text-terra">
                    <Link href={`/admin/facturation/notes-credit/${a.id}`} className="hover:underline">
                      {a.numero}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[12px]">
                    {a.facture_origine_id ? (
                      <Link href={`/admin/facturation/${a.facture_origine_id}`} className="font-mono text-navy hover:underline">
                        {origNum ?? '?'}
                      </Link>
                    ) : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3.5 py-3 text-[12px]">{a.client_nom ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid">{fmtDate(a.date_emission)}</td>
                  <td className="px-3.5 py-3 text-[12px] font-mono font-bold text-terra">{fmtMoney(a.montant_ttc)}</td>
                  <td className="px-3.5 py-3">
                    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap" style={{ color: sc.fg, background: sc.bg }}>
                      {label}
                    </span>
                  </td>
                  <td className="px-3.5 py-3 whitespace-nowrap">
                    <RowMenu
                      direction="up"
                      items={[
                        { icon: Pencil, label: 'Modifier', href: `/admin/facturation/notes-credit/${a.id}` },
                        { icon: FileText, label: 'Voir le PDF', href: `/api/admin/facture/${a.id}` },
                        {
                          icon: Undo2,
                          label: 'Remettre en brouillon',
                          onClick: () => setConfirmState({ kind: 'revert', avoir: a }),
                          hidden: a.statut !== 'envoyee',
                        },
                        {
                          icon: Trash2,
                          label: 'Supprimer',
                          onClick: () => setConfirmState({ kind: 'delete', avoir: a }),
                          hidden: a.statut !== 'brouillon',
                          destructive: true,
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

      <ConfirmDialog
        open={confirmState !== null}
        title={
          confirmState?.kind === 'delete'
            ? `Supprimer le brouillon ${confirmState.avoir.numero} ?`
            : confirmState?.kind === 'revert'
            ? `Remettre ${confirmState?.avoir.numero} en brouillon ?`
            : ''
        }
        message={
          confirmState?.kind === 'delete'
            ? 'Le brouillon sera supprimé (soft delete : conservé en historique mais masqué).'
            : confirmState?.kind === 'revert'
            ? 'L\'avoir repassera en brouillon. La date d\'envoi sera effacée.'
            : ''
        }
        confirmLabel={confirmState?.kind === 'delete' ? 'Supprimer' : 'Remettre en brouillon'}
        destructive={confirmState?.kind === 'delete'}
        pending={pending}
        onConfirm={() => {
          if (!confirmState) return;
          if (confirmState.kind === 'delete') performDelete(confirmState.avoir);
          else performRevert(confirmState.avoir);
        }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
