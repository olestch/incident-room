import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep the dev-tools badge out of native pointer interactions in the dev harness.
  // Next still surfaces compile/runtime error overlays with devIndicators disabled.
  ...(process.env.INCIDENT_ROOM_DEV_E2E === '1' ? { devIndicators: false as const } : {}),
};

export default nextConfig;
