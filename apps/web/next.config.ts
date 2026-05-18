import type { NextConfig } from 'next';
import path from 'node:path';

// `output: 'standalone'` is required for the Docker build. On Windows hosts
// it fails because Next.js relies on symlinks for the standalone copy and
// non-admin Windows accounts lack `SeCreateSymbolicLinkPrivilege`. The
// Dockerfile sets STANDALONE_BUILD=true so production Linux builds keep
// the optimized standalone output; local Windows `pnpm build` works without.
const useStandalone = process.env.STANDALONE_BUILD === 'true';

const config: NextConfig = {
  reactStrictMode: true,
  ...(useStandalone ? { output: 'standalone' as const } : {}),
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Envuelve cada navegación cliente-side en startViewTransition() para
    // que las transiciones del cerebro (tabs) y entre lista/detalle de
    // memoria se animen suavemente con el view-transition CSS de globals.scss.
    viewTransition: true,
  },
  sassOptions: {
    includePaths: [path.join(process.cwd(), 'src/styles')],
  },
  serverExternalPackages: ['@node-rs/argon2'],
};

export default config;
