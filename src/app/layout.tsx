import type { Metadata } from 'next';
import { DM_Sans, DM_Mono, Syne, Sora, Inter } from 'next/font/google';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
});

// Syne — font display pour les titres (h1/h2). Appliquer manuellement
// via la classe utilitaire `.font-display` (cf. globals.css). Pas de
// remplacement global de `--font-sans` qui reste DM Sans pour le corps.
const syne = Syne({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-syne',
  display: 'swap',
});

// Sora — font display du nouveau design system FoxO (cf. FOXO_DESIGN_SYSTEM_PROMPT.md
// Phase 0). Utilisée pour titres de page, chiffres KPI, références dossier,
// valeurs numériques. À appliquer via classe `.font-sora`.
const sora = Sora({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sora',
  display: 'swap',
});

// Inter — font body du nouveau design system FoxO. Police par défaut
// du <body> (override DM Sans pour les pages refondues). Reste accessible
// explicitement via classe `.font-inter`.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FoxO',
  description: 'Détection de fuites non destructive — Belgique',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`${dmSans.variable} ${dmMono.variable} ${syne.variable} ${sora.variable} ${inter.variable}`}
    >
      <body className="min-h-full">
        {/* Identité visuelle FoxO unique (sand/cream/ink/navy/terra/
            amber-foxo/ok/sky-foxo) — plus de système de thèmes runtime. */}
        {children}
      </body>
    </html>
  );
}
