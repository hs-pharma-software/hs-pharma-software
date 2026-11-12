/** Mavin Pharmacy Offline: backups and restore.
 *
 * Backup: a consistent copy of the whole local database (SQLite VACUUM INTO),
 * made while the app runs. Restore: the file is checked first (a MAVIN
 * Pharmacy database that passes SQLite's integrity check), the current data is
 * kept as a safety copy, then the backup takes its place. This installation's
 * identity and license stay its own (a license is bound to the installation),
 * so restoring another computer's backup cannot copy that computer's license. */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** Kept from the current installation through a restore. */
export const IDENTITY_KEYS = ["installation_id", "license", "trial_started_at", "clock_high_water"];

export class BackupError extends Error {}

export function backupTo(db: DatabaseSync, dest: string): { path: string; bytes: number } {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest);
  db.prepare("VACUUM INTO ?").run(dest);
  return { path: dest, bytes: statSync(dest).size };
}

/** Throws unless the file is a readable MAVIN Pharmacy Offline database. */
export function checkBackup(file: string): { pharmacy: string | null; installationId: string | null } {
  let d: DatabaseSync | null = null;
  try {
    d = new DatabaseSync(file, { readOnly: true });
    const ok = (d.prepare("PRAGMA integrity_check").get() as Record<string, unknown>)?.integrity_check;
    if (ok !== "ok") throw new BackupError("The backup file is damaged (integrity check failed).");
    for (const t of ["tenants", "users", "products", "invoices", "standalone_meta"]) {
      if (!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t)) throw new BackupError("This file is not a Mavin Pharmacy Offline backup.");
    }
    const pharmacy = (d.prepare(`SELECT name FROM tenants LIMIT 1`).get() as { name?: string } | undefined)?.name ?? null;
    const installationId = (d.prepare(`SELECT value FROM standalone_meta WHERE key = 'installation_id'`).get() as { value?: string } | undefined)?.value ?? null;
    return { pharmacy, installationId };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("This file is not a Mavin Pharmacy Offline backup.");
  } finally {
    try { d?.close(); } catch { /* closed */ }
  }
}

/** Replaces the database file with the backup (the database must be closed).
 * Returns the safety copy of the data that was replaced. */
export function swapIn(dbFile: string, backupFile: string, identity: Record<string, string | null>, now = new Date()): string {
  const safety = join(dirname(dbFile), `before-restore-${now.toISOString().replace(/[:.]/g, "-")}.db`);
  copyFileSync(dbFile, safety);
  for (const ext of ["-wal", "-shm"]) if (existsSync(dbFile + ext)) rmSync(dbFile + ext);
  copyFileSync(backupFile, dbFile);
  const d = new DatabaseSync(dbFile);
  try {
    const t = now.toISOString();
    for (const [k, v] of Object.entries(identity)) {
      if (v === null) d.prepare(`DELETE FROM standalone_meta WHERE key = ?`).run(k);
      else d.prepare(`INSERT INTO standalone_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(k, v, t);
    }
  } finally {
    d.close();
  }
  return safety;
}
