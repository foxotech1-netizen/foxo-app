import { Logo } from '@/components/Logo';
import { VENDOR } from '@/lib/constants/vendor';

// Layout standalone /rdv : pas de sidebar/auth, header public sable doré
// + main content + footer légal sand-mid.
//
// ⚠ Le HEADER sable doré #E2C9A1 est préservé volontairement comme
// élément public brand (mémoire projet — accord Christophe). C'est le
// signal de présence physique FoxO sur la page publique de prise de RDV.
//
// La règle navy plus présent qu'ailleurs s'applique sous ce header :
// hero gradient navy dans RdvClient, CTAs primaires navy plein, etc.
export default function RdvLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-sand)] text-[var(--color-ink)]">
      {/* HEADER public sable doré — préservé brand. */}
      <header
        className="border-b border-[rgba(0,0,0,0.12)] py-4 px-4 sticky top-0 z-40"
        style={{ background: '#E2C9A1' }}
      >
        <div className="max-w-[1100px] mx-auto flex items-center gap-3">
          <Logo size={44} variant="noir" priority />
          <div>
            <div className="font-sora text-[18px] font-semibold text-[var(--color-ink)] leading-none tracking-tight">
              FoxO
            </div>
            <div className="font-sora text-[11px] font-light text-[#7A6A50] mt-1 tracking-wide">
              Détection de fuites · Belgique
            </div>
          </div>
        </div>
      </header>

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
