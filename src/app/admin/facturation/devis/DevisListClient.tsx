'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Facture, StatutFacture } from '@/lib/types/database';
import { RowMenu } from '@/components/RowMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  convertDevisToFacture,
  deleteFacture,
  revertToBrouillon,
  setDevisStatut,
} from '../actions';

const STATUT_LABEL: Record<StatutFacture, string> = {
  brouillon:  'Brouillon',
  envoyee:    'Envoyé',
  payee:      'Payé',
  en_retard:  'En retard',
  annulee:    'Annulé',
  accepte:    'Accepté',
  refuse:     'Refusé',
  expire:     'Expiré',
};

const STATUT_COLOR: Record<StatutFacture, { fg: string; bg: string }> = {
  brouillon:  { fg: '#6B6558', bg: '#EDEAE3' },
  envoyee:    { fg: '#2A5298', bg: '#D6E4F7' },
  accepte:    { fg: '#1F6B45', bg: '#D4EDE2' },
  refuse:     { fg: '#C4622D', bg: '#F7EDE5' },
  expire:     { fg: '#C4622D', bg: '#F7EDE5' },
  annulee:    { fg: '#6B6558', bg: '#E4DFD4' },
  payee:      { fg: '#1F6B45', bg: '#D4EDE2' },
  en_retard:  { fg: '#C4622D', bg: '#F7EDE5' },
};

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

type ConfirmKind = 'delete' | 'revert' | 'accept' | 'refuse' | 'convert';
interface ConfirmState {
  kind: ConfirmKind;
  devis: Facture;
}

