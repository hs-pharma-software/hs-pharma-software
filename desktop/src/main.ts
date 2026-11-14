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
import { autoUpdater } from "electron-updater";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { OfflineDevice, TransportError, type OriginalInvoice, type SaleInput, type SecretStore, type Transport } from "./core/device";
import { Mirror, readOnlySql } from "./core/mirror";
import { answerableLocally, copiedTables, copyReady, fillCopy, followCopy } from "./core/replicaSync";
import { callAllowed, type CallModule } from "../../src/offline/protocol";

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
  if (v && was === false) { void syncAll(true); void refreshReplica(); }
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
  if (path.startsWith("/api/db")) pageBranch = headers["X-Branch"] ?? "";
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const body = method === "GET" ? undefined : typeof o.body === "string" ? o.body : undefined;
  // A save (anything but a read): screens read MAVIN.pk until the copy has it, which is fetched at once.
  const saving = method !== "GET" && !path.startsWith("/api/replica") && !path.startsWith("/api/auth/me") && !safeToRepeat(method, path, body);
  if (saving) lastWriteAt = Date.now();
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`${API_BASE}${path}`, { method, headers, body, signal: ctrl.signal });
      keepCookies(res);
      setOnline(true);
      if (saving) { lastWriteAt = Date.now(); setTimeout(() => void refreshReplica(), 200); }
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
  if (!id) return;
  for (const m of [mirror, replica?.m]) {
    if (!m) continue;
    try { m.overlay(device.localSales(30), device.stockNow(), id.tenantId, id.branchId); } catch (e) { console.error("[copy] overlay", e); }
  }
}

// ── The local copy of the business (Phase 1: fast screens for every business) ──
//
// One copy per login and branch, filled on first use and then kept up to
// date from MAVIN.pk's change log every few seconds (core/replicaSync.ts).
// Screens read it while it is complete, belongs to the same login and branch
// as the page, and nothing saved from here is still on its way into it;
// otherwise they read MAVIN.pk as before. Saving always goes to MAVIN.pk.

const REPLICA_EVERY_MS = 15_000;
let replica: { m: Mirror; userId: string; tenantId: string; branch: string } | null = null;
/** The branch the page last asked for (X-Branch); "" = the login's default. */
let pageBranch = "";
/** When something was last saved from this computer, and when the copy last caught up after starting at a time. */
let lastWriteAt = 0;
let caughtUpFrom = 0;
let replicaBusy: Promise<void> | null = null;
let replicaNote: string | null = null;

async function asLogin<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (pageBranch) headers["X-Branch"] = pageBranch;
  if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    keepCookies(res);
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || data === null) throw new Error(data?.error ?? `MAVIN.pk answered ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** The copy for the signed-in login and the page's branch (opened, or switched). */
async function currentReplica() {
  if (!cookies.size) return null;
  const me = await asLogin<{ userId: string; role: string; tenantId: string | null; platformRole: string | null }>("/api/auth/me/", undefined);
  if (!me.tenantId || me.role === "super_admin" || me.platformRole) return null;
  if (replica && replica.userId === me.userId && replica.tenantId === me.tenantId && replica.branch === pageBranch) return replica;
  const schemaFile = join(resources, "schema.sql");
  if (!existsSync(schemaFile)) return null;
  try { replica?.m.close(); } catch { /* closed */ }
  replica = { m: new Mirror(copyFile(me.tenantId, pageBranch, me.userId), readFileSync(schemaFile, "utf8")), userId: me.userId, tenantId: me.tenantId, branch: pageBranch };
  caughtUpFrom = 0;
  return replica;
}

const safeName = (s: string) => s.replace(/[^\w-]/g, "_");
const copyFile = (tenantId: string, branch: string, userId: string) => join(dataRoot, "data", safeName(tenantId), safeName(branch || "default"), "users", safeName(userId), "copy.db");

/** Offline: the copy of the login signed in on the offline engine (opened
 * from disk when the app started without internet), if it is complete. */
function offlineCopy(): Mirror | null {
  const u = device.user;
  const ident = device.identity;
  if (!u || !ident) return null;
  if (replica) return replica.userId === u.id && replica.tenantId === ident.tenantId && copyReady(replica.m) ? replica.m : null;
  const file = copyFile(ident.tenantId, "", u.id);
  const schemaFile = join(resources, "schema.sql");
  if (!existsSync(file) || !existsSync(schemaFile)) return null;
  replica = { m: new Mirror(file, readFileSync(schemaFile, "utf8")), userId: u.id, tenantId: ident.tenantId, branch: "" };
  return copyReady(replica.m) ? replica.m : null;
}

/** Fills the copy the first time, then brings it up to date (one run at a time). */
let replicaAgain = false;
function refreshReplica(): Promise<void> {
  // Asked again while a run is on (a save just landed): one more run right after it.
  if (replicaBusy) { replicaAgain = true; return replicaBusy; }
  {
    replicaBusy = (async () => {
      if (quitting || online === false) return;
      const startedAt = Date.now();
      try {
        const r = await currentReplica();
        if (!r) return;
        const call = <T,>(body: Record<string, unknown>) => asLogin<{ result: T }>("/api/replica/", body).then((x) => x.result);
        if (!copyReady(r.m)) replicaNote = "Copying this business's data to this computer…";
        await fillCopy(r.m, call, (done, total) => { replicaNote = `Copying this business's data to this computer: ${done} of ${total} tables…`; pushStatus(); });
        await followCopy(r.m, call);
        overlay();
        replicaNote = null;
        if (r === replica) caughtUpFrom = startedAt;
      } catch (e) {
        console.error("[copy]", e instanceof Error ? e.message : e);
      }
      pushStatus();
    })().finally(() => {
      replicaBusy = null;
      if (replicaAgain) { replicaAgain = false; void refreshReplica(); }
    });
  }
  return replicaBusy;
}

