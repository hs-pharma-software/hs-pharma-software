/** The MAVIN desktop app (Electron) shows this same web app. Its preload
 * script exposes `window.mavinDesktop`; in a browser it is absent and none of
 * this changes anything. Online, server calls go through the desktop (which
 * keeps the session); offline, reads come from its read-only copy of this
 * business's data and cash sales go to its offline engine. */
import { useSyncExternalStore } from "react";

type Res<T> = { ok: true; value: T } | { ok: false; error: string };
export interface DesktopStatus {
  provisioned: boolean;
  online: boolean | null;
  deviceCode?: string;
  tenantName?: string | null;
  branchName?: string | null;
  allowanceEndsAt?: string | null;
  lastSyncOk?: string | null;
  lastError?: string | null;
  pending?: number;
  conflicts?: number;
  held?: number;
  rejected?: number;
  catalogReady?: boolean;
  copyRefreshedAt?: string | null;
  sellBlock?: string | null;
  server?: string;
  appVersion?: string;
}
export interface OfflineSaleInput {
  lines: { productId: string; unit: "pack" | "loose"; qty: number; discountPct: number }[];
  customerName: string | null;
  customerPhone: string | null;
  tendered: number;
}
export interface OfflineSaleResult { saleId: string; offlineRef: string; totals: { payable: number; change: number; tendered: number }; receipt: string }

interface Bridge {
  status(): Promise<Res<DesktopStatus>>;
  request(a: { path: string; method: string; body?: string; headers: Record<string, string> }): Promise<Res<{ status: number; body: string }>>;
  rememberSession(a: { username: string; password: string; session: unknown }): Promise<Res<{ provisioned: boolean }>>;
  offlineSignIn(a: { username: string; password: string }): Promise<Res<unknown>>;
  provision(a: { username: string; password: string; name?: string }): Promise<Res<{ deviceCode: string; tenantName: string; branchName: string }>>;
  query(a: { sql: string; params: unknown[] }): Promise<Res<Record<string, unknown>[]>>;
  createSale(a: OfflineSaleInput): Promise<Res<OfflineSaleResult>>;
  syncNow(): Promise<Res<DesktopStatus>>;
  printText(text: string): Promise<Res<boolean>>;
  onStatus(cb: (s: DesktopStatus) => void): () => void;
}

export function desktopBridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { mavinDesktop?: Bridge }).mavinDesktop ?? null;
}
export const isDesktopApp = () => desktopBridge() !== null;

export async function desktopCall<T>(fn: (b: Bridge) => Promise<Res<T>>): Promise<T> {
  const b = desktopBridge();
  if (!b) throw new Error("Only in the MAVIN desktop app.");
  const r = await fn(b);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

// ── Live status (connection, pending sync) ──

let current: DesktopStatus | null = null;
const listeners = new Set<() => void>();
let started = false;
function start() {
  const b = desktopBridge();
  if (!b || started) return;
  started = true;
  b.onStatus((s) => { current = s; listeners.forEach((l) => l()); });
  void b.status().then((r) => { if (r.ok) { current = r.value; listeners.forEach((l) => l()); } });
}

/** The desktop's current status (null in a browser). */
export function useDesktopStatus(): DesktopStatus | null {
  return useSyncExternalStore(
    (cb) => { start(); listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
    () => null,
  );
}

/** Offline now (desktop app without a connection). In a browser: never. */
export function desktopOffline(): boolean {
  return isDesktopApp() && current?.online === false;
}

/** Thrown for a change that needs the internet while the desktop is offline. */
export class NeedsInternetError extends Error {
  constructor(what = "This") {
    super(`${what} needs an internet connection. Offline, only cash sales are saved on this computer.`);
    this.name = "NeedsInternetError";
  }
}
