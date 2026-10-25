import { dbSelect } from "./db";
import { isTauriShell } from "./platform";

/** The schema version this code needs: the last migration in
 * src-tauri/src/lib.rs (a test keeps the two equal). */
export const REQUIRED_SCHEMA_VERSION = 53;

export type SchemaStatus =
  | { state: "ok"; version: number }
  | { state: "behind"; version: number }
  /** No migration history in the shared database yet (before migrate-turso.cjs recorded one). */
  | { state: "unknown" };

/** Read-only: the shared (Turso) database's recorded migration version
 * against what this code needs. The desktop app migrates its own database
 * at startup, so it is always "ok" there. Never runs a migration. */
export async function sharedSchemaStatus(): Promise<SchemaStatus> {
  if (isTauriShell()) return { state: "ok", version: REQUIRED_SCHEMA_VERSION };
  let rows: { v: number | null }[];
  try {
    rows = await dbSelect<{ v: number | null }>(`SELECT MAX(version) AS v FROM schema_migrations`);
  } catch {
    return { state: "unknown" };
  }
  const version = Number(rows[0]?.v ?? 0);
  if (!version) return { state: "unknown" };
  return version >= REQUIRED_SCHEMA_VERSION ? { state: "ok", version } : { state: "behind", version };
}
