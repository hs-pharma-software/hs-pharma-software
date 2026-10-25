/** What the browser may ask the database to do through /api/db. The app
 * sends parameterized statements; the server refuses anything that is not
 * plain data access by a logged-in user: schema changes, several statements
 * in one, unknown tables, password columns, and writes reserved for the
 * Super Admin. (Tenant isolation of rows is a further step.) */

export type Verb = "select" | "insert" | "update" | "delete" | "other";

export interface Analysis {
  verb: Verb;
  /** Tables read or written (CTE names and table-valued functions excluded). */
  tables: string[];
  /** More than one statement in the text. */
  multiple: boolean;
  /** Mentions a password column. */
  touchesPassword: boolean;
}

/** Removes string literals, quoted identifiers' quotes and comments, so
 * keywords are only matched in real SQL. */
function strip(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/g, "$1")
    .replace(/`([A-Za-z_][A-Za-z0-9_]*)`/g, "$1")
    .replace(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g, "$1");
}

const TABLE_FUNCTIONS = new Set(["pragma_table_info", "json_each", "json_tree"]);

export function analyzeSql(sql: string): Analysis {
  const s = strip(sql).trim();
  const body = s.replace(/;\s*$/, "");
  const multiple = /;/.test(body);
  const first = (/^\s*([A-Za-z]+)/.exec(body)?.[1] ?? "").toUpperCase();
  let verb: Verb = "other";
  if (first === "SELECT" || first === "VALUES") verb = "select";
  else if (first === "INSERT" || first === "REPLACE") verb = "insert";
  else if (first === "UPDATE") verb = "update";
  else if (first === "DELETE") verb = "delete";
  else if (first === "WITH") {
    // A CTE in front of a write is that write.
    const tail = body.replace(/\([^()]*\)/g, "()");
    verb = /\bDELETE\s+FROM\b/i.test(tail) ? "delete" : /\bUPDATE\b/i.test(tail) ? "update" : /\bINSERT\b/i.test(tail) ? "insert" : "select";
  }
  const ctes = new Set<string>();
  for (const m of body.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*\(/gi)) ctes.add(m[1].toLowerCase());
  const tables = new Set<string>();
  for (const m of body.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/gi)) {
    const name = m[1].toLowerCase();
    if (m[2] && TABLE_FUNCTIONS.has(name)) continue;
    if (ctes.has(name)) continue;
    if (["select", "values", "set", "where", "only"].includes(name)) continue;
    tables.add(name);
  }
  return { verb, tables: [...tables], multiple, touchesPassword: /\bpassword_(hash|salt)\b/i.test(body) };
}

export interface Caller {
  userId: string;
  role: "super_admin" | "owner" | "staff";
  tenantId: string | null;
  /** Staff module permissions; null = full access. */
  permissions?: string[] | null;
  businessType?: string | null;
  /** Pharmacies this hospital / clinic has linked (their products are readable). */
  linkedPharmacies?: string[];
}

/** Only the Super Admin changes tenants and subscription plans (Admin screens). */
const SUPER_ADMIN_WRITES = new Set(["tenants", "subscription_plans"]);
/** Logins are created and passwords changed through /api/auth only. */
const AUTH_ONLY_WRITES = new Set(["users"]);
/** Device-only tables and internal tables are never reached from the browser. */
const NEVER = new Set(["local_secrets", "local_assets", "sqlite_master", "sqlite_schema", "sqlite_sequence", "server_audit_log"]);

/** Staff HR records (MSDS HRM): HR has them in full, the quality team reads
 * them for the self-assessment, and everyone else sees only their own. */
export const HR_PERSONAL_TABLES = ["hospital_appraisals", "hospital_staff_credentials", "hospital_staff_training"];
/** What staff may change on their own HR record: acknowledging an appraisal. */
export const OWN_RECORD_COLUMNS: Record<string, string[]> = { hospital_appraisals: ["status", "acknowledged_at", "staff_comments", "updated_at"] };

export type HrAccess = "full" | "read" | "own";
export function hrAccess(caller: Caller): HrAccess {
  if (caller.role !== "staff" || !Array.isArray(caller.permissions)) return "full";
  if (caller.permissions.includes("hospital_hr")) return "full";
  return caller.permissions.includes("hospital_quality") ? "read" : "own";
}

/** Row limits for the statement rewrite (tenantScope.ts); undefined = none. */
export function personalScope(caller: Caller): { userId: string; readOwnOnly: string[]; writeOwnOnly: Record<string, string[]> } | undefined {
  const access = hrAccess(caller);
  if (access === "full") return undefined;
  return { userId: caller.userId, readOwnOnly: access === "own" ? HR_PERSONAL_TABLES : [], writeOwnOnly: OWN_RECORD_COLUMNS };
}

export type Decision = { ok: true } | { ok: false; reason: string };

/** Whether a caller may run this statement. `knownTables` is the database's own table list. */
export function authorize(a: Analysis, caller: Caller, knownTables: Set<string>): Decision {
  if (a.multiple) return { ok: false, reason: "Send one statement at a time." };
  if (a.verb === "other") return { ok: false, reason: "Schema changes run only from the migration script." };
  if (a.touchesPassword) return { ok: false, reason: "Passwords are checked and changed by the server only." };
  for (const t of a.tables) {
    if (NEVER.has(t) || t.startsWith("sqlite_")) return { ok: false, reason: `Table ${t} is not available.` };
    if (!knownTables.has(t)) return { ok: false, reason: `Unknown table ${t}.` };
  }
  // Hospital records are for logins with a hospital section (a pharmacy cashier's login has none).
  if (caller.role === "staff" && Array.isArray(caller.permissions) && a.tables.some((t) => t.startsWith("hospital_"))
      && !caller.permissions.some((p) => p.startsWith("hospital_"))) {
    return { ok: false, reason: "Your login has no access to hospital records." };
  }
  if (a.verb !== "select") {
    const access = hrAccess(caller);
    for (const t of a.tables) {
      if (!HR_PERSONAL_TABLES.includes(t) || access === "full") continue;
      // The quality team records training; staff acknowledge their own appraisal (columns and row checked by the rewrite).
      if (access === "read" && t === "hospital_staff_training") continue;
      if (a.verb === "update" && OWN_RECORD_COLUMNS[t]) continue;
      return { ok: false, reason: "Staff HR records are changed by HR." };
    }
    for (const t of a.tables) {
      if (SUPER_ADMIN_WRITES.has(t) && caller.role !== "super_admin") return { ok: false, reason: "Only the Super Admin changes tenants and plans." };
      // Profile fields (name, permissions, active) are edited by owners / Super Admin; passwords are blocked above.
      if (AUTH_ONLY_WRITES.has(t) && caller.role === "staff") return { ok: false, reason: "Only the owner manages logins." };
    }
  }
  return { ok: true };
}

/** Columns never returned to the browser. */
export const HIDDEN_COLUMNS = new Set(["password_hash", "password_salt"]);
