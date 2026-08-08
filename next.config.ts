import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir:
    process.env.SCREENER_E2E_FIXTURES === "deterministic-v1"
      ? ".next-e2e"
      : ".next",
};

export default nextConfig;
