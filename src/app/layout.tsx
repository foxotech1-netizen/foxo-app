import type { Metadata } from 'next';
import { DM_Sans, DM_Mono, Syne, Sora, Inter } from 'next/font/google';
import { ThemeApplier, THEME_INIT_SCRIPT } from '@/components/ThemeApplier';
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
      suppressHydrationWarning
      className={`${dmSans.variable} ${dmMono.variable} ${syne.variable} ${sora.variable} ${inter.variable}`}
    >
      <head>
        {/* Script blocking pré-paint qui pose les CSS vars du thème
            (selon localStorage + portail courant) avant le 1er render
            React → évite le FOUC blanc et la transition de couleurs. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {/* Réapplique le thème par défaut du portail au changement de
            path (admin/tech/portal) — l'utilisateur peut override via
            ThemeSelector / ThemeToggle, persisté dans localStorage. */}
        <ThemeApplier />
        {children}
      </body>
    </html>
  );
}
