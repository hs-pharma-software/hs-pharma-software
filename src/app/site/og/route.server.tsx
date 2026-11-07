/** Share preview image (1200x630) for the public website: the page's title on
 * the MAVIN.pk brand colours. Served at www.mavin.pk/og/?t=<title>. */
import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const t = (new URL(req.url).searchParams.get("t") ?? "").replace(/\s+/g, " ").trim().slice(0, 90) || "POS & Business Software in Pakistan";
  const img = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "linear-gradient(135deg, #071640 0%, #0b2a6b 55%, #1565c0 100%)", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>
          MAVIN<span style={{ color: "#5ec8ff" }}>.pk</span>
        </div>
        <div style={{ display: "flex", fontSize: t.length > 50 ? 58 : 68, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1000 }}>{t}</div>
        <div style={{ display: "flex", fontSize: 28, color: "#cfe3ff" }}>Pharmacy · Retail · Clinic · Lab · Restaurant · Distribution · FBR Digital Invoicing</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
  img.headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800");
  return img;
}
