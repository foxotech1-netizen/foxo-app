// Page preview temporaire — à supprimer après décision sur les couleurs.
// Pas de proxy/auth (cf. proxy.ts bypass /preview/).

const NAV_ITEMS = [
  { icon: '▦', label: 'Pipeline', active: true },
  { icon: '◉', label: 'Alertes', badge: 2 },
  { icon: '▷', label: 'Planning' },
  { icon: '👥', label: 'Syndics' },
  { icon: '✉', label: 'Mails' },
];

const TECHNICIENS = [
  { initiales: 'CM', nom: 'C. Mertens' },
  { initiales: 'TR', nom: 'T. Renard' },
];

type SidebarVariant = {
  key: string;
  label: string;
  background: string;
  description: string;
  logoBg: string;
  logoLabelColor: string;
  navHoverBg: string;
  activeBg: string;
  activeFg: string;
  techAvatarBg: string;
};

const VARIANTS: SidebarVariant[] = [
  {
    key: 'current',
    label: 'A · Actuel (sable sombre)',
    background: 'linear-gradient(180deg, #2C2A24 0%, #1A1814 100%)',
    description: 'Production aujourd\'hui',
    logoBg: '#E2C9A1',
    logoLabelColor: '#7A6A50',
    navHoverBg: 'rgba(255,255,255,0.05)',
    activeBg: 'rgba(255,255,255,0.09)',
    activeFg: '#F0ECE4',
    techAvatarBg: '#3D3A32',
  },
  {
    key: 'olive-gradient',
    label: 'B · Olive gradient',
    background: 'linear-gradient(180deg, #5C5B3F 0%, #3F3E2A 100%)',
    description: 'Vert olive militaire, dégradé vers olive sombre',
    logoBg: '#E2C9A1',
    logoLabelColor: '#7A6A50',
    navHoverBg: 'rgba(255,255,255,0.06)',
    activeBg: 'rgba(255,255,255,0.10)',
    activeFg: '#F0ECE4',
    techAvatarBg: '#444331',
  },
  {
    key: 'olive-flat',
    label: 'C · Olive flat',
    background: '#5C5B3F',
    description: 'Olive solide, plus minéral',
    logoBg: '#E2C9A1',
    logoLabelColor: '#7A6A50',
    navHoverBg: 'rgba(255,255,255,0.06)',
    activeBg: 'rgba(255,255,255,0.10)',
    activeFg: '#F0ECE4',
    techAvatarBg: '#444331',
  },
  {
    key: 'olive-amber-accent',
    label: 'D · Olive + accent ambre',
    background: 'linear-gradient(180deg, #5C5B3F 0%, #3F3E2A 100%)',
    description: 'Olive avec ambre brûlé sur l\'item actif',
    logoBg: '#E2C9A1',
    logoLabelColor: '#A17244',
    navHoverBg: 'rgba(161,114,68,0.18)',
    activeBg: 'rgba(161,114,68,0.45)',
    activeFg: '#F0ECE4',
    techAvatarBg: '#A17244',
  },
];

export default function ThemePreview() {
  return (
    <div className="min-h-screen bg-sand py-10 px-4">
      <div className="max-w-[1400px] mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-extrabold text-ink">Aperçu charte FoxO</h1>
          <p className="text-sm text-ink-mid mt-2">
            Variantes de sidebar avec les nouvelles couleurs <Swatch hex="#5C5B3F" /> Vert olive
            et <Swatch hex="#A17244" /> Ambre brûlé. Page temporaire à <code>/preview/theme</code>.
          </p>
        </header>

        {/* Sidebars side-by-side */}
        <section className="mb-12">
          <h2 className="text-base font-bold text-ink mb-4">Sidebars</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            {VARIANTS.map((v) => (
              <div key={v.key}>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-bold mb-2">
                  {v.label}
                </div>
                <p className="text-[11px] text-ink-mid mb-2">{v.description}</p>
                <SidebarMockup variant={v} />
              </div>
            ))}
          </div>
        </section>

        {/* Ambre brûlé use cases */}
        <section className="mb-12">
          <h2 className="text-base font-bold text-ink mb-1">
            <Swatch hex="#A17244" /> Ambre brûlé — usages
          </h2>
          <p className="text-sm text-ink-mid mb-4">
            Accent secondaire entre le sand <Swatch hex="#E2C9A1" /> et le terra <Swatch hex="#C4622D" />.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <UsageCard title="Badge / pill">
              <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold text-white" style={{ background: '#A17244' }}>
                Particulier
              </span>
              <span className="inline-block ml-2 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: '#A17244', color: '#fff' }}>
                ⚡ Urgent
              </span>
            </UsageCard>

            <UsageCard title="Bouton secondaire">
              <button
                className="px-4 py-2 rounded-lg text-xs font-bold text-white"
                style={{ background: '#A17244' }}
              >
                Action chaude
              </button>
            </UsageCard>

            <UsageCard title="Avatar technicien">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: '#A17244' }}>
                  CM
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-ink">C. Mertens</div>
                  <div className="text-[11px] text-ink-muted">Technicien</div>
                </div>
              </div>
            </UsageCard>

            <UsageCard title="Lien souligné">
              <a className="font-semibold underline underline-offset-4" style={{ color: '#A17244', textDecorationThickness: '2px' }}>
                Voir le rapport →
              </a>
            </UsageCard>

            <UsageCard title="Bordure / focus">
              <input
                placeholder="Zone d'emphase"
                readOnly
                className="w-full px-3 py-2 rounded-lg text-[12px] outline-none"
                style={{ background: '#FDFBF7', border: '2px solid #A17244', color: '#1C1A16' }}
              />
            </UsageCard>

            <UsageCard title="Étiquette de section">
              <div className="text-[10px] uppercase tracking-[.15em] font-bold" style={{ color: '#A17244' }}>
                Interface Admin
              </div>
            </UsageCard>
          </div>
        </section>

        {/* Swatches */}
        <section className="mb-12">
          <h2 className="text-base font-bold text-ink mb-4">Palette complète</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <BigSwatch hex="#1B3A6B" name="Navy" usage="Primary" />
            <BigSwatch hex="#A8D4E8" name="Sky" usage="Accent froid" />
            <BigSwatch hex="#E2C9A1" name="Sand gold" usage="Logo zone" />
            <BigSwatch hex="#A17244" name="Ambre brûlé" usage="Accent chaud" highlight />
            <BigSwatch hex="#C4622D" name="Terra" usage="Alerte" />
            <BigSwatch hex="#5C5B3F" name="Olive" usage="Sidebar option" highlight />
            <BigSwatch hex="#2C2A24" name="Sand dark" usage="Sidebar actuel" />
            <BigSwatch hex="#F5F2EC" name="Sand" usage="Page bg" border />
            <BigSwatch hex="#FDFBF7" name="Cream" usage="Card bg" border />
            <BigSwatch hex="#1F6B45" name="Ok" usage="Succès" />
          </div>
        </section>

        {/* Décision */}
        <section className="bg-cream border border-sand-border rounded-2xl p-6">
          <h2 className="text-base font-bold text-ink mb-2">Quelle option appliquer ?</h2>
          <p className="text-sm text-ink-mid leading-relaxed mb-2">
            Dis-moi simplement <strong>"applique l'option A/B/C/D"</strong> pour la sidebar, et où tu veux
            voir l'ambre <Swatch hex="#A17244" /> dans le reste de l'app (badge particulier, label
            "Interface Admin", avatars, boutons secondaires, etc.). Je supprime cette page après.
          </p>
          <p className="text-[11px] text-ink-muted">
            Aucune couleur n'a été appliquée hors de cette page.
          </p>
        </section>
      </div>
    </div>
  );
}

