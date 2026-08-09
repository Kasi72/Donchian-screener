import type { NextConfig } from "next";

const isE2eBuild = process.env.E2E_BUILD === "isolated-v1";

const nextConfig: NextConfig = {
  distDir: isE2eBuild ? ".next-e2e" : ".next",
  ...(isE2eBuild
    ? {
        turbopack: {
          resolveAlias: {
            "@/lib/market/provider-factory":
              "./lib/market/provider-factory.e2e.ts",
          },
        },
      }
    : {}),
};

export default nextConfig;
