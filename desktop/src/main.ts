/** MAVIN desktop: Electron main process.
 *
 * The window shows the MAVIN web app itself (bundled, served from
 * mavin://app/), so screens, menus and shortcuts are the same as on the web.
 * - Online: the page's server calls go through here to MAVIN.pk; the session
 *   cookie stays here (Windows-protected), never in the page.
 * - Offline: the page reads a read-only copy of this business's data (same
 *   structure as the server's database) and saves cash sales through the
 *   offline engine (core/device.ts): one local transaction each, sent to the
 *   server exactly once when the connection returns.
 * The window is locked down: context isolation, no Node in the page, sandbox,
 * no navigation away from the app, a fixed list of validated calls. */
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { OfflineDevice, TransportError, type OriginalInvoice, type SaleInput, type SecretStore, type Transport } from "./core/device";
import { Mirror, readOnlySql } from "./core/mirror";

const API_BASE = (process.env.MAVIN_API_BASE || "https://app.mavin.pk").replace(/\/+$/, "");
const SYNC_EVERY_MS = 60_000;
const PROBE_EVERY_MS = 15_000;
const MIRROR_EVERY_MS = 5 * 60_000;
/** Copied in full each time (small: catalogue, people, settings). */
const MIRROR_TABLES = ["tenants", "branches", "settings", "users", "categories", "sub_categories", "uoms", "products", "price_list", "product_batches", "customers", "salesmen", "suppliers"];
/** Recent history of this branch (the server's window), only what changed. Documents before their items. */
const HISTORY_TABLES = ["invoices", "invoice_items", "purchases", "purchase_items", "expenses", "cash_register_entries", "ledger_adjustments"];
const APP_ORIGIN = "mavin://app";

protocol.registerSchemesAsPrivileged([{ scheme: "mavin", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

/** Development only (never in the installed app): a separate data folder for
 * test runs (set before the instance lock, which belongs to the folder). */
if (!app.isPackaged && process.env.MAVIN_DATA_DIR) app.setPath("userData", process.env.MAVIN_DATA_DIR);
const dataRoot = app.getPath("userData");

/** One process per Windows user: one writer of the database. A second copy
 * hands over to the first (which shows its window) and exits at once. */
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..", "resources");
const webRoot = app.isPackaged ? join(process.resourcesPath, "web") : join(__dirname, "..", "..", "out");
/** Development only (never in the installed app): a test server's public key. */
const publicKeyFile = !app.isPackaged && process.env.MAVIN_PUBLIC_KEY_FILE ? process.env.MAVIN_PUBLIC_KEY_FILE : join(resources, "offline-public.pem");

/** Secrets encrypted by Windows for this user account (safeStorage = DPAPI). */
const secrets: SecretStore & { del(name: string): void } = {
  get(name) {
    const f = join(dataRoot, "secrets", `${name}.bin`);
    if (!existsSync(f) || !safeStorage.isEncryptionAvailable()) return null;
    try { return safeStorage.decryptString(readFileSync(f)); } catch { return null; }
  },
  set(name, value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is not available for this account.");
    mkdirSync(join(dataRoot, "secrets"), { recursive: true });
    writeFileSync(join(dataRoot, "secrets", `${name}.bin`), safeStorage.encryptString(value));
  },
  del(name) { try { writeFileSync(join(dataRoot, "secrets", `${name}.bin`), Buffer.alloc(0)); } catch { /* none */ } },
};

// ── Connection state ──────────────────────────────────────────────────────

let online: boolean | null = null;
function setOnline(v: boolean) {
  if (online === v) return;
  const was = online;
  online = v;
  pushStatus();
  // Back online: send what was saved here, then refresh the copy (never reloads the page).
  if (v && was === false) void syncAll(true);
}

/** A kept-alive connection the server had already closed: the request never
 * arrived, so it can be sent again at once. */
const droppedConnection = (e: unknown) => /ECONNRESET|EPIPE|UND_ERR_SOCKET|other side closed|socket hang up/i.test(`${e instanceof Error ? e.message : ""} ${String((e as { cause?: { code?: string; message?: string } })?.cause?.code ?? "")} ${String((e as { cause?: { message?: string } })?.cause?.message ?? "")}`);

/** Device calls (offline engine) to the server. One immediate retry on a
 * dropped connection: every engine call is safe to repeat (the server answers
 * a repeated push with its stored result) except setting up a device, which
 * is never repeated. */
const transport: Transport = {
  async post<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
    const action = (body as { action?: string })?.action;
    let res: Response | null = null;
    for (let attempt = 0; !res; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      try {
        res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
      } catch (e) {
        if (attempt === 0 && action !== "provision" && droppedConnection(e)) continue;
        console.error("[transport]", path, action, e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : e);
        setOnline(false);
        throw new TransportError("No connection", null);
      } finally {
        clearTimeout(timer);
      }
    }
    setOnline(true);
    const data = (await res.json().catch((e) => { console.error("[transport] unreadable answer", path, res.status, e instanceof Error ? e.message : e); return null; })) as (T & { error?: string }) | null;
    if (!res.ok) throw new TransportError(data?.error ?? `MAVIN.pk answered ${res.status}`, res.status);
    if (data === null) throw new TransportError("No connection", null);
    return data;
  },
};

// ── The page's own server calls (the web app's /api/...), with the session cookie kept here ──

const cookies = new Map<string, string>(Object.entries(JSON.parse(secrets.get("web-cookies") || "{}") as Record<string, string>));
function keepCookies(res: Response) {
  const list = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (!list.length) return;
  for (const c of list) {
    const [pair, ...attrs] = c.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const gone = !value || attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split("=")[1]) < Date.now()));
    if (gone) cookies.delete(name); else cookies.set(name, value);
  }
  try { secrets.set("web-cookies", JSON.stringify(Object.fromEntries(cookies))); } catch { /* storage unavailable: kept for this run */ }
}

