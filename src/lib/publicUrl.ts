/** Web address of the online copy of a lab report (the report QR code).
 * NEXT_PUBLIC_PUBLIC_SITE_URL names the hospital's website (needed in the
 * desktop app, whose own address a phone cannot open); otherwise the address
 * of the web version in use. Null when neither is known. */
export function publicReportUrl(token: string | null | undefined): string | null {
  if (!token) return null;
  const configured = (process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  let base = configured;
  if (!base && typeof window !== "undefined") {
    const { protocol, hostname, origin } = window.location;
    if (/^https?:$/.test(protocol) && hostname !== "tauri.localhost") base = origin;
  }
  return base ? `${base}/report/?t=${encodeURIComponent(token)}` : null;
}
