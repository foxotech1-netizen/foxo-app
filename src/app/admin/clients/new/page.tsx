import Link from 'next/link';
import { ClientForm } from '../ClientForm';

export const dynamic = 'force-dynamic';

export default function NewClientPage() {
  return (
    <>
      <div className="flex justify-between items-end mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <div>
          <h1 className="fxs-page-title mb-1">
            Nouveau client
          </h1>
        </div>
        <Link
          href="/admin/clients"
          className="text-[12px] text-[var(--color-ink-mid)] hover:text-[var(--color-navy)]"
        >
          ← Retour
        </Link>
      </div>
      <div>
        <ClientForm initial={null} />
      </div>
    </>
  );
}
