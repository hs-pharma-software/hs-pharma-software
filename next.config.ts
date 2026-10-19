import type { NextConfig } from "next";

// When building for the Tauri desktop shell (TAURI_BUILD=1), produce a fully
// static export — no Node server, data goes through the local SQLite plugin.
// When deploying to Vercel (no TAURI_BUILD), let Next.js run normally so
// server features (ISR, image optimisation, etc.) stay available and the
// browser talks to Turso directly via @libsql/client/web.
const isTauriBuild = process.env.TAURI_BUILD === "1";

const nextConfig: NextConfig = {
  ...(isTauriBuild
    ? {
        output: "export",
        distDir: "out",
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {
        images: { unoptimized: true },
        trailingSlash: true,
      }),
};

export default nextConfig;