async function pageRequest(a: unknown) {
  const o = a as { path?: unknown; method?: unknown; body?: unknown; headers?: unknown };
  const path = typeof o?.path === "string" ? o.path : "";
  if (!/^\/api\/[A-Za-z0-9/_\-.?=&%]*$/.test(path) || path.startsWith("/api/offline")) throw new Error("Not allowed.");
  const method = o.method === "GET" ? "GET" : "POST";
  const headers: Record<string, string> = {};
  const h = (o.headers ?? {}) as Record<string, unknown>;
  for (const k of ["Content-Type", "X-Branch"]) if (typeof h[k] === "string") headers[k] = h[k] as string;
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const body = method === "GET" ? undefined : typeof o.body === "string" ? o.body : undefined;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`${API_BASE}${path}`, { method, headers, body, signal: ctrl.signal });
      keepCookies(res);
      setOnline(true);
      return { status: res.status, body: await res.text() };
    } catch (e) {
      // A kept-alive connection the server had closed: sent again once, only if repeating is harmless.
      if (attempt === 0 && droppedConnection(e) && safeToRepeat(method, path, body)) continue;
      console.error("[page]", method, path.split("?")[0], e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : e);
      setOnline(false);
      return { status: 0, body: "" };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Repeating this page call cannot change anything twice: a GET, signing in,
 * or database statements that only read. Saves are never repeated. */
function safeToRepeat(method: string, path: string, body: string | undefined) {
  if (method === "GET" || path.startsWith("/api/auth/login")) return true;
  if (!path.startsWith("/api/db") || !body) return false;
  try {
    const b = JSON.parse(body) as { statements?: { sql?: unknown }[] };
    return Array.isArray(b.statements) && b.statements.length > 0 && b.statements.every((s) => typeof s?.sql === "string" && readOnlySql(s.sql));
  } catch { return false; }
}

// ── Offline engine and the read-only copy ────────────────────────────────

let device: OfflineDevice;
let mirror: Mirror | null = null;
let win: BrowserWindow | null = null;
let quitting = false;
let lastMirror = 0;
let lastHistory = 0;

function openMirror() {
  const id = device.identity;
  if (!id || mirror) return;
  const schemaFile = join(resources, "schema.sql");
  if (!existsSync(schemaFile)) return;
  mirror = new Mirror(join(dataRoot, "data", id.tenantId.replace(/[^\w-]/g, "_"), id.branchId.replace(/[^\w-]/g, "_"), "mirror.db"), readFileSync(schemaFile, "utf8"));
  overlay();
}

function overlay() {
  const id = device.identity;
  if (!mirror || !id) return;
  try { mirror.overlay(device.localSales(30), device.stockNow(), id.tenantId, id.branchId); } catch (e) { console.error("[mirror] overlay", e); }
}

let syncing: Promise<void> | null = null;
/** Sends pending sales, downloads changes, and refreshes the copy (at most every few minutes unless forced). */
function syncAll(force = false): Promise<void> {
  if (!syncing) {
    syncing = (async () => {
      if (!device?.provisioned || quitting) return;
      const r = await device.sync({ manual: force }).catch((e) => { console.error("[sync]", e instanceof Error ? e.message : e); return null; });
      if (r?.error) console.error("[sync]", r.error);
      const due = force || Date.now() - lastMirror > MIRROR_EVERY_MS;
      if (r && !r.error && mirror && due) {
        try {
          await mirror.refresh(MIRROR_TABLES, (t, off) => device.mirrorPage(t, off));
          lastMirror = Date.now();
        } catch (e) { console.error("[mirror] refresh", e instanceof Error ? e.message : e); }
      }
      // Recent sales, purchases and cash: on the same rhythm, and at once after
      // sales were sent (they then show from the server's own rows).
      if (r && !r.error && mirror && (due || r.pushed > 0 || Date.now() - lastHistory > MIRROR_EVERY_MS)) {
        try {
          await mirror.refreshHistory(HISTORY_TABLES, (t, off, since) => device.mirrorPage(t, off, since));
          lastHistory = Date.now();
        } catch (e) { console.error("[mirror] history", e instanceof Error ? e.message : e); }
      }
      overlay();
      pushStatus();
    })().finally(() => { syncing = null; });
  }
  return syncing;
}

function statusNow() {
  const s = device ? device.status() : { provisioned: false as const };
  return {
    ...s, online, server: API_BASE, appVersion: app.getVersion(),
    copyRefreshedAt: mirror?.meta("refreshed_at") ?? null,
  };
}
function pushStatus() { if (win && !win.isDestroyed()) win.webContents.send("mavin:status", statusNow()); }

// ── Window ────────────────────────────────────────────────────────────────

function showWindow() {
  if (quitting) return;
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, title: "MAVIN",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.removeMenu();
  win.on("closed", () => { win = null; });
  // Inside the app only; MAVIN.pk links open in the browser.
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) { e.preventDefault(); if (/^https:\/\//.test(url)) void shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.MAVIN_DEBUG === "1") {
    win.webContents.on("console-message", (e) => console.log(`[page] ${e.message}`));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => console.log(`[page] load failed ${code} ${desc} ${url}`));
    win.webContents.on("did-finish-load", () => console.log(`[page] loaded ${win?.webContents.getURL()}`));
    win.webContents.on("render-process-gone", (_e, d) => console.log(`[page] crashed ${d.reason}`));
  }
  win.webContents.on("did-finish-load", () => pushStatus());
  void win.loadURL(`${APP_ORIGIN}/dashboard/`);
}

