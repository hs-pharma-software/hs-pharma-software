/** Keeps every statement the browser sends inside the caller's own business
 * (step 3b). Checking that a query mentions "tenant_id = ?" is not enough
 * ("... OR 1=1" defeats it), so statements are rewritten:
 *
 *  - every table read (FROM / JOIN, at any depth) is replaced by a filtered
 *    copy, (SELECT * FROM t WHERE tenant_id = '<tenant>'), so nothing the rest
 *    of the query says can reach another business's rows;
 *  - UPDATE and DELETE get "AND <same condition>" on their own WHERE;
 *  - INSERT must carry the caller's tenant (or an allowed owner) in its values;
 *  - an upsert on a shared table only updates a row the caller owns.
 *
 * Shared by design, and allowed: the shared product catalogue for pharmacy
 * businesses, a hospital / clinic reading its linked pharmacy's products, the
 * prescription mailbox between the two businesses that share a message, the
 * caller's own settings keys plus the global keys the app reads, and the
 * tenant list of hospital pharmacies. The Super Admin is not rewritten. */

export interface Scope {
  tenantId: string;
  /** Shared catalogue groups this business may see (catalogAccess.sharedCatalogGroupsFor). */
  sharedGroups: string[];
  /** Pharmacies this hospital / clinic has linked: their products are readable. */
  linkedPharmacies: string[];
  /** Staff HR records limited to the caller's own (sqlPolicy.personalScope). */
  personal?: { userId: string; readOwnOnly: string[]; writeOwnOnly: Record<string, string[]> };
}

/** table -> its columns (lower case). */
export type Schema = Map<string, Set<string>>;

export class ScopeError extends Error {}

const SHARED_CATALOG = new Set(["products", "categories", "sub_categories", "uoms"]);
/** Tables shared by exactly two businesses (lib/sync/tables.ts OWNER_COLUMNS). */
export const MAILBOX_OWNERS: Record<string, string[]> = {
  clinic_pharmacy_link: ["clinic_tenant_id", "pharmacy_tenant_id"],
  pharmacy_rx_notifications: ["pharmacy_tenant_id", "clinic_tenant_id"],
  pharmacy_rx_items: ["pharmacy_tenant_id", "clinic_tenant_id"],
};
/** Global settings the app reads for every business. The AI keys are not among
 * them: the server calls the AI service itself (src/server/ai.ts). */
export const GLOBAL_READABLE_SETTINGS = ["billori_model"];
/** The business's own settings that stay on the server. */
export const SERVER_ONLY_SETTINGS = ["ai_gemini_api_key"];
/** Readable by everyone, unfiltered. */
const OPEN_READ = new Set(["subscription_plans", "schema_migrations"]);
/** Local-only bookkeeping of the desktop app. */
const DESKTOP_ONLY = new Set(["sync_outbox", "sync_meta"]);

const RESERVED = new Set([
  "where", "join", "left", "right", "inner", "outer", "full", "cross", "natural", "on", "using", "group", "order", "limit", "offset",
  "union", "except", "intersect", "having", "window", "set", "values", "returning", "as", "and", "or", "not", "select", "from", "indexed",
]);

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const list = (xs: string[]) => xs.map(q).join(", ");

