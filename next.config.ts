import type { NextConfig } from "next";

// Desktop builds use a static export (TAURI_BUILD=1). Tauri uses local SQLite;
// the Electron package builds this same UI in server mode and handles requests
// through its main process. Vercel runs Next.js normally with server features.
const isTauriBuild = process.env.TAURI_BUILD === "1";

const nextConfig: NextConfig = {
  ...(isTauriBuild
    ? {
        output: "export",
        distDir: "out",
        // Its own type check: the web dev server's route types (.next/dev) describe other routes.
        typescript: { tsconfigPath: "tsconfig.desktop.json" },
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
        // The Windows app: a fixed address on mavin.pk (the website button and
        // the app's own update check use it) sent on to wherever the files are
        // kept. Moving the files is a change of WINDOWS_DOWNLOAD_BASE only.
        async redirects() {
          const base = (process.env.WINDOWS_DOWNLOAD_BASE || "https://download.mavin.pk/windows").replace(/\/+$/, "");
          return [{ source: "/downloads/windows/:file", destination: `${base}/:file`, permanent: false }];
        },
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
