'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { TYPE_CLIENT_LABEL, type Client, type TypeClient } from '@/lib/types/database';
import { RowMenu } from '@/components/RowMenu';
import { deleteClient } from '../facturation/actions';

const TYPE_FILTERS: ('tous' | TypeClient)[] = ['tous', 'acp', 'particulier', 'entreprise'];

function isFilterValue(v: string | null): v is typeof TYPE_FILTERS[number] {
  return v !== null && (TYPE_FILTERS as readonly string[]).includes(v);
}
// Couleurs des badges type — design tokens FoxO sémantiques.
const TYPE_COLORS: Record<TypeClient, string> = {
  acp:         'var(--color-navy)',
  particulier: 'var(--color-ok)',
  entreprise:  'var(--color-amber-foxo)',
};

export function ClientsListClient({ initial }: { initial: Client[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');

  function handleDelete(c: Client) {
    if (!confirm(`Désactiver ${c.nom} ? (les factures liées sont conservées)`)) return;
    startTransition(async () => {
      const res = await deleteClient(c.id);
      if (!res.ok) alert(res.error);
      else router.refresh();
    });
  }

  // Lecture du filtre initial depuis ?filter=<type> (ex: redirect post-
  // création ACP depuis le drawer syndic → /admin/clients?filter=acp).
  // Lazy init pour respecter React 19 strict (pas de setState dans useEffect).
  const queryFilter = searchParams.get('filter');
  const initialFilter: typeof TYPE_FILTERS[number] = isFilterValue(queryFilter) ? queryFilter : 'tous';
  const [filter, setFilter] = useState<typeof TYPE_FILTERS[number]>(initialFilter);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initial.filter((c) => {
      const matchQ = !q
        || c.nom.toLowerCase().includes(q)
        || (c.email ?? '').toLowerCase().includes(q)
        || (c.bce ?? '').toLowerCase().includes(q)
        || (c.ville ?? '').toLowerCase().includes(q);
      const matchT = filter === 'tous' || c.type === filter;
      return matchQ && matchT;
    });
  }, [initial, query, filter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/admin/clients/new"
          className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-xs font-medium shadow-sm transition-colors"
        >
          + Nouveau client
        </Link>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — nom, BCE, email, ville…"
          className="flex-1 min-w-[200px] px-3.5 py-2 border border-[var(--color-sand-border)] rounded-md text-xs bg-[var(--color-cream)] outline-none focus:border-[var(--color-navy-mid)] transition-colors"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2 border border-[var(--color-sand-border)] rounded-md text-xs bg-[var(--color-cream)] cursor-pointer outline-none focus:border-[var(--color-navy-mid)]"
        >
          <option value="tous">Tous types</option>
          {(['acp', 'particulier', 'entreprise'] as TypeClient[]).map((t) => (
            <option key={t} value={t}>{TYPE_CLIENT_LABEL[t]}</option>
          ))}
        </select>
      </div>

      <div className="bg-[var(--color-cream)] rounded-xl border border-[var(--color-sand-border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-[var(--color-sand)]">
                {['Nom', 'Type', 'Ville', 'Email', 'Téléphone', 'BCE', ''].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-medium text-[var(--color-ink-muted)] uppercase tracking-[0.12em] border-b border-[var(--color-sand-border)] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[var(--color-ink-muted)] text-[13px]">
                    Aucun client.
                  </td>
                </tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-sand-mid)] hover:bg-[var(--color-sand-hover)] transition-colors">
                  <td className="px-3.5 py-2.5">
                    <Link
                      href={`/admin/clients/${c.id}`}
                      className="text-[13px] font-medium text-[var(--color-navy)] hover:underline"
                    >
                      {[c.prenom, c.nom].filter(Boolean).join(' ')}
                    </Link>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className="inline-block text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded font-semibold text-[var(--color-cream)]"
                      style={{ background: TYPE_COLORS[c.type] }}
                    >
                      {TYPE_CLIENT_LABEL[c.type]}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-[12px] text-[var(--color-ink)]">
                    {[c.code_postal, c.ville].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-[var(--color-ink-mid)]">
                    {c.email ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-[var(--color-ink-mid)]">
                    {c.telephone ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-[var(--color-ink-mid)]">
                    {c.bce ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    <RowMenu
                      items={[
                        { icon: Pencil, label: 'Modifier', href: `/admin/clients/${c.id}` },
                        {
                          icon: Trash2,
                          label: 'Désactiver',
                          destructive: true,
                          disabled: pending,
                          onClick: () => handleDelete(c),
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
    </div>
  );
}