/** A read the local copy may answer now (else MAVIN.pk answers it). */
function localRead(a: unknown): { local: true; rows: Record<string, unknown>[] } | { local: false } {
  const o = a as { sql?: unknown; params?: unknown; userId?: unknown; branch?: unknown };
  const r = replica;
  if (!r || typeof o?.sql !== "string" || !copyReady(r.m)) return { local: false };
  // Same login and branch as the page, and nothing saved from here still on its way into the copy.
  if (o.userId !== r.userId || String(o.branch ?? "") !== r.branch || lastWriteAt >= caughtUpFrom) return { local: false };
  if (!readOnlySql(o.sql) || !answerableLocally(o.sql, copiedTables(r.m), r.m.tableNames())) return { local: false };
  try {
    return { local: true, rows: r.m.query(o.sql, Array.isArray(o.params) ? o.params : []) };
  } catch {
    return { local: false };
  }
}

let syncing: Promise<void> | null = null;
/** Sends pending sales, downloads changes, and refreshes the copy (at most every few minutes unless forced). */
function syncAll(force = false): Promise<void> {
  if (!syncing) {
    syncing = (async () => {
      if (!device?.provisioned || quitting) return;
      const startedSync = new Date(Date.now() - 1000).toISOString();
      const r = await device.sync({ manual: force }).catch((e) => { console.error("[sync]", e instanceof Error ? e.message : e); return null; });
      // A save from here that MAVIN.pk held or refused: its rows in the copy were never made there; read the copy again.
      if (r && replica && device.refusedCallsSince(startedSync) > 0) {
        for (const k of ["replica_ready", "replica_tables", "replica_cursor"]) replica.m.setMeta(k, k === "replica_tables" ? "[]" : "");
        replica.m.setMeta("replica_fill", "null");
        void refreshReplica();
      }
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
    copyRefreshedAt: (replica && copyReady(replica.m) ? replica.m.meta("replica_followed_at") : null) ?? mirror?.meta("refreshed_at") ?? null,
    /** The local copy of the business: complete (screens read it), or being copied. */
    localCopy: replica ? { ready: copyReady(replica.m), note: replicaNote } : null,
    /** A newer version: being downloaded, or ready (installed when the app is closed). */
    update,
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
    customerName: optStr(o.customerName, 120), customerPhone: optStr(o.customerPhone, 30), customerId: optStr(o.customerId, 64), measurementId: optStr(o.measurementId, 64),
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
  /** Offline: the local copy of the business (the login's own when complete, else the offline sales copy). */
  query: (a) => {
    const o = a as { sql?: unknown; params?: unknown };
    const m = offlineCopy() ?? (replica && copyReady(replica.m) ? replica.m : mirror);
    if (!m) throw new Error("This computer has no offline copy yet. Connect to the internet.");
    return m.query(str(o?.sql, 20000, "query"), Array.isArray(o?.params) ? o.params : []);
  },
  /** Online: answered from the local copy when it can be (fast), else the page asks MAVIN.pk. */
  read: (a) => localRead(a),
  createSale: (a) => {
    const r = device.createSale(saleInput(a));
    overlay();
    pushStatus();
    if (online) void syncAll(false);
    return { saleId: r.sale.saleId, offlineRef: r.sale.offlineRef, totals: r.sale.totals, receipt: r.receipt };
  },
  /** Offline: a save in the distribution or electronics module, made on this login's local copy and queued for MAVIN.pk. */
  moduleCall: async (a) => {
    const o = a as { module?: unknown; fn?: unknown; args?: unknown };
    const mod = String(o?.module ?? "");
    const fn = String(o?.fn ?? "");
    if (!callAllowed(mod, fn)) throw new Error("This cannot be saved offline. Connect to the internet.");
    const m = offlineCopy();
    if (!m) throw new Error("This computer has no complete copy of this business for your login yet. Connect to the internet once and let the copy finish.");
    const r = await device.moduleCall(m, mod as CallModule, fn, Array.isArray(o.args) ? o.args : []);
    lastWriteAt = Date.now();
    pushStatus();
    if (online) void syncAll(false);
    return r;
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

// ── Updates ───────────────────────────────────────────────────────────────

/** Where new versions are published (latest.yml, the installer and its
 * blockmap): a fixed address on mavin.pk that sends on to the file host. */
const UPDATE_FEED = "https://www.mavin.pk/downloads/windows/";
const UPDATE_EVERY_MS = 6 * 3_600_000;
let update: { version: string; ready: boolean } | null = null;

/** Installed app only: checks for a new version while online, downloads only
 * the parts that changed (blockmap), and installs it when the app is closed.
 * Never restarts the app by itself: a sale in progress is never interrupted,
 * and everything saved is in the database before the app closes. */
function startUpdates() {
  if (!app.isPackaged || process.env.MAVIN_NO_UPDATES === "1") return;
  autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_FEED });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: () => undefined, warn: (m: unknown) => console.warn("[update]", m), error: (m: unknown) => console.error("[update]", m), debug: () => undefined };
  autoUpdater.on("update-available", (i) => { update = { version: i.version, ready: false }; pushStatus(); });
  autoUpdater.on("update-downloaded", (i) => { update = { version: i.version, ready: true }; pushStatus(); });
  autoUpdater.on("error", (e) => console.error("[update]", e instanceof Error ? e.message : e));
  const check = () => { if (online !== false && !quitting) autoUpdater.checkForUpdates().catch((e) => console.error("[update]", e instanceof Error ? e.message : e)); };
  setTimeout(check, 60_000);
  timers.push(setInterval(check, UPDATE_EVERY_MS));
}

if (primary) {
  app.whenReady().then(() => {
    protocol.handle("mavin", serveApp);
    device = new OfflineDevice({ dataRoot, publicKeyPem: readFileSync(publicKeyFile, "utf8"), appVersion: app.getVersion(), transport, secrets });
    openMirror();
    createWindow();
    timers = [setInterval(() => void syncAll(false), SYNC_EVERY_MS), setInterval(() => void probe(), PROBE_EVERY_MS), setInterval(pushStatus, PROBE_EVERY_MS)];
    void probe().then(() => syncAll(false));
    startUpdates();
    // The local copy of the business: filled once, then kept up to date.
    timers.push(setInterval(() => void refreshReplica(), REPLICA_EVERY_MS));
    setTimeout(() => void refreshReplica(), 5_000);
  });

  app.on("second-instance", () => { if (app.isReady()) showWindow(); });

  const shutdown = () => {
    if (quitting) return;
    quitting = true;
    for (const t of timers) clearInterval(t);
    try { mirror?.close(); } catch { /* closed */ }
    try { replica?.m.close(); } catch { /* closed */ }
    try { device?.close(); } catch { /* the saved data is already on disk (WAL) */ }
  };
  app.on("window-all-closed", () => { shutdown(); app.quit(); });
  app.on("before-quit", shutdown);
}

process.on("uncaughtException", (e) => { console.error("[main] uncaught", e); });
process.on("unhandledRejection", (e) => { console.error("[main] unhandled", e); });