function Swatch({ hex }: { hex: string }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-sm align-middle mx-1 border border-black/10"
      style={{ background: hex }}
    />
  );
}

function BigSwatch({ hex, name, usage, highlight, border }: { hex: string; name: string; usage: string; highlight?: boolean; border?: boolean }) {
  return (
    <div className={'rounded-xl overflow-hidden ' + (highlight ? 'ring-2 ring-[#1B3A6B]' : '')}>
      <div className="h-20" style={{ background: hex, border: border ? '1px solid #DDD8CC' : undefined }} />
      <div className="p-2.5 bg-cream border border-sand-border border-t-0 rounded-b-xl">
        <div className="text-[12px] font-bold text-ink">{name}</div>
        <div className="text-[10px] font-mono text-ink-mid">{hex}</div>
        <div className="text-[10px] text-ink-muted mt-0.5">{usage}</div>
      </div>
    </div>
  );
}

function UsageCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-cream border border-sand-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted font-bold mb-3">{title}</div>
      {children}
    </div>
  );
}

function SidebarMockup({ variant: v }: { variant: SidebarVariant }) {
  return (
    <div
      className="rounded-xl overflow-hidden border border-sand-border"
      style={{ width: 220, background: v.background }}
    >
      {/* Logo zone */}
      <div
        className="px-4 pt-5 pb-4 flex flex-col items-center gap-2"
        style={{ background: v.logoBg, borderBottom: '1px solid rgba(0,0,0,0.12)' }}
      >
        <div className="w-[60px] h-[60px] rounded-full bg-white/30 flex items-center justify-center text-[22px] font-extrabold" style={{ color: '#1B3A6B' }}>
          F
        </div>
        <div
          className="text-[10px] uppercase tracking-[.15em] font-semibold"
          style={{ color: v.logoLabelColor }}
        >
          Interface Admin
        </div>
      </div>

      {/* Nav */}
      <nav className="p-2.5 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = item.active;
          return (
            <div
              key={item.label}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[13px]"
              style={{
                color: active ? v.activeFg : '#8A8278',
                background: active ? v.activeBg : 'transparent',
                fontWeight: active ? 600 : 400,
              }}
            >
              <span className="flex items-center gap-2">
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {item.badge && (
                <span className="rounded-full text-[10px] font-bold px-1.5 py-0.5 leading-none text-white" style={{ background: '#C4622D' }}>
                  {item.badge}
                </span>
              )}
            </div>
          );
        })}
      </nav>

      {/* Techniciens */}
      <div className="px-4 pt-3 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="text-[9px] uppercase tracking-wider font-bold mb-3" style={{ color: '#7A7468' }}>
          Techniciens
        </div>
        <div className="space-y-2.5">
          {TECHNICIENS.map((t) => (
            <div key={t.initiales} className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-[#C0BAB0]" style={{ background: v.techAvatarBg }}>
                {t.initiales}
              </div>
              <div>
                <div className="text-[11px] font-semibold text-[#C0BAB0]">{t.nom}</div>
                <div className="text-[10px] text-[#5A5650]">En ligne</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