/** mavin://app/<path>: the bundled web app (static files; folders serve index.html). */
function serveApp(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let file = normalize(join(webRoot, rel));
  if (!file.startsWith(normalize(webRoot))) return Promise.resolve(new Response("Not found", { status: 404 }));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) {
    rel = "404.html";
    file = join(webRoot, rel);
  }
  return net.fetch(pathToFileURL(file).toString());
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
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const editId = optStr(o.editOf, 64);
  return {
    lines: o.lines.map((l) => {
      const x = l as Record<string, unknown>;
      return { productId: str(x.productId, 64, "product"), unit: x.unit === "loose" ? "loose" : "pack", qty: Number(x.qty), bonusQty: num(x.bonusQty), discountPct: num(x.discountPct) };
    }),
    customerName: optStr(o.customerName, 120), customerPhone: optStr(o.customerPhone, 30), customerId: optStr(o.customerId, 64),
    method: o.method === "credit" ? "credit" : "cash", paid: num(o.paid), billDiscountRs: num(o.billDiscountRs), charges: num(o.charges), tendered: Number(o.tendered),
    ...(editId ? { edit: { invoiceId: editId, original: originalInvoice(editId) } } : {}),
  };
}

/** An invoice as this computer's copy of the server's data has it (to edit it offline). */
function originalInvoice(id: string): OriginalInvoice | null {
  const inv = mirror?.query(`SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL`, [id])[0];
  const ident = device.identity;
  if (!inv || !ident) return null;
  const items = mirror!.query(`SELECT product_id, batch_no, qty, bonus_qty, sale_price, tax_pct FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL`, [id]);
  const flag = (k: string) => Number(inv[k] ?? 0) === 1;
  return {
    invoiceNo: inv.invoice_no == null ? null : Number(inv.invoice_no),
    updatedAt: String(inv.updated_at ?? ""),
    date: String(inv.date),
    offlineRef: (inv.offline_ref as string | null) ?? null,
    fbrInvoiceNo: (inv.fbr_invoice_no as string | null) || null,
    editable: !flag("is_return") && !flag("is_memorized") && !flag("is_quotation") && String(inv.branch_id ?? ident.branchId) === ident.branchId,
    items: items.map((it) => ({
      productId: String(it.product_id), batchNo: (it.batch_no as string | null) ?? null, qty: Number(it.qty) || 0, bonusQty: Number(it.bonus_qty) || 0,
      salePrice: Number(it.sale_price) || 0, taxPct: Number(it.tax_pct) || 0,
    })),
  };
}

/** Sessions of logins that signed in online here (so they can sign in offline). */
const sessionKey = (userId: string) => `session-${userId.replace(/[^\w-]/g, "_")}`;