export function DevisListClient({ initial }: { initial: Facture[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const [devisList, setDevisList] = useState<Facture[]>(initial);
  const [lastInit, setLastInit] = useState(initial);
  if (lastInit !== initial) {
    setLastInit(initial);
    setDevisList(initial);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devisList;
    return devisList.filter((d) =>
      [d.numero, d.client_nom, d.reference]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q)),
    );
  }, [devisList, query]);

  function patchDevis(id: string, patch: Partial<Facture>) {
    setDevisList((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function performDelete(devis: Facture) {
    const snapshot = devisList;
    setDevisList((prev) => prev.filter((d) => d.id !== devis.id));
    setConfirmState(null);
    startTransition(async () => {
      const res = await deleteFacture(devis.id);
      if (!res.ok) {
        setDevisList(snapshot);
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: `Brouillon ${devis.numero} supprimé.` });
    });
  }

  function performRevert(devis: Facture) {
    const previous = devis.statut;
    patchDevis(devis.id, { statut: 'brouillon', sent_at: null });
    setConfirmState(null);
    startTransition(async () => {
      const res = await revertToBrouillon(devis.id);
      if (!res.ok) {
        patchDevis(devis.id, { statut: previous });
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({ kind: 'ok', msg: `${devis.numero} remis en brouillon.` });
    });
  }

  function performSetStatut(devis: Facture, statut: 'accepte' | 'refuse') {
    const previous = devis.statut;
    patchDevis(devis.id, { statut });
    setConfirmState(null);
    startTransition(async () => {
      const res = await setDevisStatut(devis.id, statut);
      if (!res.ok) {
        patchDevis(devis.id, { statut: previous });
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      setFeedback({
        kind: 'ok',
        msg: statut === 'accepte' ? `${devis.numero} marqué accepté.` : `${devis.numero} marqué refusé.`,
      });
    });
  }

  function performConvert(devis: Facture) {
    setConfirmState(null);
    setFeedback(null);
    startTransition(async () => {
      const res = await convertDevisToFacture(devis.id);
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      router.push(`/admin/facturation/${res.data!.id}`);
    });
  }

  function confirmTitle(s: ConfirmState | null): string {
    if (!s) return '';
    switch (s.kind) {
      case 'delete':  return `Supprimer le brouillon ${s.devis.numero} ?`;
      case 'revert':  return `Remettre ${s.devis.numero} en brouillon ?`;
      case 'accept':  return `Marquer ${s.devis.numero} comme accepté ?`;
      case 'refuse':  return `Marquer ${s.devis.numero} comme refusé ?`;
      case 'convert': return `Convertir ${s.devis.numero} en facture ?`;
    }
  }

  function confirmMessage(s: ConfirmState | null): string {
    if (!s) return '';
    switch (s.kind) {
      case 'delete':
        return 'Le brouillon sera supprimé (soft delete : conservé en historique mais masqué).';
      case 'revert':
        return 'Le devis repassera en brouillon. La date d\'envoi sera effacée.';
      case 'accept':
        return 'Le devis passera en statut "Accepté". Tu pourras ensuite le convertir en facture.';
      case 'refuse':
        return 'Le devis passera en statut "Refusé".';
      case 'convert':
        return 'Le devis passera en "Accepté" et une facture brouillon sera créée à partir de ses lignes.';
    }
  }

  function confirmLabel(s: ConfirmState | null): string {
    if (!s) return 'Confirmer';
    switch (s.kind) {
      case 'delete':  return 'Supprimer';
      case 'revert':  return 'Remettre en brouillon';
      case 'accept':  return 'Marquer accepté';
      case 'refuse':  return 'Marquer refusé';
      case 'convert': return 'Convertir';
    }
  }

  function executeConfirm() {
    if (!confirmState) return;
    switch (confirmState.kind) {
      case 'delete':  performDelete(confirmState.devis); break;
      case 'revert':  performRevert(confirmState.devis); break;
      case 'accept':  performSetStatut(confirmState.devis, 'accepte'); break;
      case 'refuse':  performSetStatut(confirmState.devis, 'refuse'); break;
      case 'convert': performConvert(confirmState.devis); break;
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — numéro, client, référence…"
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
              {['Numéro', 'Client', 'Émis le', 'Validité', 'Total TTC', 'Statut', 'Actions'].map((h) => (
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
                  Aucun devis pour l&apos;instant.
                </td>
              </tr>
            ) : filtered.map((d) => {
              const sc = STATUT_COLOR[d.statut];
              const dejaConverti = Boolean(d.converted_to_facture_id);
              return (
                <tr key={d.id} className="border-b border-sand-mid hover:bg-sand-hover">
                  <td className="px-3.5 py-3 font-mono text-xs font-bold text-navy">
                    <Link href={`/admin/facturation/devis/${d.id}`} className="hover:underline">
                      {d.numero}
                    </Link>
                  </td>
                  <td className="px-3.5 py-3 text-[12px]">{d.client_nom ?? '—'}</td>
                  <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid">{fmtDate(d.date_emission)}</td>
                  <td className="px-3.5 py-3 text-[11px] font-mono text-ink-mid">{fmtDate(d.date_echeance)}</td>
                  <td className="px-3.5 py-3 text-[12px] font-mono font-bold">{fmtMoney(d.montant_ttc)}</td>
                  <td className="px-3.5 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="inline-block self-start rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap" style={{ color: sc.fg, background: sc.bg }}>
                        {STATUT_LABEL[d.statut]}
                      </span>
                      {dejaConverti && d.converted_to_facture_id && (
                        <Link
                          href={`/admin/facturation/${d.converted_to_facture_id}`}
                          className="text-[10px] text-navy underline"
                        >
                          → Facture liée
                        </Link>
                      )}
                    </div>
                  </td>
                  <td className="px-3.5 py-3 whitespace-nowrap">
                    <RowMenu
                      direction="up"
                      items={[
                        { icon: '✏️', label: 'Modifier', href: `/admin/facturation/devis/${d.id}` },
                        { icon: '📄', label: 'Voir le PDF', href: `/api/admin/facture/${d.id}` },
                        {
                          icon: '↪',
                          label: 'Convertir en facture',
                          onClick: () => setConfirmState({ kind: 'convert', devis: d }),
                          hidden: d.statut !== 'accepte' || dejaConverti,
                        },
                        {
                          icon: '✅',
                          label: 'Marquer accepté',
                          onClick: () => setConfirmState({ kind: 'accept', devis: d }),
                          hidden: d.statut !== 'envoyee',
                        },
                        {
                          icon: '❌',
                          label: 'Marquer refusé',
                          onClick: () => setConfirmState({ kind: 'refuse', devis: d }),
                          hidden: d.statut !== 'envoyee',
                        },
                        {
                          icon: '↩',
                          label: 'Remettre en brouillon',
                          onClick: () => setConfirmState({ kind: 'revert', devis: d }),
                          hidden: d.statut !== 'envoyee',
                        },
                        {
                          icon: '🗑️',
                          label: 'Supprimer',
                          onClick: () => setConfirmState({ kind: 'delete', devis: d }),
                          hidden: d.statut !== 'brouillon',
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
        title={confirmTitle(confirmState)}
        message={confirmMessage(confirmState)}
        confirmLabel={confirmLabel(confirmState)}
        destructive={confirmState?.kind === 'delete' || confirmState?.kind === 'refuse'}
        pending={pending}
        onConfirm={executeConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
