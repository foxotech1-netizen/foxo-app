'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

// 4 thèmes :
//   - sable    → light, palette FoxO d'origine (cream/navy/ambre)
//   - nuit     → dark,  palette FoxO d'origine
//   - ocean    → light, palette océan (#156082)
//   - ardoise  → dark,  palette ardoise + océan
//
// `value` mappe le nom du thème vers la classe posée sur <html>. Les
// thèmes "dark" doivent inclure la classe `.dark` pour que les
// utilitaires Tailwind `dark:` fonctionnent (Sable et Ocean = light,
// Nuit et Ardoise = dark).
//
// `storageKey` = clé localStorage. next-themes injecte un script avant
// le body qui lit cette clé et applique la classe → pas de FOUC.
type Props = ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({ children, ...rest }: Props) {
  return (
    <NextThemesProvider
      attribute="class"
      themes={['sable', 'nuit', 'ocean', 'ardoise']}
      defaultTheme="sable"
      enableSystem={false}
      storageKey="foxo-theme"
      value={{
        sable: 'theme-sable',
        nuit: 'dark theme-nuit',
        ocean: 'theme-ocean',
        ardoise: 'dark theme-ardoise',
      }}
      disableTransitionOnChange={false}
      {...rest}
    >
      {children}
    </NextThemesProvider>
  );
}
