/** The desktop app's local copy of a business (Phase 1): the first full copy
 * of every table the signed-in login may read, then only the rows that
 * changed since (from data_changes, filled by triggers, migration v88).
 *
 * Everything is read AS THAT LOGIN, through the same rules as /api/db
 * (sqlPolicy.authorize + the tenantScope rewrite): a staff login's copy holds
 * exactly what it may read online (its branch, no purchase prices when they
 * are hidden from it), never another business's rows. Passwords, secrets
 * and credentials never leave the server. */
import { checkStatements, HttpError } from "./db";
import { costHidden, HIDDEN_COLUMNS, type Caller } from "./sqlPolicy";
import type { Schema, Scope } from "./tenantScope";
import type { Sql } from "./subSupers";
import { REPLICA_EXCLUDED, replicaTableKind } from "./replicaTables";

export interface ReplicaInfo { names: Set<string>; schema: Schema }
export const REPLICA_PAGE = 1000;
const CHANGES_PAGE = 2000;
const IN_CHUNK = 400;

const SECRET_COLUMN = /pass(word)?|secret|token|hash|salt|api_?key|private/i;
/** Settings holding credentials (FBR tokens, AI keys ...) never leave. */
const SECRET_SETTING = /token|secret|api_?key|pass(word)?|private|pin\b|credential/i;

/** The column a table's rows are paged and looked up by. */
const keyOf = (table: string) => (table === "settings" ? "key" : "id");

function needBusiness(caller: Caller) {
  if (caller.role === "super_admin" || !caller.tenantId) throw new HttpError(403, "The local copy is for a business login.");
}

/** Runs one SELECT as the login (policy check and business rewrite); null when the login may not read it. */
async function readAs(sql: Sql, caller: Caller, info: ReplicaInfo, branch: Scope["branch"] | undefined, text: string, args: unknown[]) {
  let rewritten: string;
  try {
    rewritten = checkStatements(caller, [{ sql: text, args }], info.names, info.schema, branch)[0].sql;
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) return null;
    throw e;
  }
  return (await sql.execute(rewritten, args)).rows;
}

/** Removes what never leaves the server: password and secret columns, purchase prices hidden from this login, credential settings. */
function clean(caller: Caller, table: string, rows: Record<string, unknown>[]) {
  const hideCost = costHidden(caller);
  return rows
    .filter((r) => table !== "settings" || !SECRET_SETTING.test(String(r.key).slice(String(r.key).indexOf("::") + 2)))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => {
      const c = k.toLowerCase();
      return !HIDDEN_COLUMNS.has(c) && !SECRET_COLUMN.test(c) && !(hideCost && c === "purchase_price");
    })));
}

/** The tables this login's copy holds (those it may read), and the change-log position to follow from after the first copy. */
export async function replicaTables(sql: Sql, caller: Caller, info: ReplicaInfo, branch?: Scope["branch"]) {
  needBusiness(caller);
  const tables: string[] = [];
  for (const [t, cols] of info.schema) {
    if (REPLICA_EXCLUDED.has(t) || !replicaTableKind(t, [...cols]) || !cols.has(keyOf(t))) continue;
    // The policy check alone (no database access) decides whether this login may read the table.
    try {
      checkStatements(caller, [{ sql: `SELECT * FROM ${t}`, args: [] }], info.names, info.schema, branch);
      tables.push(t);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 403)) throw e;
    }
  }
  tables.sort();
  const seq = Number((await sql.execute(`SELECT COALESCE(MAX(seq), 0) AS m FROM data_changes`)).rows[0]?.m ?? 0);
  return { tables, seq };
}

function allowed(info: ReplicaInfo, table: unknown): string {
  const t = String(table ?? "").toLowerCase();
  const cols = info.schema.get(t);
  if (!cols || REPLICA_EXCLUDED.has(t) || !replicaTableKind(t, [...cols]) || !cols.has(keyOf(t))) throw new HttpError(400, "Unknown table.");
  return t;
}

/** One page of the first copy of a table, in key order (resumable: `after` is the last key received). */
export async function replicaPage(sql: Sql, caller: Caller, info: ReplicaInfo, branch: Scope["branch"] | undefined, table: unknown, after: unknown) {
  needBusiness(caller);
  const t = allowed(info, table);
  const k = keyOf(t);
  const from = typeof after === "string" ? after : "";
  const rows = await readAs(sql, caller, info, branch, `SELECT * FROM ${t} WHERE ${k} > ? ORDER BY ${k} LIMIT ?`, [from, REPLICA_PAGE + 1]);
  if (rows === null) return { table: t, rows: [], next: null as string | null };
  const more = rows.length > REPLICA_PAGE;
  const page = rows.slice(0, REPLICA_PAGE);
  return { table: t, rows: clean(caller, t, page), next: more ? String(page[page.length - 1][k]) : null };
}

/** The rows changed after `since` (this business's, and shared catalogue rows):
 * current values of those this login may read, and the keys to remove (deleted,
 * or no longer readable by it). */
export async function replicaChanges(sql: Sql, caller: Caller, info: ReplicaInfo, branch: Scope["branch"] | undefined, since: unknown, tables: Set<string>) {
  needBusiness(caller);
  const from = Number.isInteger(Number(since)) && Number(since) >= 0 ? Number(since) : 0;
  // Older than the kept log (a computer switched off for weeks): it copies everything again.
  const oldest = Number((await sql.execute(`SELECT COALESCE(MIN(seq), 0) AS m FROM data_changes`)).rows[0]?.m ?? 0);
  if (from > 0 && oldest > from + 1) return { upserts: {}, deletes: {}, seq: from, more: false, reset: true };
  const log = (await sql.execute(
    `SELECT seq, tbl, row_id FROM data_changes WHERE seq > ? AND (tenant_id = ? OR tenant_id IS NULL) ORDER BY seq LIMIT ?`,
    [from, caller.tenantId, CHANGES_PAGE],
  )).rows;
  const byTable = new Map<string, Set<string>>();
  for (const r of log) {
    const t = String(r.tbl);
    if (!tables.has(t)) continue;
    if (!byTable.has(t)) byTable.set(t, new Set());
    byTable.get(t)!.add(String(r.row_id));
  }
  const upserts: Record<string, Record<string, unknown>[]> = {};
  const deletes: Record<string, string[]> = {};
  for (const [t, idSet] of byTable) {
    const k = keyOf(t);
    const ids = [...idSet];
    const found = new Set<string>();
    const got: Record<string, unknown>[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const part = ids.slice(i, i + IN_CHUNK);
      const rows = await readAs(sql, caller, info, branch, `SELECT * FROM ${t} WHERE ${k} IN (${part.map(() => "?").join(",")})`, part);
      for (const r of rows ?? []) { found.add(String(r[k])); got.push(r); }
    }
    if (got.length) upserts[t] = clean(caller, t, got);
    const gone = ids.filter((id) => !found.has(id));
    if (gone.length) deletes[t] = gone;
  }
  const last = log.length ? Number(log[log.length - 1].seq) : from;
  return { upserts, deletes, seq: last, more: log.length === CHANGES_PAGE, reset: false };
}

/** Keeps the change log bounded (daily job): entries older than `days` go;
 * a computer whose position is older copies everything again. */
export async function pruneDataChanges(sql: Sql, days = 45) {
  const cut = new Date(Date.now() - days * 86_400_000).toISOString();
  const r = await sql.execute(`DELETE FROM data_changes WHERE seq < (SELECT COALESCE(MIN(seq), 0) FROM data_changes WHERE changed_at >= ?)`, [cut]);
  return { removed: r.rowsAffected };
}
