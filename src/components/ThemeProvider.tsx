'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

// Wrapper qui force `attribute="class"` (next-themes pose .dark sur <html>),
// `defaultTheme="system"` (respecte prefers-color-scheme par défaut) et
// `enableSystem` (suit les changements OS si l'utilisateur n'a pas choisi).
type Props = ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({ children, ...rest }: Props) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange={false}
      {...rest}
    >
      {children}
    </NextThemesProvider>
  );
}