type Handler = (arg: unknown) => unknown;
const handlers: Record<string, Handler> = {
  status: () => statusNow(),
  request: (a) => pageRequest(a),
  /** The page signed in online: keep its session for offline sign-in and enrol the login on this device. */
  rememberSession: async (a) => {
    const o = a as { username?: unknown; password?: unknown; session?: { user?: { id?: unknown } } };
    const username = str(o?.username, 80, "username");
    const password = str(o?.password, 200, "password");
    const userId = String(o?.session?.user?.id ?? "");
    if (!userId) throw new Error("No session.");
    secrets.set(sessionKey(userId), JSON.stringify({ username: username.trim().toLowerCase(), session: o.session }));
    if (device.provisioned) {
      await device.signIn(username, password).catch((e) => console.error("[enrol]", e instanceof Error ? e.message : e));
      void syncAll(true);
    }
    return { provisioned: device.provisioned };
  },
  /** Sign in without internet: the device checks the password against its saved check, within its offline allowance. */
  offlineSignIn: async (a) => {
    const o = a as Record<string, unknown>;
    if (!device.provisioned) throw new Error("This computer is not set up for offline use yet. Connect to the internet and sign in.");
    const user = await device.signIn(str(o?.username, 80, "username"), str(o?.password, 200, "password"));
    const saved = secrets.get(sessionKey(user.id));
    if (!saved) throw new Error("Sign in once while online on this computer, then you can sign in offline.");
    return (JSON.parse(saved) as { session: unknown }).session;
  },
  provision: async (a) => {
    const o = a as Record<string, unknown>;
    const r = await device.provision(str(o?.username, 80, "username"), str(o?.password, 200, "password"), { name: optStr(o?.name, 60) ?? undefined });
    openMirror();
    await syncAll(true);
    return r;
  },
  query: (a) => {
    const o = a as { sql?: unknown; params?: unknown };
    if (!mirror) throw new Error("This computer has no offline copy yet. Connect to the internet.");
    return mirror.query(str(o?.sql, 20000, "query"), Array.isArray(o?.params) ? o.params : []);
  },
  createSale: (a) => {
    const r = device.createSale(saleInput(a));
    overlay();
    pushStatus();
    if (online) void syncAll(false);
    return { saleId: r.sale.saleId, offlineRef: r.sale.offlineRef, totals: r.sale.totals, receipt: r.receipt };
  },
  syncNow: async () => { await syncAll(true); return statusNow(); },
  printText: (a) => printReceipt(str(a, 20000, "receipt")),
};

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`mavin:${name}`, async (e, arg) => {
    if (!e.senderFrame?.url?.startsWith(`${APP_ORIGIN}/`)) return { ok: false, error: "Not allowed." };
    try {
      return { ok: true, value: await fn(arg) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** Prints a receipt text through a hidden window (the Windows print dialog). */
async function printReceipt(text: string) {
  if (!app.isPackaged && process.env.MAVIN_NO_PRINT === "1") { console.log(`[print]\n${text}`); return true; }
  const p = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
  const esc = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  await p.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>@page{margin:4mm}body{margin:0;font:12px/1.35 Consolas,monospace;white-space:pre}</style><body>${esc}</body>`)}`);
  await new Promise<void>((resolve, reject) => p.webContents.print({ silent: false, printBackground: false }, (ok, why) => (ok || why === "cancelled" ? resolve() : reject(new Error(why)))));
  p.destroy();
  return true;
}

/** Is MAVIN.pk reachable? (any answer counts; no data is sent) */
async function probe() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    await fetch(`${API_BASE}/api/offline/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: ctrl.signal });
    setOnline(true);
  } catch {
    setOnline(false);
  } finally {
    clearTimeout(timer);
  }
}

let timers: ReturnType<typeof setInterval>[] = [];

if (primary) {
  app.whenReady().then(() => {
    protocol.handle("mavin", serveApp);
    device = new OfflineDevice({ dataRoot, publicKeyPem: readFileSync(publicKeyFile, "utf8"), appVersion: app.getVersion(), transport, secrets });
    openMirror();
    createWindow();
    timers = [setInterval(() => void syncAll(false), SYNC_EVERY_MS), setInterval(() => void probe(), PROBE_EVERY_MS), setInterval(pushStatus, PROBE_EVERY_MS)];
    void probe().then(() => syncAll(false));
  });

  app.on("second-instance", () => { if (app.isReady()) showWindow(); });

  const shutdown = () => {
    if (quitting) return;
    quitting = true;
    for (const t of timers) clearInterval(t);
    try { mirror?.close(); } catch { /* closed */ }
    try { device?.close(); } catch { /* the saved data is already on disk (WAL) */ }
  };
  app.on("window-all-closed", () => { shutdown(); app.quit(); });
  app.on("before-quit", shutdown);
}

process.on("uncaughtException", (e) => { console.error("[main] uncaught", e); });
process.on("unhandledRejection", (e) => { console.error("[main] unhandled", e); });
