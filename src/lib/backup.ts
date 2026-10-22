import { appDataDir, join } from "@tauri-apps/api/path";
import { readFile, writeFile, exists } from "@tauri-apps/plugin-fs";
import { save, open } from "@tauri-apps/plugin-dialog";

async function getDbPath(): Promise<string> {
  const dir = await appDataDir();
  return join(dir, "pharmacy.db");
}

/** Copies the local SQLite file to a location the user picks. This backs up
 * exactly what's on this machine, independent of whether Turso sync has run
 * \u2014 useful as a last-resort recovery path if sync/Turso is unavailable. */
export async function createLocalBackup(): Promise<string | null> {
  const dbPath = await getDbPath();
  if (!(await exists(dbPath))) {
    throw new Error("No local database file found yet \u2014 add some data first.");
  }
  const bytes = await readFile(dbPath);
  const dest = await save({
    defaultPath: `pharmacy-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: "SQLite Database", extensions: ["db"] }],
  });
  if (!dest) return null;
  await writeFile(dest, bytes);
  return dest;
}

/** Overwrites the local database file with a previously-saved backup. The
 * running app already has the old file open, so this takes effect after the
 * app is restarted (the SQL plugin connection isn't torn down mid-session). */
export async function restoreLocalBackup(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "SQLite Database", extensions: ["db", "gz"] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  const bytes = await readFile(selected);
  const dbPath = await getDbPath();
  await writeFile(dbPath, bytes);
  return selected;
}
