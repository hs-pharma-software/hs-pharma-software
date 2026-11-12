/** Mavin Pharmacy Offline: Electron main process.
 *
 * The window shows MAVIN's own Pharmacy screens (bundled, served from
 * mavin-pharmacy://app/), so the interface, shortcuts and invoice formats are
 * MAVIN Pharmacy's. Their database is this computer's (core/localdb.ts): every
 * statement comes here through a fixed list of validated calls.
 *
 * Offline by design: the page cannot reach any network address (every request
 * that is not the app itself is cancelled), there is no FBR/PRAL, no online
 * login and no business-data sync. The only outgoing call is the catalogue
 * download (download only, MAVIN.pk's catalogue address), made from here. */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { LocalDb, GuardError } from "./core/localdb";
import { LocalAuth, TENANT_ID } from "./core/auth";
import { License } from "./core/license";
import { Catalogue, type CataloguePage, type CatTable } from "./core/catalogue";
import { backupTo, checkBackup, swapIn, IDENTITY_KEYS } from "./core/backup";

const SCHEME = "mavin-pharmacy";
const APP_ORIGIN = `${SCHEME}://app`;
/** The approved catalogue source (download only). Development may point elsewhere. */
const CATALOGUE_URL = (!app.isPackaged && process.env.MAVIN_CATALOGUE_URL) || "https://app.mavin.pk/api/catalogue/pharma/";
const CATALOGUE_CHECK_MS = 10 * 60_000;
/** Development test runs only (never in the installed app): files instead of Windows dialogs, PDF instead of a printer. */
const TEST = !app.isPackaged ? { file: process.env.MAVIN_TEST_FILE || "", confirm: process.env.MAVIN_TEST_CONFIRM === "1", pdf: process.env.MAVIN_TEST_PRINT_PDF || "" } : { file: "", confirm: false, pdf: "" };
const saveDialog = async (o: Electron.SaveDialogOptions) => (TEST.file ? { canceled: false, filePath: TEST.file } : dialog.showSaveDialog(win!, o));
const openDialog = async (o: Electron.OpenDialogOptions) => (TEST.file ? { canceled: false, filePaths: [TEST.file] } : dialog.showOpenDialog(win!, o));
const AUTO_BACKUP_MS = 24 * 3600_000;
const AUTO_BACKUPS_KEPT = 14;

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setName("Mavin Pharmacy Offline");
if (!app.isPackaged && process.env.MAVIN_DATA_DIR) app.setPath("userData", process.env.MAVIN_DATA_DIR);
const dataRoot = app.getPath("userData");
const dataDir = join(dataRoot, "data");
const dbFile = join(dataDir, "pharmacy.db");

const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);
const resources = app.isPackaged ? process.resourcesPath : join(__dirname, "..", "resources");
const webRoot = app.isPackaged ? join(process.resourcesPath, "web") : join(__dirname, "..", "web");

let db: LocalDb;
let auth: LocalAuth;
let license: License;
let catalogue: Catalogue;
let win: BrowserWindow | null = null;
let timers: ReturnType<typeof setInterval>[] = [];
let wasOnline = false;

function openDatabase() {
  db = new LocalDb(dbFile, readFileSync(join(resources, "schema.sql"), "utf8"));
  if (!db.meta("installation_id")) { db.setMeta("installation_id", randomUUID()); db.audit(null, "installation_created"); }
  auth = new LocalAuth(db);
  license = new License(db, readFileSync(join(resources, "license-public.pem"), "utf8"));
  catalogue = new Catalogue(db, CATALOGUE_URL, fetchCataloguePage);
  const bundled = join(resources, "catalogue.json");
  if (!db.meta("catalogue_version") && existsSync(bundled)) {
    const b = JSON.parse(readFileSync(bundled, "utf8")) as { version: string; cursor: string | null; generatedAt: string; rows: Partial<Record<CatTable, Record<string, unknown>[]>> };
    catalogue.importBundled(b);
  }
}

