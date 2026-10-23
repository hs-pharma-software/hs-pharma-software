/** App wiring for the Electric / Electronics / Solar store module. */
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { dbExecute, dbSelect } from "@/lib/db";
import { recordOutbox } from "@/lib/sync/outbox";
import { newId, nowIso } from "@/lib/id";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { restaurantContext } from "@/lib/restaurant";
import { PAPERS, type PaperSize } from "@/lib/printTemplates";
import { createElectricStore, EsError } from "./store.ts";
import { isJameelNoori, readFontNames } from "./fontName.ts";

export const ELECTRIC_TYPE = "electronics_solar";

export const electric = createElectricStore(
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
  // Same session rules as the restaurant module (tenant, role, denials).
  restaurantContext
);

export const isElectricSession = () => businessType(useAuthStore.getState().currentTenant?.businessType).id === ELECTRIC_TYPE;

export function errorText(e: unknown): string {
  return e instanceof EsError || e instanceof Error ? e.message : String(e);
}

// ── Urdu font (device-only; the store supplies its own licensed file) ──

const FONT_KEY = "font:jameel-noori-nastaleeq";
export const JAMEEL_FAMILY = "Jameel Noori Nastaleeq";

interface FontState {
  status: "unknown" | "loaded" | "missing" | "error";
  detail: string | null;
  set: (s: FontState["status"], detail?: string | null) => void;
}

export const useUrduFont = create<FontState>()((set) => ({ status: "unknown", detail: null, set: (status, detail = null) => set({ status, detail }) }));

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufferToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Registers the stored Jameel font with the browser (and so the PDF engine). */
export async function loadUrduFont(): Promise<void> {
  const st = useUrduFont.getState();
  try {
    const rows = await dbSelect<{ data: string }>(`SELECT data FROM local_assets WHERE key = ?`, [FONT_KEY]);
    if (!rows[0]) return st.set("missing", "Jameel Noori Nastaleeq has not been added on this computer.");
    const face = new FontFace(JAMEEL_FAMILY, b64ToBuffer(rows[0].data), { weight: "400", style: "normal" });
    await face.load();
    document.fonts.add(face);
    st.set("loaded", null);
  } catch (e) {
    st.set("error", e instanceof Error ? e.message : String(e));
  }
}

/** Checks the file is a TTF/OTF whose internal name is Jameel Noori
 * Nastaleeq, stores it on this computer only, and loads it. */
export async function installUrduFont(file: File): Promise<{ family: string | null }> {
  if (file.size > 15 * 1024 * 1024) throw new Error("Font file is too large.");
  const buf = await file.arrayBuffer();
  const names = readFontNames(buf);
  if (!isJameelNoori(names)) throw new Error(`This font is "${names.full ?? names.family ?? "unknown"}", not Jameel Noori Nastaleeq.`);
  await dbExecute(
    `INSERT INTO local_assets (key, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, mime = excluded.mime, updated_at = excluded.updated_at`,
    [FONT_KEY, file.type || "font/ttf", bufferToB64(buf), nowIso()]
  );
  await loadUrduFont();
  return { family: names.family };
}

export async function removeUrduFont() {
  await dbExecute(`DELETE FROM local_assets WHERE key = ?`, [FONT_KEY]);
  useUrduFont.getState().set("missing", "Removed. Restart the app to unload it completely.");
}

// ── Document output: PDF, sharing ──

const PX_PER_MM = 96 / 25.4;

/** Saves the visible `.print-area` as a PDF chosen by the user. */
export async function exportPdf(fileName: string, paper: PaperSize, area: HTMLElement | null): Promise<string | null> {
  const p = PAPERS.find((x) => x.id === paper)!;
  const path = await saveDialog({ defaultPath: fileName, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return null;
  if (area) {
    await document.fonts.ready;
    await Promise.all(Array.from(area.querySelectorAll("img")).filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; })));
  }
  const heightMm = paper === "a4" ? 297 : paper === "a5" ? 210 : Math.ceil((area?.scrollHeight ?? 600) / PX_PER_MM) + p.marginMm * 2 + 5;
  await invoke("print_to_pdf", { path, widthMm: p.widthMm, heightMm, marginMm: p.marginMm });
  return path;
}

export const openPdf = (path: string) => openPath(path);
export const showInFolder = (path: string) => revealItemInDir(path);

/** wa.me link with the invoice summary (WhatsApp links can't attach files;
 * the saved PDF is attached by the user from its folder). */
export async function shareWhatsApp(phone: string | null, countryCode: string, text: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const intl = digits.startsWith("0") ? `${countryCode}${digits.slice(1)}` : digits;
  await openUrl(`https://wa.me/${intl}?text=${encodeURIComponent(text)}`);
}

export async function shareEmail(subject: string, body: string) {
  await openUrl(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
}

export { newId };
