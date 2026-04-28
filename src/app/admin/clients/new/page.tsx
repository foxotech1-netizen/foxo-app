import Link from 'next/link';
import { ClientForm } from '../ClientForm';

export const dynamic = 'force-dynamic';

export default function NewClientPage() {
  return (
    <>
      <header className="px-6 py-4 flex items-center justify-between bg-sand border-b border-sand-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-ink">Nouveau client</h1>
        </div>
        <Link
          href="/admin/clients"
          className="text-[12px] text-ink-mid hover:text-navy dark:text-[#C8C2B8]"
        >
          ← Retour
        </Link>
      </header>
      <div className="flex-1 overflow-auto px-6 py-5">
        <ClientForm initial={null} />
      </div>
    </>
  );
}
