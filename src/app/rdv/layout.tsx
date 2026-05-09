import { VENDOR } from '@/lib/constants/vendor';

// Layout standalone /rdv : pas de sidebar/auth, pas de header — le hero
// navy (rendu par RdvClient) commence directement sous la barre d'URL
// du navigateur. Le footer légal sand-mid est conservé en bas de page.
//
// Note : la bande beige sable doré #E2C9A1 historique a été retirée
// (décision validée par Christophe — faisait redondance avec le hero
// navy puissant désormais en place). Les autres pages publiques sur
// fond sable doré (auth/login, /o/[token]) restent intactes — chacune
// a sa propre identité.
export default function RdvLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-sand)] text-[var(--color-ink)]">
      <main className="flex-1 w-full">
        {children}
      </main>

      {/* FOOTER légal sand-mid — typique des pages publiques pro
          (assureur / cabinet d'expertise). Liens légaux + coordonnées
          + mention BCE/TVA. */}
      <footer className="bg-[var(--color-sand-mid)] border-t border-[var(--color-sand-border)] py-6 px-4 mt-8">
        <div className="max-w-[1100px] mx-auto space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[13px] text-[var(--color-ink-mid)]">
            <div>
              <strong className="text-[var(--color-ink)] font-semibold">{VENDOR.name}</strong>
              {VENDOR.addressLine1 ? ` — ${VENDOR.addressLine1}, ${VENDOR.addressLine2}` : ''}
            </div>
            <div className="flex items-center gap-3">
              <a
                href={`tel:${VENDOR.phone.replace(/\s/g, '')}`}
                className="text-[var(--color-navy)] hover:text-[var(--color-navy-dark)] font-semibold min-h-[44px] inline-flex items-center transition-colors"
              >
                {VENDOR.phone}
              </a>
              <span className="text-[var(--color-ink-muted)]">·</span>
              <a
                href={`mailto:${VENDOR.email}`}
                className="text-[var(--color-navy)] hover:text-[var(--color-navy-dark)] font-semibold min-h-[44px] inline-flex items-center transition-colors"
              >
                {VENDOR.email}
              </a>
            </div>
          </div>
          {/* TODO design system : envisager d'ajouter ici des liens
              "Mentions légales" / "CGV" / "Confidentialité" si business
              validation OK — éviter d'implémenter sans accord Christophe
              (besoin pages dédiées + textes juridiques validés). */}
          <div className="text-[12px] text-[var(--color-ink-muted)] text-center sm:text-left">
            © {new Date().getFullYear()} {VENDOR.name} · BCE {VENDOR.bce} · TVA {VENDOR.vat}
          </div>
        </div>
      </footer>
    </div>
  );
}
