import Link from 'next/link';
import { cookies } from 'next/headers';
import { getCurrentSyndic } from '@/lib/portal/syndic';
import { normalizeLang, PORTAL_LANG_COOKIE, tFor } from '@/lib/portal/i18n';
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

  const lang = normalizeLang((await cookies()).get(PORTAL_LANG_COOKIE)?.value);
  const t = tFor(lang);

  if (!session.org) {
    return (
      <div className="bg-cream border border-sand-border rounded-2xl p-8 text-center">
        <h1 className="fxs-title-sm mb-2">{t('accountNotLinkedTitle')}</h1>
        <p className="text-sm text-ink-mid mb-3">
          {t('mustBeLinkedToCreate')}
        </p>
        <Link href="mailto:info@foxo.be" className="text-navy underline text-sm">
          {t('contactUsAt')}
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
