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
        // API routes (src/app/api/**/route.server.ts) exist only in the web
        // build; the desktop static export above leaves them out.
        // and so do the public site pages (src/app/site/**/page.server.tsx) and
        // src/proxy.server.ts.
        pageExtensions: ["tsx", "ts", "jsx", "js", "server.ts", "server.tsx"],
        // The Android app (versioned file names, never replaced): saved as a
        // file with the APK type, cached for good.
        async headers() {
          return [{
            source: "/downloads/android/:file*",
            headers: [
              { key: "Content-Type", value: "application/vnd.android.package-archive" },
              { key: "Content-Disposition", value: "attachment" },
              { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
              { key: "X-Content-Type-Options", value: "nosniff" },
            ],
          }];
        },
      }),
};

export default nextConfig;
