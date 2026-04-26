import type { MetadataRoute } from 'next';

// PWA scopée à /tech : seul ce sous-domaine est installable comme app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FoxO Technicien',
    short_name: 'FoxO Tech',
    description: 'App technicien FoxO — interventions terrain',
    start_url: '/tech',
    scope: '/tech',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#080F1A',
    theme_color: '#1B3A6B',
    icons: [
      { src: '/foxo-logo-transparent.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/foxo-logo-transparent.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/foxo-logo-transparent.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    categories: ['business', 'productivity'],
    lang: 'fr-BE',
  };
}
