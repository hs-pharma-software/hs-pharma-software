/** App wiring for the Wholesaler / Distributor module. Works in the desktop
 * app (local SQLite, synced) and in the web build (talks to Turso directly),
 * which is what salesmen use on their phones for location sharing. */
import { dbExecute, dbSelect } from "@/lib/db";
import { recordOutbox } from "@/lib/sync/outbox";
import { newId } from "@/lib/id";
import { isTauriShell } from "@/lib/platform";
import { restaurantContext } from "@/lib/restaurant";
import { createDistStore, DistError, DIST_TYPE, type AtlVerifier } from "./store.ts";
import { serverJson } from "@/lib/serverMode";
import { offlineCapable } from "@/lib/offline/moduleCalls";

export { DIST_TYPE };

export const dist = offlineCapable("dist", createDistStore(
  {
    select: dbSelect,
    async execute(sql, params) {
      const r = await dbExecute(sql, params);
      return { changes: r.rowsAffected };
    },
    outbox: recordOutbox,
    newId,
    now: () => new Date(),
  },
  // Same session rules as the other modules (tenant + role from the signed-in user).
  restaurantContext
));

export function errorText(e: unknown): string {
  return e instanceof DistError || e instanceof Error ? e.message : String(e);
}

/** FBR's own Active Taxpayer check (STATL, DI API) with the business's FBR
 * token: through MAVIN's server (and gateway), or from this browser in
 * direct mode, as invoices go. An answer other than Active / In-Active is an
 * error, so the customer is never marked active by guess. */
export const fbrAtlVerifier: AtlVerifier = {
  name: "FBR STATL (DI API)",
  async check(identifier: string) {
    const regno = identifier.replace(/\D/g, "").length === 8 ? identifier.replace(/\D/g, "").slice(0, 7) : identifier.replace(/\D/g, "");
    const r = await serverJson<{ direct: boolean; status?: "active" | "inactive" | null; date?: string; token?: string; path?: string; payload?: { regno: string; date: string } }>("/api/fbr/", { action: "atl", regno });
    let status = r.status ?? null;
    let date = r.date ?? "";
    if (r.direct && r.token && r.path && r.payload) {
      const res = await fetch(`https://gw.fbr.gov.pk${r.path}`, { method: "POST", headers: { Authorization: `Bearer ${r.token}`, "Content-Type": "application/json" }, body: JSON.stringify(r.payload) });
      if (res.status === 401 || res.status === 403) throw new Error(`FBR refused the check (HTTP ${res.status}): check the FBR token in Settings > FBR.`);
      status = parseAtlAnswer(await res.text());
      date = r.payload.date;
    }
    if (!status) throw new Error("FBR did not answer Active or In-Active for this number.");
    return { status, reference: `FBR STATL ${regno} on ${date}` };
  },
};

function parseAtlAnswer(body: string): "active" | "inactive" | null {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const s = String(j.status ?? j.Status ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
    return s === "active" ? "active" : s === "inactive" ? "inactive" : null;
  } catch {
    return null;
  }
}

// ── Device location ───────────────────────────────────────────────────

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: string;
}

/** Human message for a geolocation failure (never a made-up position). */
export function geoErrorText(e: GeolocationPositionError | Error | unknown): string {
  const code = (e as GeolocationPositionError)?.code;
  if (code === 1) return "Location permission was denied. Allow location for this app/site in the browser or phone settings, or place the pin on the map manually (if you are allowed to).";
  if (code === 2) return "The device could not determine a location (GPS / network unavailable). Move to open sky or turn on location services.";
  if (code === 3) return "Getting a location timed out. Try again outside or with GPS turned on.";
  if (typeof navigator !== "undefined" && !("geolocation" in navigator)) return "This device / browser has no location service.";
  return e instanceof Error ? e.message : "Location is unavailable.";
}

export function getFix(timeoutMs = 20000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new Error(geoErrorText(new Error("no geolocation"))));
    if (typeof window !== "undefined" && !window.isSecureContext) return reject(new Error("Location needs a secure (https) page."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null, at: new Date(p.timestamp).toISOString() }),
      (e) => reject(new Error(geoErrorText(e))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export async function openMaps(lat: number, lng: number) {
  const url = mapsLink(lat, lng);
  if (isTauriShell()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}

/** Browser key for the Maps JavaScript API (restrict it by HTTP referrer and
 * to the Maps JavaScript API in Google Cloud). Server secrets never go here. */
export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