/** Same length as the SQL; string contents, comments and identifier quotes become spaces. */
export function maskSql(sql: string): string {
  let out = "";
  for (let i = 0; i < sql.length; ) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += "'" + " ".repeat(Math.max(0, j - i - 1)) + (j < sql.length ? "'" : "");
      i = j + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      const end = j < 0 ? sql.length : j;
      out += " ".repeat(end - i);
      i = end;
    } else if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2);
      const end = j < 0 ? sql.length : j + 2;
      out += " ".repeat(end - i);
      i = end;
    } else if (c === '"' || c === "`") {
      out += " ";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The caller's own staff record(s) in this business. */
const ownStaff = (s: Scope) =>
  `staff_id IN (SELECT id FROM staff WHERE tenant_id = ${q(s.tenantId)} AND user_id = ${q(s.personal!.userId)} AND deleted_at IS NULL)`;

/** Rows of `table` this business may see (null = no filter). */
function readCondition(table: string, s: Scope, schema: Schema): string | null {
  const t = table.toLowerCase();
  const base = businessCondition(t, s, schema);
  return base && s.personal?.readOwnOnly.includes(t) ? `(${base} AND ${ownStaff(s)})` : base;
}

function businessCondition(t: string, s: Scope, schema: Schema): string | null {
  if (OPEN_READ.has(t)) return null;
  if (DESKTOP_ONLY.has(t)) throw new ScopeError(`Table ${t} is not available.`);
  if (t === "tenants") return `(id = ${q(s.tenantId)} OR business_type = 'hospital_pharmacy'${s.linkedPharmacies.length ? ` OR id IN (${list(s.linkedPharmacies)})` : ""})`;
  if (t === "settings") {
    return `((substr(key, 1, ${s.tenantId.length + 2}) = ${q(`${s.tenantId}::`)} AND key NOT IN (${list(SERVER_ONLY_SETTINGS.map((k) => `${s.tenantId}::${k}`))})) OR key IN (${list(GLOBAL_READABLE_SETTINGS)}))`;
  }
  if (MAILBOX_OWNERS[t]) return `(${MAILBOX_OWNERS[t].map((c) => `${c} = ${q(s.tenantId)}`).join(" OR ")})`;
  if (SHARED_CATALOG.has(t)) {
    const parts = [`tenant_id = ${q(s.tenantId)}`];
    if (s.sharedGroups.length) {
      if (t === "uoms") parts.push("tenant_id IS NULL");
      else {
        parts.push(`(tenant_id IS NULL AND catalog_group IN (${list(s.sharedGroups)}))`);
        if (s.sharedGroups.includes("pharma")) parts.push("(tenant_id IS NULL AND catalog_group IS NULL)");
      }
    }
    if (t === "products" && s.linkedPharmacies.length) {
      parts.push(`tenant_id IN (${list(s.linkedPharmacies)})`, "(tenant_id IS NULL AND catalog_group = 'pharma')");
    }
    return `(${parts.join(" OR ")})`;
  }
  if (schema.get(t)?.has("tenant_id")) return `tenant_id = ${q(s.tenantId)}`;
  throw new ScopeError(`Table ${t} is not available.`);
}

/** Rows of `table` this business may change. Linked pharmacies are read-only. */
function writeCondition(table: string, s: Scope, schema: Schema): string {
  const t = table.toLowerCase();
  if (t === "settings") return `substr(key, 1, ${s.tenantId.length + 2}) = ${q(`${s.tenantId}::`)}`;
  if (t === "tenants" || t === "subscription_plans" || OPEN_READ.has(t)) throw new ScopeError("Only the Super Admin changes this.");
  if (SHARED_CATALOG.has(t)) return readCondition(t, { ...s, linkedPharmacies: [] }, schema)!;
  const c = readCondition(t, s, schema);
  if (!c) throw new ScopeError(`Table ${t} cannot be changed.`);
  return s.personal?.writeOwnOnly[t] ? `(${c} AND ${ownStaff(s)})` : c;
}

/** Top-level (paren depth 0) keyword positions in the masked SQL from `from`. */
function topLevel(mask: string, from: number, re: RegExp): { index: number; length: number } | null {
  let depth = 0;
  for (let i = from; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /[A-Za-z]/.test(ch) && (i === 0 || !/[A-Za-z0-9_]/.test(mask[i - 1]))) {
      const m = re.exec(mask.slice(i));
      if (m && m.index === 0) return { index: i, length: m[0].length };
    }
  }
  return null;
}

interface Edit { at: number; end: number; text: string }

function applyEdits(sql: string, edits: Edit[]): string {
  let out = sql;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}

/** Splits "a, (b, c), d" at top-level commas: [start, end) ranges. */
function splitTop(mask: string, start: number, end: number): [number, number][] {
  const parts: [number, number][] = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i++) {
    if (mask[i] === "(") depth++;
    else if (mask[i] === ")") depth--;
    else if (mask[i] === "," && depth === 0) {
      parts.push([from, i]);
      from = i + 1;
    }
  }
  parts.push([from, end]);
  return parts;
}

function closingParen(mask: string, open: number): number {
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === "(") depth++;
    else if (mask[i] === ")" && --depth === 0) return i;
  }
  throw new ScopeError("Unbalanced parentheses.");
}

