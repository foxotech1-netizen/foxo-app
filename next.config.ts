import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Photos jointes au formulaire RDV particulier (max 3 × 3MB ≈ 9MB)
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