/** Only MAVIN.pk's catalogue address, JSON, bounded size and time. */
async function fetchCataloguePage(url: string): Promise<CataloguePage> {
  const u = new URL(url);
  const allowed = new URL(CATALOGUE_URL);
  if (u.origin !== allowed.origin || u.pathname !== allowed.pathname) throw new Error("Not the approved catalogue address.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    // Its own session: the window's session blocks every network request of the page.
    const res = await session.fromPartition("catalogue").fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", "X-Mavin-Client": `pharmacy-offline/${app.getVersion()}` } });
    if (!res.ok) throw new Error(`The catalogue server answered ${res.status}.`);
    const text = await res.text();
    if (text.length > 20_000_000) throw new Error("The catalogue answer is too large.");
    return JSON.parse(text) as CataloguePage;
  } catch (e) {
    throw new Error((e as Error)?.name === "AbortError" ? "The catalogue server did not answer in time." : e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(t);
  }
}

/** New transactions are allowed while the license (or trial, or grace days) allows. Cached briefly. */
let licenseCache: { at: number; ok: boolean } | null = null;
const licenseActive = () => {
  if (!licenseCache || Date.now() - licenseCache.at > 30_000) licenseCache = { at: Date.now(), ok: license.info().canTransact };
  return licenseCache.ok;
};

// ── Backups ─────────────────────────────────────────────────────────────

const backupsDir = join(dataRoot, "backups");
function autoBackup() {
  try {
    if (!auth.setupDone) return;
    const last = Number(db.meta("auto_backup_at") ?? "0");
    if (Date.now() - last < AUTO_BACKUP_MS) return;
    backupTo(db.db, join(backupsDir, `auto-${new Date().toISOString().slice(0, 10)}.mavinbak`));
    db.setMeta("auto_backup_at", String(Date.now()));
    const files = readdirSync(backupsDir).filter((f) => f.startsWith("auto-")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - AUTO_BACKUPS_KEPT))) rmSync(join(backupsDir, f));
  } catch (e) {
    console.error("[backup] automatic", e);
  }
}

// ── Window ──────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, title: "Mavin Pharmacy Offline",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  win.removeMenu();
  win.on("closed", () => { win = null; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(`${APP_ORIGIN}/`)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?mavin\.pk\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.MAVIN_DEBUG === "1") {
    win.webContents.on("console-message", (e) => console.log(`[page] ${e.message}`));
    win.webContents.on("did-fail-load", (_e, code, desc, url) => console.log(`[page] load failed ${code} ${desc} ${url}`));
  }
  void win.loadURL(`${APP_ORIGIN}/dashboard/`);
}

function serveApp(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let file = normalize(join(webRoot, decodeURIComponent(url.pathname).replace(/^\/+/, "")));
  if (!file.startsWith(normalize(webRoot))) return Promise.resolve(new Response("Not found", { status: 404 }));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
  if (!existsSync(file)) file = join(webRoot, "404.html");
  return net.fetch(pathToFileURL(file).toString());
}

// ── Calls from the page ─────────────────────────────────────────────────

const text = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : "");
const params = (v: unknown) => (Array.isArray(v) ? v.slice(0, 2000) : []);
const pharmacyName = () => String((db.db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(TENANT_ID) as { name?: string } | undefined)?.name ?? "");
const actorName = (token: unknown) => {
  const id = auth.sessionUser(token);
  return id ? String((db.db.prepare(`SELECT username FROM users WHERE id = ?`).get(id) as { username?: string } | undefined)?.username ?? id) : "unknown";
};