/** Rewrites one statement so it stays inside the caller's business. */
export function scopeStatement(sql: string, args: unknown[], s: Scope, schema: Schema): string {
  const mask = maskSql(sql);
  if (/\?\d|[:@$][A-Za-z_]/.test(mask.replace(/'[^']*'/g, ""))) throw new ScopeError("Use plain ? parameters.");
  const head = (/^\s*([A-Za-z]+)/.exec(mask)?.[1] ?? "").toLowerCase();
  // A CTE in front of a write would escape the target scoping below.
  if (head === "with" && /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(mask)) throw new ScopeError("Write without a WITH clause.");
  const edits: Edit[] = [];

  const ctes = new Set<string>();
  for (const m of mask.matchAll(/(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*\(/gi)) ctes.add(m[1].toLowerCase());

  // 1. Every table read, at any depth.
  for (const m of mask.matchAll(/\b(FROM|JOIN)(\s+)([A-Za-z_][A-Za-z0-9_]*)/gi)) {
    const name = m[3];
    const lower = name.toLowerCase();
    const nameAt = m.index! + m[1].length + m[2].length;
    const after = mask.slice(nameAt + name.length);
    if (/^\s*\(/.test(after) || ctes.has(lower) || RESERVED.has(lower)) continue;
    if (/\bDELETE\s*$/i.test(mask.slice(0, m.index!))) continue; // DELETE FROM target: scoped by its WHERE below
    const cond = readCondition(lower, s, schema);
    if (!cond) continue;
    const alias = /^\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(after);
    const hasAlias = alias && !RESERVED.has(alias[1].toLowerCase());
    edits.push({ at: nameAt, end: nameAt + name.length, text: `(SELECT * FROM ${name} WHERE ${cond})${hasAlias ? "" : ` AS ${name}`}` });
  }

  // 2. The statement's own target.
  if (head === "update" || head === "delete") {
    const target = head === "update"
      ? /^\s*UPDATE\s+(?:OR\s+\w+\s+)?([A-Za-z_][A-Za-z0-9_]*)/i.exec(mask)
      : /^\s*DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(mask);
    if (!target) throw new ScopeError("Unrecognised statement.");
    const table = target[1].toLowerCase();
    const cond = writeCondition(table, s, schema);
    const bodyStart = target.index + target[0].length;
    if (head === "update") {
      const setAt = topLevel(mask, bodyStart, /^SET\b/i);
      const whereAt = topLevel(mask, bodyStart, /^WHERE\b/i);
      const assignments = mask.slice(setAt ? setAt.index + 3 : bodyStart, whereAt ? whereAt.index : mask.length);
      if (/\btenant_id\s*=/i.test(assignments)) throw new ScopeError("Records cannot be moved to another business.");
      if (table === "users" && /\b(role|username)\s*=/i.test(assignments)) throw new ScopeError("A login's role and username are changed by the Super Admin.");
      if (MAILBOX_OWNERS[table] && MAILBOX_OWNERS[table].some((c) => new RegExp(`\\b${c}\\s*=`, "i").test(assignments))) throw new ScopeError("The businesses of a shared record cannot be changed.");
      const own = s.personal?.writeOwnOnly[table];
      if (own) {
        const changed = [...assignments.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1].toLowerCase());
        if (changed.some((c) => !own.includes(c))) throw new ScopeError("On your own HR record you can only acknowledge an appraisal.");
      }
    }
    const whereAt = topLevel(mask, bodyStart, /^WHERE\b/i);
    const tail = topLevel(mask, whereAt ? whereAt.index : bodyStart, /^(ORDER\s+BY|LIMIT|RETURNING)\b/i);
    const end = tail ? tail.index : mask.replace(/[\s;]+$/, "").length;
    if (whereAt) {
      const condStart = whereAt.index + whereAt.length;
      edits.push({ at: condStart, end: condStart, text: " (" });
      edits.push({ at: end, end, text: `) AND ${cond} ` });
    } else {
      edits.push({ at: end, end, text: ` WHERE ${cond} ` });
    }
  } else if (head === "insert" || head === "replace") {
    const target = /^\s*(?:INSERT\s+(?:OR\s+(\w+)\s+)?|REPLACE\s+)INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i.exec(mask);
    if (!target) throw new ScopeError("An insert must list its columns.");
    if (head === "replace" || /^replace$/i.test(target[1] ?? "")) throw new ScopeError("Use a plain insert.");
    const table = target[2].toLowerCase();
    if (table === "users") throw new ScopeError("Logins are created through the server.");
    if (table === "tenants" || table === "subscription_plans") throw new ScopeError("Only the Super Admin changes this.");
    const open = target.index + target[0].length - 1;
    const close = closingParen(mask, open);
    const cols = splitTop(mask, open + 1, close).map(([a, b]) => mask.slice(a, b).trim().toLowerCase());
    const valuesAt = topLevel(mask, close + 1, /^VALUES\b/i);
    if (!valuesAt) throw new ScopeError("An insert must use VALUES.");

    // Which column(s) must hold the caller's business, and what NULL may mean there.
    const owners = MAILBOX_OWNERS[table];
    const keyCol = table === "settings" ? "key" : null;
    const tenantCol = !owners && !keyCol ? "tenant_id" : null;
    if (tenantCol && !schema.get(table)?.has("tenant_id")) throw new ScopeError(`Table ${table} cannot be changed.`);
    if (tenantCol && !cols.includes("tenant_id")) throw new ScopeError("An insert must say which business the record belongs to.");

    // Positional ? numbering over the whole statement.
    const qmarks: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === "?") qmarks.push(i);
    const valueAt = (a: number, b: number): { ok: boolean; value?: unknown } => {
      const text = mask.slice(a, b).trim();
      const raw = sql.slice(a, b).trim();
      if (text === "?") return { ok: true, value: args[qmarks.indexOf(a + mask.slice(a, b).indexOf("?"))] };
      if (/^NULL$/i.test(text)) return { ok: true, value: null };
      if (/^'[\s\S]*'$/.test(raw)) return { ok: true, value: raw.slice(1, -1).replace(/''/g, "'") };
      return { ok: false };
    };

    let pos = valuesAt.index + valuesAt.length;
    let tuples = 0;
    for (;;) {
      const open2 = mask.indexOf("(", pos);
      if (open2 < 0 || mask.slice(pos, open2).trim().replace(/^,/, "").trim()) break;
      const close2 = closingParen(mask, open2);
      const vals = splitTop(mask, open2 + 1, close2);
      if (vals.length !== cols.length) throw new ScopeError("Columns and values do not match.");
      tuples++;
      const get = (col: string) => { const i = cols.indexOf(col); return i < 0 ? { ok: true, value: undefined } : valueAt(vals[i][0], vals[i][1]); };
      if (tenantCol) {
        const v = get("tenant_id");
        if (!v.ok) throw new ScopeError("The business of a new record must be a plain value.");
        const shared = v.value === null && SHARED_CATALOG.has(table) && s.sharedGroups.length > 0;
        if (v.value !== s.tenantId && !shared) throw new ScopeError("A record can only be added to your own business.");
      } else if (owners) {
        const mine = owners.some((c) => get(c).value === s.tenantId);
        if (!mine) throw new ScopeError("A shared record must include your own business.");
      } else if (keyCol) {
        const v = get("key");
        if (!v.ok || typeof v.value !== "string" || !v.value.startsWith(`${s.tenantId}::`)) throw new ScopeError("Only your own business's settings can be saved.");
      }
      pos = close2 + 1;
    }
    if (!tuples) throw new ScopeError("An insert must use VALUES.");

    // An upsert may only update a row the caller may change.
    const conflict = topLevel(mask, pos, /^ON\s+CONFLICT\b/i);
    if (conflict) {
      if (tenantCol) throw new ScopeError("Upserts are not used on business records.");
      const doUpdate = topLevel(mask, conflict.index, /^DO\s+UPDATE\s+SET\b/i);
      if (doUpdate) {
        const cond = writeCondition(table, s, schema).replace(/\b(key|clinic_tenant_id|pharmacy_tenant_id|tenant_id)\b/g, `${table}.$1`);
        const where = topLevel(mask, doUpdate.index + doUpdate.length, /^WHERE\b/i);
        const ret = topLevel(mask, doUpdate.index + doUpdate.length, /^RETURNING\b/i);
        const end = ret ? ret.index : mask.replace(/[\s;]+$/, "").length;
        if (where) {
          edits.push({ at: where.index + where.length, end: where.index + where.length, text: " (" });
          edits.push({ at: end, end, text: `) AND ${cond} ` });
        } else edits.push({ at: end, end, text: ` WHERE ${cond} ` });
      }
    }
  } else if (head !== "select" && head !== "with" && head !== "values") {
    throw new ScopeError("Unrecognised statement.");
  }
  return applyEdits(sql, edits);
}
