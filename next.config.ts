import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Photos jointes au formulaire RDV particulier (max 3 × 3MB ≈ 9MB)
      bodySizeLimit: '10mb',
    },
  },
  // S'assure que les assets lus via fs en runtime (system prompt .md, logo du
  // rapport) sont packagés avec les fonctions serveur (sinon fs échoue sur
  // Vercel).
  outputFileTracingIncludes: {
    '*': [
      './src/lib/prompts/**/*.md',
      './src/lib/rapport/assets/**',
      './src/lib/pdf/fonts/**',
      // Logos lus via fs par le moteur PDF (couverture + header) — les
      // fichiers public/ ne sont PAS embarqués dans les fonctions par défaut.
      './public/foxo-logo-blanc-transparent.png',
      './public/foxo-logo-transparent.png',
    ],
  },
  // En-têtes de sécurité HTTP (constat #12 audit sécurité 2026-06-10),
  // appliqués à toutes les routes.
  // - X-Frame-Options DENY : anti-clickjacking. L'app ne s'iframe nulle part
  //   (aucun <iframe> dans src/, l'aperçu PDF s'ouvre en nouvel onglet) → DENY
  //   est sûr.
  // - X-Content-Type-Options nosniff : empêche le MIME-sniffing (ex. PDF/JSON
  //   streamés réinterprétés en HTML).
  // - Referrer-Policy : ne fuit pas le chemin complet vers les origines tierces.
  // - HSTS : force HTTPS pendant 1 an (preload-ready).
  // Pas de Content-Security-Policy ici : à ajouter séparément en mode report
  // d'abord pour éviter toute casse.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
