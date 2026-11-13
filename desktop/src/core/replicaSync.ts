/** The local copy of the business (Phase 1): the first full copy of every
 * table the signed-in login may read, then only the rows changed since,
 * from MAVIN.pk's change log (/api/replica, read as that login). Screens read
 * this copy while it is complete and nothing saved here is still on its way.
 *
 * The first copy is resumable (table by table, page by page): a closed app or
 * a dropped connection continues where it stopped. */
import type { Mirror } from "./mirror";

/** POST /api/replica as the signed-in login; resolves the `result`. */
export type ReplicaCall = <T>(body: Record<string, unknown>) => Promise<T>;

export const keyOf = (table: string) => (table === "settings" ? "key" : "id");

interface Progress { tables: string[]; seq: number; index: number; after: string }

/** Whether the copy is complete (screens may read it). */
export const copyReady = (m: Mirror) => m.meta("replica_ready") === "1";

/** The tables the copy holds (those this login may read). */
export function copiedTables(m: Mirror): Set<string> {
  try { return new Set(JSON.parse(m.meta("replica_tables") ?? "[]") as string[]); } catch { return new Set(); }
}

/** Fills the copy: every table, page by page, then marks it ready. Tables
 * that appeared on the server since (a newer MAVIN version) are copied too;
 * tables this login may no longer read are emptied. Returns pages copied. */
export async function fillCopy(m: Mirror, call: ReplicaCall, onProgress?: (done: number, total: number) => void): Promise<number> {
  let p: Progress | null = null;
  try { p = JSON.parse(m.meta("replica_fill") ?? "null") as Progress | null; } catch { p = null; }
  if (!p) {
    const r = await call<{ tables: string[]; seq: number }>({ action: "tables" });
    const have = copyReady(m) ? copiedTables(m) : new Set<string>();
    const known = m.tableNames();
    // A ready copy only needs the tables it does not have yet.
    const todo = r.tables.filter((t) => known.has(t) && !have.has(t));
    for (const t of have) if (!r.tables.includes(t)) m.clearTable(t);
    if (copyReady(m) && !todo.length) {
      m.setMeta("replica_tables", JSON.stringify(r.tables.filter((t) => known.has(t))));
      return 0;
    }
    p = { tables: todo, seq: copyReady(m) ? Number(m.meta("replica_cursor") ?? r.seq) : r.seq, index: 0, after: "" };
    m.setMeta("replica_all", JSON.stringify(r.tables.filter((t) => known.has(t))));
    m.setMeta("replica_fill", JSON.stringify(p));
  }
  let pages = 0;
  while (p.index < p.tables.length) {
    const table = p.tables[p.index];
    if (p.after === "") m.clearTable(table);
    const page = await call<{ rows: Record<string, unknown>[]; next: string | null }>({ action: "page", table, after: p.after });
    const next: Progress = page.next === null ? { ...p, index: p.index + 1, after: "" } : { ...p, after: page.next };
    // The rows and where to continue from, saved together.
    m.applyChanges({ [table]: page.rows }, {}, keyOf, () => m.setMeta("replica_fill", JSON.stringify(next)));
    p = next;
    pages++;
    onProgress?.(p.index, p.tables.length);
  }
  // Changes made while copying are applied next from the position taken before the copy started.
  m.setMeta("replica_tables", m.meta("replica_all") ?? "[]");
  if (!copyReady(m)) m.setMeta("replica_cursor", String(p.seq));
  m.setMeta("replica_ready", "1");
  m.setMeta("replica_fill", "null");
  m.setMeta("replica_filled_at", new Date().toISOString());
  return pages;
}

/** Brings a ready copy up to date from the change log. Returns rows changed. */
export async function followCopy(m: Mirror, call: ReplicaCall): Promise<number> {
  if (!copyReady(m)) return 0;
  let n = 0;
  for (let i = 0; i < 100; i++) {
    const since = Number(m.meta("replica_cursor") ?? 0);
    const r = await call<{ upserts: Record<string, Record<string, unknown>[]>; deletes: Record<string, string[]>; seq: number; more: boolean; reset?: boolean }>({ action: "changes", since });
    if (r.reset) {
      // Off for longer than MAVIN.pk keeps its change log: copy everything again (screens use MAVIN.pk meanwhile).
      for (const k of ["replica_ready", "replica_tables", "replica_cursor"]) m.setMeta(k, k === "replica_tables" ? "[]" : "");
      m.setMeta("replica_fill", "null");
      await fillCopy(m, call);
      continue;
    }
    m.applyChanges(r.upserts, r.deletes, keyOf, () => m.setMeta("replica_cursor", String(r.seq)));
    n += Object.values(r.upserts).reduce((s, x) => s + x.length, 0) + Object.values(r.deletes).reduce((s, x) => s + x.length, 0);
    if (!r.more) break;
  }
  m.setMeta("replica_followed_at", new Date().toISOString());
  return n;
}

const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

/** A read the copy can answer: no word of it names a table the copy leaves
 * out (such as FBR submissions), wherever it appears (FROM, JOIN, a comma
 * list, a subquery). Strict on purpose: when unsure, the server answers. */
export function answerableLocally(sql: string, copied: Set<string>, schemaTables: Set<string>): boolean {
  const body = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/'(?:[^']|'')*'/g, "''");
  for (const m of body.matchAll(WORD)) {
    const t = m[0].toLowerCase();
    if (schemaTables.has(t) && !copied.has(t)) return false;
  }
  return true;
}
