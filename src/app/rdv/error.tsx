'use client';

// Écran de secours de la page publique /rdv. Ne devrait plus apparaître pour
// une soumission (l'action submitRdv ne lève jamais, et le formulaire capture
// les coupures réseau) : il couvre une erreur de rendu ou de chargement des
// disponibilités. Texte en clair, coordonnées de contact, pas de jargon.

import { useEffect } from 'react';
import { VENDOR } from '@/lib/constants/vendor';

export default function RdvError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[rdv] erreur de page :', error);
  }, [error]);

  return (
    <div className="px-4 sm:px-6 py-12 max-w-[1100px] mx-auto w-full">
      <div
        className="bg-[var(--color-cream)] rounded-card p-8 sm:p-10 text-center max-w-[560px] mx-auto"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <h1 className="font-sora text-[24px] sm:text-[28px] font-semibold text-[var(--color-ink)] tracking-tight">
          La page n&apos;a pas pu s&apos;afficher
        </h1>
        <p className="text-[15px] text-[var(--color-ink-mid)] mt-3 leading-relaxed">
          Un problème technique empêche d&apos;afficher le formulaire de rendez-vous.
          Réessayez dans un instant ou contactez-nous directement.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="min-h-[48px] px-6 py-3 rounded-lg text-[14px] font-semibold bg-[var(--color-navy)] text-[var(--color-cream)] hover:opacity-90 transition-opacity"
          >
            Réessayer
          </button>
          <a
            href={`tel:${VENDOR.phone.replace(/\s/g, '')}`}
            className="min-h-[48px] px-6 py-3 rounded-lg text-[14px] font-semibold border border-[var(--color-navy)] text-[var(--color-navy)] inline-flex items-center"
          >
            Appeler le {VENDOR.phone}
          </a>
        </div>
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-5">
          Ou par e-mail : <a href={`mailto:${VENDOR.email}`} className="underline">{VENDOR.email}</a>
        </p>
      </div>
    </div>
  );
}
