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
    '*': ['./src/lib/prompts/**/*.md', './src/lib/rapport/assets/**'],
  },
};

export default nextConfig;
