import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Photos jointes au formulaire RDV particulier (max 3 × 3MB ≈ 9MB)
      bodySizeLimit: '10mb',
    },
  },
  // S'assure que le .md du system prompt FoxO est packagé avec les fonctions
  // serveur (sinon fs.readFileSync échoue en runtime sur Vercel).
  outputFileTracingIncludes: {
    '*': ['./src/lib/prompts/**/*.md'],
  },
};

export default nextConfig;