type Handler = (arg: unknown) => unknown;
const handlers: Record<string, Handler> = {
  info: () => ({
    setupDone: auth.setupDone, installationId: license.installationId, appVersion: app.getVersion(),
    license: license.info(), superAdminUserId: auth.superAdminId, dataFolder: dataRoot,
  }),
  select: (a) => { const o = a as { sql?: unknown; params?: unknown }; return db.pageSelect(text(o?.sql, 100_000), params(o?.params), { licenseActive: licenseActive() }); },
  execute: (a) => { const o = a as { sql?: unknown; params?: unknown }; return db.pageExecute(text(o?.sql, 100_000), params(o?.params), { licenseActive: licenseActive() }); },
  batch: (a) => {
    const list = (a as { statements?: unknown })?.statements;
    if (!Array.isArray(list)) throw new GuardError("No statements.");
    db.pageBatch(list.map((s) => ({ sql: text((s as { sql?: unknown }).sql, 100_000), params: params((s as { params?: unknown }).params) })), { licenseActive: licenseActive() });
    return null;
  },
  setup: (a) => { const r = auth.setup((a ?? {}) as Record<string, unknown>); autoBackup(); return r; },
  login: (a) => { const o = a as { username?: unknown; password?: unknown }; return auth.login(o?.username, o?.password); },
  checkSession: (a) => ({ valid: !!auth.sessionUser((a as { session?: unknown })?.session) }),
  logout: (a) => { auth.logout((a as { session?: unknown })?.session); return null; },
  setPassword: (a) => { const o = a as { session?: unknown; userId?: unknown; password?: unknown }; auth.setPassword(o?.session, o?.userId, o?.password); return null; },
  recover: (a) => { const o = a as { recoveryKey?: unknown; newPassword?: unknown }; return auth.recover(o?.recoveryKey, o?.newPassword); },
  newRecoveryKey: (a) => { const o = a as { session?: unknown; password?: unknown }; return auth.rotateRecoveryKey(o?.session, o?.password); },
  saveText: async (a) => {
    const o = a as { suggestedName?: unknown; text?: unknown };
    const r = await saveDialog({ defaultPath: text(o?.suggestedName, 120) || "mavin.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(r.filePath, text(o?.text, 20_000));
    return { path: r.filePath };
  },
  license: () => license.info(),
  requestCode: () => ({ code: license.requestCode(pharmacyName(), app.getVersion()) }),
  importLicense: async (a) => {
    const o = a as { session?: unknown; text?: unknown; fromFile?: unknown };
    auth.requireSuperAdmin(o?.session);
    let lic = text(o?.text, 20_000);
    if (o?.fromFile === true) {
      const r = await openDialog({ properties: ["openFile"], filters: [{ name: "Mavin license", extensions: ["lic", "txt"] }] });
      if (r.canceled || !r.filePaths[0]) throw new Error("No file chosen.");
      lic = readFileSync(r.filePaths[0], "utf8").slice(0, 20_000);
    }
    const info = license.import(lic, actorName(o?.session));
    licenseCache = null;
    return info;
  },
  backup: async (a) => {
    const token = (a as { session?: unknown })?.session;
    auth.requireSuperAdmin(token);
    const r = await saveDialog({ defaultPath: `Mavin-Pharmacy-backup-${new Date().toISOString().slice(0, 10)}.mavinbak`, filters: [{ name: "Mavin Pharmacy backup", extensions: ["mavinbak"] }] });
    if (r.canceled || !r.filePath) return null;
    const out = backupTo(db.db, r.filePath);
    db.audit(actorName(token), "backup", { path: out.path, bytes: out.bytes });
    return { path: out.path };
  },
  restore: async (a) => {
    const token = (a as { session?: unknown })?.session;
    auth.requireSuperAdmin(token);
    const r = await openDialog({ properties: ["openFile"], filters: [{ name: "Mavin Pharmacy backup", extensions: ["mavinbak", "db"] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const found = checkBackup(file);
    const ok = TEST.confirm ? { response: 0 } : await dialog.showMessageBox(win!, {
      type: "warning", buttons: ["Restore", "Cancel"], defaultId: 1, cancelId: 1, title: "Restore a backup",
      message: `Replace this computer's pharmacy data with the backup of "${found.pharmacy ?? "a pharmacy"}"?`,
      detail: "The current data is kept as a safety copy in the data folder. Everyone signs in again afterwards. The license stays this installation's.",
    });
    if (ok.response !== 0) return null;
    const actor = actorName(token);
    const identity = Object.fromEntries(IDENTITY_KEYS.map((k) => [k, db.meta(k)]));
    db.close();
    const safety = swapIn(dbFile, file, identity);
    openDatabase();
    db.audit(actor, "restore", { from: file, safetyCopy: safety, backupInstallation: found.installationId });
    licenseCache = null;
    setTimeout(() => win?.webContents.reload(), 300);
    return { path: file };
  },
  print: async (a) => {
    const o = a as { widthMm?: unknown; heightMm?: unknown; marginMm?: unknown; silent?: unknown };
    const mm = (v: unknown, d: number) => (typeof v === "number" && v > 0 && v < 2000 ? v : d);
    if (!win) throw new Error("No window.");
    if (TEST.pdf) { writeFileSync(TEST.pdf, await win.webContents.printToPDF({ printBackground: true, pageSize: { width: mm(o?.widthMm, 210) / 25.4, height: mm(o?.heightMm, 297) / 25.4 } })); return null; }
    await new Promise<void>((resolve, reject) => win!.webContents.print({
      silent: o?.silent !== false, printBackground: true,
      pageSize: { width: Math.round(mm(o?.widthMm, 210) * 1000), height: Math.round(mm(o?.heightMm, 297) * 1000) },
      margins: { marginType: "custom", top: 0, bottom: 0, left: 0, right: 0 },
    }, (ok, why) => (ok || why === "cancelled" ? resolve() : reject(new Error(why || "Printing failed.")))));
    return null;
  },
  catalogueStatus: () => catalogue.status(),
  catalogueSync: () => catalogue.sync(true),
  audit: (a) => {
    const o = a as { session?: unknown; limit?: unknown };
    auth.requireSuperAdmin(o?.session);
    const n = Math.min(500, Math.max(1, Number(o?.limit) || 50));
    return db.db.prepare(`SELECT id, at, actor, action, detail FROM standalone_audit ORDER BY id DESC LIMIT ?`).all(n);
  },
};

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`mp:${name}`, async (e, arg) => {
    if (!e.senderFrame?.url?.startsWith(`${APP_ORIGIN}/`)) return { ok: false, error: "Not allowed." };
    try {
      return { ok: true, value: await fn(arg) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ── Catalogue timing ────────────────────────────────────────────────────

function catalogueTick() {
  const online = net.isOnline();
  if (online && !wasOnline) void catalogue.onReconnect(); // back online: an overdue update runs now
  else if (online) void catalogue.sync();
  wasOnline = online;
}

if (primary) {
  app.whenReady().then(() => {
    // The page reaches nothing but the app itself (no FBR, no PRA, no other site).
    session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
      const u = details.url;
      cb({ cancel: !(u.startsWith(`${SCHEME}:`) || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("devtools:")) });
    });
    protocol.handle(SCHEME, serveApp);
    mkdirSync(dataDir, { recursive: true });
    openDatabase();
    createWindow();
    autoBackup();
    // Checked at start (a launch after a closed day updates at once), then every 10 minutes.
    setTimeout(catalogueTick, 15_000);
    timers = [setInterval(catalogueTick, CATALOGUE_CHECK_MS), setInterval(autoBackup, 3600_000)];
  });
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  const shutdown = () => { for (const t of timers) clearInterval(t); try { db?.close(); } catch { /* closed */ } };
  app.on("window-all-closed", () => { shutdown(); app.quit(); });
  app.on("before-quit", shutdown);
}

process.on("uncaughtException", (e) => { console.error("[main] uncaught", e); });
process.on("unhandledRejection", (e) => { console.error("[main] unhandled", e); });
