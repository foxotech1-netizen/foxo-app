import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { VENDOR } from '@/lib/constants/vendor';

// Layout standalone : pas de sidebar/auth, header simple + footer.
export default function RdvLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-sand flex flex-col">
      <header
        className="border-b border-[rgba(0,0,0,0.12)] py-4 px-4 sticky top-0 z-40"
        style={{ background: '#E2C9A1' }}
      >
        <div className="max-w-[900px] mx-auto flex items-center gap-3">
          <Logo size={42} variant="black" priority />
          <div>
            <div className="text-base font-extrabold text-ink leading-none">FoxO</div>
            <div className="text-[10px] text-[#7A6A50] uppercase tracking-[.15em] font-semibold mt-1">
              Prendre rendez-vous
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-6 max-w-[900px] mx-auto w-full">
        {children}
      </main>

      <footer className="bg-cream border-t border-sand-border py-5 px-4 mt-8">
        <div className="max-w-[900px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[12px] text-ink-mid">
          <div>
            <strong className="text-ink">{VENDOR.name}</strong>
            {VENDOR.addressLine1 ? ` — ${VENDOR.addressLine1}, ${VENDOR.addressLine2}` : ''}
          </div>
          <div className="flex items-center gap-3">
            <a href={`tel:${VENDOR.phone.replace(/\s/g, '')}`} className="text-navy font-semibold">{VENDOR.phone}</a>
            <span>·</span>
            <a href={`mailto:${VENDOR.email}`} className="text-navy font-semibold">{VENDOR.email}</a>
          </div>
        </div>
        <div className="max-w-[900px] mx-auto text-[10px] text-ink-muted mt-2 text-center sm:text-left">
          BCE {VENDOR.bce} · TVA {VENDOR.vat}
        </div>
      </footer>
    </div>
  );
}
