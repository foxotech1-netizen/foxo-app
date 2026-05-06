import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { NewRequestClient } from './NewRequestClient';

export const dynamic = 'force-dynamic';

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; heure?: string }>;
}) {
  const sp = await searchParams;
  const session = await getCurrentSyndic();
  if (!session) return null;

  // Defensive : les experts n'ont pas accès à la création de demande
  // (le CTA est masqué dans la nav mais on protège l'URL en cas
  // d'accès direct manuel).
  if (session.org?.type === 'expert') {
    redirect('/portal');
  }

  if (!session.org) {
    return (
      <div className="bg-cream border border-sand-border rounded-2xl p-8 text-center">
        <h1 className="text-xl font-extrabold text-ink mb-2">Compte non lié</h1>
        <p className="text-sm text-ink-mid mb-3">
          Vous devez être associé à un syndic ou un courtier pour créer une demande.
        </p>
        <Link href="mailto:info@foxo.be" className="text-navy underline text-sm">
          Contactez info@foxo.be
        </Link>
      </div>
    );
  }

  // Pré-remplir facturation avec les infos de l'org connectée
  const billingDefault = {
    nom: session.org.nom,
    email: session.org.email,
    bce: session.org.bce ?? '',
  };

  return (
    <NewRequestClient
      preselectedDate={sp.date ?? null}
      preselectedHeure={sp.heure ?? null}
      billingDefault={billingDefault}
    />
  );
}
