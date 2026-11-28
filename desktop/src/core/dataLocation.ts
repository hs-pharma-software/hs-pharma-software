/** Where MAVIN Offline keeps its databases and backups.
 *
 * Not on C: when the computer has another fixed (internal) drive: a hidden
 * "MAVIN Data" folder (one folder inside it per Windows user) on the one with
 * the most free space, so a Windows reinstall or a full C: drive does not take
 * the business's data with it. Chosen once and remembered (data-location.json
 * in the app's own folder); if that folder later cannot be found, the app says
 * so and does not start empty.
 * Data an earlier version kept in the app's folder is copied there once,
 * checked, and the originals are put aside (never deleted). Anything that
 * goes wrong leaves everything where it was. The Windows-encrypted secrets
 * stay in the app's folder: they belong to this Windows account. */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = "data-location.json";
const FOLDER = "MAVIN Data";
/** Marks a folder as MAVIN's data folder (and that it was written to). */
const MARKER = ".mavin-data";
/** What earlier versions kept in the app's folder. */
const MOVED = ["device.json", "data", "backups"];
const MIN_FREE_BYTES = 2 * 1024 ** 3;

type Log = Pick<Console, "error" | "log">;

/** The folder for databases and backups (the app's own folder when no other
 * drive can be used). Throws when the remembered folder is not there. */
export function dataLocation(appData: string, windowsUser: string, log: Log = console): string {
  const cfgFile = join(appData, CONFIG);
  if (existsSync(cfgFile)) {
    let saved: string | null = null;
    try {
      const v = (JSON.parse(readFileSync(cfgFile, "utf8")) as { path?: unknown }).path;
      if (typeof v === "string" && v) saved = v;
    } catch (e) {
      log.error("[data] unreadable", CONFIG, e instanceof Error ? e.message : e);
    }
    if (saved === appData) return appData;
    if (saved) {
      if (existsSync(join(saved, MARKER))) return saved;
      throw new Error(`The data folder "${saved}" cannot be found. Connect or unlock that drive, then open MAVIN Offline again. Nothing was changed.`);
    }
  }
  const target = pickFolder(windowsUser, log);
  if (!target) return remember(cfgFile, appData);
  try {
    moveExisting(appData, target, log);
  } catch (e) {
    // Nothing was put aside: the data stays (and is used) where it was.
    log.error("[data] could not move the data to", target, e instanceof Error ? e.message : e);
    return remember(cfgFile, appData);
  }
  return remember(cfgFile, target);
}

function remember(cfgFile: string, path: string): string {
  try { writeFileSync(cfgFile, JSON.stringify({ path, chosenAt: new Date().toISOString() }, null, 2)); } catch { /* asked again next time */ }
  return path;
}

/** Lists "D:|free bytes" for the computer's own drives. External (USB) hard
 * disks also call themselves fixed drives: they are left out, so the data is
 * never put on a disk that gets unplugged. */
const INTERNAL_DRIVES = [
  "$out = Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq 'USB' -or $_.PNPDeviceID -like 'USB*' -or $_.MediaType -like 'External*' -or $_.MediaType -like 'Removable*' }",
  "$usb = @($out | ForEach-Object { Get-CimAssociatedInstance $_ -ResultClassName Win32_DiskPartition } | ForEach-Object { Get-CimAssociatedInstance $_ -ResultClassName Win32_LogicalDisk } | ForEach-Object { $_.DeviceID })",
  "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $usb -notcontains $_.DeviceID } | ForEach-Object { $_.DeviceID + '|' + $_.FreeSpace }",
].join("; ");

/** This Windows user's folder inside a hidden "MAVIN Data" on a fixed drive
 * (not the Windows drive): the one that already has it, else the most free space. */
function pickFolder(windowsUser: string, log: Log): string | null {
  if (process.platform !== "win32") return null;
  const system = (process.env.SystemDrive || "C:").toUpperCase();
  let out = "";
  try {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      INTERNAL_DRIVES],
    { encoding: "utf8", timeout: 20_000, windowsHide: true });
    out = r.stdout ?? "";
  } catch (e) {
    log.error("[data] could not list the drives", e instanceof Error ? e.message : e);
    return null;
  }
  const drives = out.split(/\r?\n/).map((l) => l.trim().split("|")).filter(([d]) => /^[A-Z]:$/i.test(d ?? ""))
    .map(([d, free]) => ({ drive: d.toUpperCase(), free: Number(free) || 0 }))
    .filter((d) => d.drive !== system);
  const user = windowsUser.replace(/[^\p{L}\p{N} _-]/gu, "_").trim() || "user";
  const folderOn = (drive: string) => join(`${drive}\\`, FOLDER, user);
  const has = (d: { drive: string }) => existsSync(join(folderOn(d.drive), MARKER));
  const usable = drives.filter((d) => has(d) || d.free >= MIN_FREE_BYTES).sort((a, b) => Number(has(b)) - Number(has(a)) || b.free - a.free);
  for (const { drive } of usable) {
    const dir = folderOn(drive);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, MARKER), "MAVIN Offline keeps this business's databases and backups here. Do not delete.\r\n");
      spawnSync("attrib", ["+h", join(`${drive}\\`, FOLDER)], { windowsHide: true, timeout: 10_000 });
      return dir;
    } catch (e) {
      log.error("[data] cannot use", dir, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

/** Copies what earlier versions kept in the app's folder, checks every file arrived whole, then puts the originals aside. */
export function moveExisting(appData: string, target: string, log: Log = console) {
  const present = MOVED.filter((n) => existsSync(join(appData, n)));
  if (!present.length) return;
  // The target already has a set-up computer's data (an earlier move that finished): never overwrite it.
  if (existsSync(join(target, "device.json")) || existsSync(join(target, "data"))) throw new Error("the data folder already holds data");
  try {
    for (const n of present) cpSync(join(appData, n), join(target, n), { recursive: true, errorOnExist: true, force: false });
    for (const n of present) {
      const a = sizes(join(appData, n));
      const b = sizes(join(target, n));
      for (const [f, size] of a) if (b.get(f) !== size) throw new Error(`${f} did not copy whole`);
    }
  } catch (e) {
    for (const n of present) rmSync(join(target, n), { recursive: true, force: true });
    throw e;
  }
  const aside = join(appData, `moved-to-${target.slice(0, 1)}-drive`);
  mkdirSync(aside, { recursive: true });
  for (const n of present) renameSync(join(appData, n), join(aside, n));
  log.log("[data] moved", present.join(", "), "to", target);
}

/** Every file under a path with its size. */
function sizes(path: string, base = "", out = new Map<string, number>()): Map<string, number> {
  const s = statSync(path);
  if (!s.isDirectory()) { out.set(base || ".", s.size); return out; }
  for (const f of readdirSync(path)) sizes(join(path, f), `${base}/${f}`, out);
  return out;
}
