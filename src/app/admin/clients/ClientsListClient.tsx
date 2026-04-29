'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TYPE_CLIENT_LABEL, type Client, type TypeClient } from '@/lib/types/database';
import { RowMenu } from '@/components/RowMenu';
import { deleteClient } from '../facturation/actions';

const TYPE_FILTERS: ('tous' | TypeClient)[] = ['tous', 'acp', 'particulier', 'entreprise'];
const TYPE_COLORS: Record<TypeClient, string> = {
  acp: '#1B3A6B',
  particulier: '#1F6B45',
  entreprise: '#A17244',
};

export function ClientsListClient({ initial }: { initial: Client[] }) {
  const router = useRouter();
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
  const [filter, setFilter] = useState<typeof TYPE_FILTERS[number]>('tous');

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
          className="bg-navy text-white px-3.5 py-2 rounded-lg text-xs font-bold hover:opacity-90"
        >
          + Nouveau client
        </Link>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher — nom, BCE, email, ville…"
          className="flex-1 min-w-[200px] px-3.5 py-2 border border-sand-border rounded-lg text-xs bg-cream outline-none focus:border-navy-mid"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2 border border-sand-border rounded-lg text-xs bg-cream cursor-pointer"
        >
          <option value="tous">Tous types</option>
          {(['acp', 'particulier', 'entreprise'] as TypeClient[]).map((t) => (
            <option key={t} value={t}>{TYPE_CLIENT_LABEL[t]}</option>
          ))}
        </select>
      </div>

      <div className="bg-cream rounded-xl border border-sand-border overflow-hidden dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[760px]">
            <thead>
              <tr className="bg-sand dark:bg-[#221E1A]">
                {['Nom', 'Type', 'Ville', 'Email', 'Téléphone', 'BCE', ''].map((h) => (
                  <th key={h} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-sand-border whitespace-nowrap dark:text-[#C8C2B8] dark:border-[#3D3A32]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-ink-muted text-[13px] dark:text-[#C8C2B8]">
                    Aucun client.
                  </td>
                </tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="border-b border-sand-mid hover:bg-sand-hover dark:border-[#3D3A32] dark:hover:bg-[#2A2520]">
                  <td className="px-3.5 py-2.5">
                    <Link
                      href={`/admin/clients/${c.id}`}
                      className="text-[13px] font-bold text-navy hover:underline dark:text-[#A8C4F2]"
                    >
                      {[c.prenom, c.nom].filter(Boolean).join(' ')}
                    </Link>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded text-white"
                      style={{ background: TYPE_COLORS[c.type], fontWeight: 600 }}
                    >
                      {TYPE_CLIENT_LABEL[c.type]}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-[12px] dark:text-[#C8C2B8]">
                    {[c.code_postal, c.ville].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid dark:text-[#C8C2B8]">
                    {c.email ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid dark:text-[#C8C2B8]">
                    {c.telephone ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] font-mono text-ink-mid dark:text-[#C8C2B8]">
                    {c.bce ?? '—'}
                  </td>
                  <td className="px-3.5 py-2.5 whitespace-nowrap">
                    <RowMenu
                      items={[
                        { icon: '✏️', label: 'Modifier', href: `/admin/clients/${c.id}` },
                        {
                          icon: '🗑️',
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
