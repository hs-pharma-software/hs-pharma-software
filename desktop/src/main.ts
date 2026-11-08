/** MAVIN Offline (pilot): Electron main process.
 *
 * - The window is locked down: context isolation, no Node in the page, sandbox,
 *   a strict Content-Security-Policy, no navigation and no new windows.
 * - The page reaches the device only through the validated calls below; it
 *   never sees SQL, files, the device key or the session token.
 * - Data lives in the user's app-data folder (survives updates and uninstall);
 *   the device key is protected by Windows (DPAPI, via safeStorage). */
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OfflineDevice, TransportError, type SaleInput, type SecretStore, type Transport } from "./core/device";

const API_BASE = (process.env.MAVIN_API_BASE || "https://app.mavin.pk").replace(/\/+$/, "");
const SYNC_EVERY_MS = 60_000;

if (!app.requestSingleInstanceLock()) app.quit(); // one process per Windows user: one writer of the database

const dataRoot = app.getPath("userData");
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..", "resources");

/** Secrets encrypted by Windows for this user account (safeStorage = DPAPI). */
const secrets: SecretStore = {
  get(name) {
    const f = join(dataRoot, "secrets", `${name}.bin`);
    if (!existsSync(f) || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(readFileSync(f)); } catch { return null; }
  },
  set(name, value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is not available for this account; the device cannot be set up.");
    mkdirSync(join(dataRoot, "secrets"), { recursive: true });
    writeFileSync(join(dataRoot, "secrets", `${name}.bin`), safeStorage.encryptString(value));
  },
};

const transport: Transport = {
  async post<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch {
      throw new TransportError("No connection", null);
    } finally {
      clearTimeout(timer);
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new TransportError(data?.error ?? `MAVIN.pk answered ${res.status}`, res.status);
    if (data === null) throw new TransportError("No connection", null);
    return data;
  },
};

let device: OfflineDevice;
let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600, title: "MAVIN Offline",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.removeMenu();
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(app|www)\.mavin\.pk\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

// ── Validated calls from the page ─────────────────────────────────────────

const str = (v: unknown, max: number, what: string) => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error(`Enter the ${what}.`);
  return v;
};
const optStr = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function saleInput(v: unknown): SaleInput {
  const o = v as Record<string, unknown>;
  if (!o || !Array.isArray(o.lines) || o.lines.length < 1 || o.lines.length > 100) throw new Error("Add at least one product.");
  return {
    lines: o.lines.map((l) => {
      const x = l as Record<string, unknown>;
      return { productId: str(x.productId, 64, "product"), unit: x.unit === "loose" ? "loose" : "pack", qty: Number(x.qty), discountPct: Number(x.discountPct) || 0 };
    }),
    customerName: optStr(o.customerName, 120), customerPhone: optStr(o.customerPhone, 30), tendered: Number(o.tendered),
  };
}

type Handler = (arg: unknown) => unknown;
const handlers: Record<string, Handler> = {
  status: () => ({ ...device.status(), server: API_BASE, appVersion: app.getVersion() }),
  provision: (a) => {
    const o = a as Record<string, unknown>;
    return device.provision(str(o?.username, 80, "username"), str(o?.password, 200, "password"), { name: optStr(o?.name, 60) ?? undefined });
  },
  signIn: (a) => { const o = a as Record<string, unknown>; return device.signIn(str(o?.username, 80, "username"), str(o?.password, 200, "password")); },
  signOut: () => device.signOut(),
  search: (a) => device.search(str(a, 80, "search"), 30),
  createSale: (a) => device.createSale(saleInput(a)),
  sync: () => device.sync({ manual: true }),
  recentSales: () => device.recentSales(50),
  receipt: (a) => device.receipt(str(a, 64, "sale")),
  print: (a) => printReceipt(device.receipt(str(a, 64, "sale"))),
  diagnostics: () => device.diagnostics(),
  backup: () => device.backupNow(),
  online: () => device.sync({ manual: true }),
};

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`mavin:${name}`, async (e, arg) => {
    if (e.senderFrame?.url && !e.senderFrame.url.startsWith("file://")) throw new Error("Not allowed.");
    try {
      return { ok: true, value: await fn(arg) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** Prints the receipt text through a hidden window (the Windows print dialog). */
async function printReceipt(text: string) {
  const p = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  const esc = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  await p.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>@page{margin:4mm}body{margin:0;font:12px/1.35 Consolas,monospace;white-space:pre}</style><body>${esc}</body>`)}`);
  await new Promise<void>((resolve, reject) => p.webContents.print({ silent: false, printBackground: false }, (ok, why) => (ok || why === "cancelled" ? resolve() : reject(new Error(why)))));
  p.destroy();
  return true;
}

app.whenReady().then(() => {
  device = new OfflineDevice({
    dataRoot, publicKeyPem: readFileSync(join(resources, "offline-public.pem"), "utf8"), appVersion: app.getVersion(), transport, secrets,
  });
  createWindow();
  // Background sync; repeated failures wait longer (see OfflineDevice.backoff).
  setInterval(() => { if (device.provisioned) void device.sync(); }, SYNC_EVERY_MS);
  if (device.provisioned) void device.sync();
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => { device?.close(); app.quit(); });
