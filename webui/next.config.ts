import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this app when the parent repository has its own lockfile.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
