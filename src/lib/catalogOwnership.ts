/**
 * One-time catalog ownership migration (schema v29).
 *
 * Until v29, products / categories / sub_categories / uoms / generic_names
 * were ONE catalog shared by every tenant, so a restaurant or a general
 * store saw every pharmacy's medicines. This assigns each existing catalog
 * row to the tenant that provably uses it:
 *
 *  - Evidence for products is the tenant-scoped rows that reference them
 *    (stock batches, price list, invoice / order / purchase / audit lines,
 *    supplier assignments). One tenant -> that tenant owns it.
 *  - Used by several tenants -> the tenant that used it first keeps the
 *    original id; every other tenant gets its own copy and ITS rows are
 *    re-pointed to that copy (deterministic id `<id>~<tenant>`).
 *  - No evidence, or evidence without a tenant -> left unowned
 *    (quarantined: no tenant query returns it) for Super Admin review.
 *  - Categories, sub categories, units and generic names follow the
 *    products (and lines) of each tenant the same way.
 *
 * Nothing is deleted. Every change is written to catalog_ownership_log
 * (with the old value) so a run can be rolled back. Idempotent: rows that
 * already have a tenant are left alone and copies are not made twice.
 * Pure (DB port injected) so it runs against Turso and in node tests.
 */

export interface OwnDb {
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}

type Table = "products" | "categories" | "sub_categories" | "uoms" | "generic_names";

/** Tenant-scoped tables whose rows point at catalog rows. */
const PRODUCT_REFS = ["product_batches", "price_list", "invoice_items", "purchase_items", "order_items", "product_suppliers", "audit_items"] as const;
const UOM_REFS = ["invoice_items", "order_items", "purchase_items"] as const;

export const cloneId = (id: string, tenantId: string) => `${id}~${tenantId}`;

export interface Decision {
  table: Table;
  id: string;
  name: string;
  /** Tenant keeping the original row, null = quarantined. */
  owner: string | null;
  /** Other tenants that get their own copy. */
  copies: string[];
  reason: string;
}

export interface Plan {
  decisions: Decision[];
  /** Child-row re-points: rows of `tenant` now pointing at that tenant's copy. */
  repoints: { table: string; column: string; id: string; tenant: string; from: string; to: string }[];
  /** Catalog rows whose references must be re-pointed to the owner's copy. */
  catalogRepoints: { table: Table; column: string; id: string; tenant: string; from: string; to: string }[];
  summary: Record<string, { assigned: number; shared: number; copies: number; quarantined: number; alreadyOwned: number }>;
}

const normName = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

interface Usage {
  tenants: Map<string, string>; // tenant -> earliest use
  nullRefs: number;
}
const noteUse = (m: Map<string, Usage>, id: string | null | undefined, tenant: string | null | undefined, at: string | null | undefined) => {
  if (!id) return;
  let u = m.get(id);
  if (!u) m.set(id, (u = { tenants: new Map(), nullRefs: 0 }));
  if (!tenant) {
    u.nullRefs++;
    return;
  }
  const prev = u.tenants.get(tenant);
  const t = at ?? "9999";
  if (prev == null || t < prev) u.tenants.set(tenant, t);
};

function decide(table: Table, row: { id: string; name: string; tenant_id: string | null }, u: Usage | undefined, summary: Plan["summary"]): Decision | null {
  const s = (summary[table] ??= { assigned: 0, shared: 0, copies: 0, quarantined: 0, alreadyOwned: 0 });
  if (row.tenant_id) {
    s.alreadyOwned++;
    return null;
  }
  if (!u || (!u.tenants.size && !u.nullRefs)) {
    s.quarantined++;
    return { table, id: row.id, name: row.name, owner: null, copies: [], reason: "not used by any tenant" };
  }
  if (u.nullRefs) {
    s.quarantined++;
    return { table, id: row.id, name: row.name, owner: null, copies: [], reason: `referenced by ${u.nullRefs} row(s) without a tenant` };
  }
  // Earliest user keeps the original id (ties: tenant id order, deterministic).
  const ordered = [...u.tenants.entries()].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1].localeCompare(b[1]))).map(([t]) => t);
  if (ordered.length === 1) {
    s.assigned++;
    return { table, id: row.id, name: row.name, owner: ordered[0], copies: [], reason: "used by one tenant" };
  }
  s.shared++;
  s.copies += ordered.length - 1;
  return { table, id: row.id, name: row.name, owner: ordered[0], copies: ordered.slice(1), reason: `used by ${ordered.length} tenants` };
}

/** Works out ownership without changing anything (dry run). */
export async function planCatalogOwnership(db: OwnDb): Promise<Plan> {
  const summary: Plan["summary"] = {};
  const decisions: Decision[] = [];
  const repoints: Plan["repoints"] = [];
  const catalogRepoints: Plan["catalogRepoints"] = [];

  // ── Products: evidence from tenant-scoped lines ──
  const productUse = new Map<string, Usage>();
  for (const t of PRODUCT_REFS) {
    for (const r of await db.select<{ product_id: string; tenant_id: string | null; created_at: string | null }>(`SELECT product_id, tenant_id, created_at FROM ${t}`)) noteUse(productUse, r.product_id, r.tenant_id, r.created_at);
  }
  const products = await db.select<{ id: string; name: string; tenant_id: string | null; category_id: string | null; sub_category_id: string | null; base_unit_id: string | null; secondary_unit_id: string | null; description: string | null; created_at: string }>(
    `SELECT id, name, tenant_id, category_id, sub_category_id, base_unit_id, secondary_unit_id, description, created_at FROM products`
  );
  const productTenants = new Map<string, string[]>(); // product -> tenants that will hold a version of it
  for (const p of products) {
    const d = decide("products", p, productUse.get(p.id), summary);
    if (d) decisions.push(d);
    const holders = d ? (d.owner ? [d.owner, ...d.copies] : []) : [p.tenant_id!];
    productTenants.set(p.id, holders);
    if (d?.copies.length) {
      for (const tenant of d.copies) {
        for (const t of PRODUCT_REFS) {
          for (const r of await db.select<{ id: string }>(`SELECT id FROM ${t} WHERE product_id = ? AND tenant_id = ?`, [p.id, tenant])) repoints.push({ table: t, column: "product_id", id: r.id, tenant, from: p.id, to: cloneId(p.id, tenant) });
        }
      }
    }
  }

  // ── Sub categories / categories / units follow the products of each tenant ──
  const subUse = new Map<string, Usage>();
  const catUse = new Map<string, Usage>();
  const uomUse = new Map<string, Usage>();
  for (const p of products) {
    for (const tenant of productTenants.get(p.id) ?? []) {
      noteUse(subUse, p.sub_category_id, tenant, p.created_at);
      noteUse(catUse, p.category_id, tenant, p.created_at);
      noteUse(uomUse, p.base_unit_id, tenant, p.created_at);
      noteUse(uomUse, p.secondary_unit_id, tenant, p.created_at);
    }
  }
  for (const t of UOM_REFS) {
    for (const r of await db.select<{ uom_id: string | null; tenant_id: string | null; created_at: string | null }>(`SELECT uom_id, tenant_id, created_at FROM ${t} WHERE uom_id IS NOT NULL`)) noteUse(uomUse, r.uom_id, r.tenant_id, r.created_at);
  }
  const subs = await db.select<{ id: string; name: string; tenant_id: string | null; category_id: string | null; default_secondary_unit_id: string | null; created_at: string }>(
    `SELECT id, name, tenant_id, category_id, default_secondary_unit_id, created_at FROM sub_categories`
  );
  const subTenants = new Map<string, string[]>();
  for (const s of subs) {
    const d = decide("sub_categories", s, subUse.get(s.id), summary);
    if (d) decisions.push(d);
    const holders = d ? (d.owner ? [d.owner, ...d.copies] : []) : [s.tenant_id!];
    subTenants.set(s.id, holders);
    for (const tenant of holders) {
      noteUse(catUse, s.category_id, tenant, s.created_at);
      noteUse(uomUse, s.default_secondary_unit_id, tenant, s.created_at);
    }
  }
  const cats = await db.select<{ id: string; name: string; tenant_id: string | null }>(`SELECT id, name, tenant_id FROM categories`);
  const owners = new Map<string, string | null>(); // `${table}:${id}` -> owner tenant
  for (const c of cats) {
    const d = decide("categories", c, catUse.get(c.id), summary);
    if (d) decisions.push(d);
    owners.set(`categories:${c.id}`, d ? d.owner : c.tenant_id);
  }
  const uoms = await db.select<{ id: string; name: string; tenant_id: string | null }>(`SELECT id, name, tenant_id FROM uoms`);
  for (const u of uoms) {
    const d = decide("uoms", u, uomUse.get(u.id), summary);
    if (d) decisions.push(d);
    owners.set(`uoms:${u.id}`, d ? d.owner : u.tenant_id);
  }
  for (const s of subs) owners.set(`sub_categories:${s.id}`, decisions.find((d) => d.table === "sub_categories" && d.id === s.id)?.owner ?? s.tenant_id);
  for (const p of products) owners.set(`products:${p.id}`, decisions.find((d) => d.table === "products" && d.id === p.id)?.owner ?? p.tenant_id);

  /** The id tenant `t` must use for catalog row `id` of `table`. */
  const resolve = (table: Table, id: string | null, t: string): string | null => (!id ? id : owners.get(`${table}:${id}`) === t ? id : owners.has(`${table}:${id}`) ? cloneId(id, t) : id);

  // Catalog rows (originals kept by their owner) whose references belong to another owner's row.
  for (const p of products) {
    const owner = owners.get(`products:${p.id}`);
    if (!owner) continue;
    for (const [col, table] of [["category_id", "categories"], ["sub_category_id", "sub_categories"], ["base_unit_id", "uoms"], ["secondary_unit_id", "uoms"]] as const) {
      const from = (p as Record<string, string | null>)[col];
      const to = resolve(table, from, owner);
      if (from && to !== from) catalogRepoints.push({ table: "products", column: col, id: p.id, tenant: owner, from, to: to! });
    }
  }
  for (const s of subs) {
    const owner = owners.get(`sub_categories:${s.id}`);
    if (!owner) continue;
    for (const [col, table] of [["category_id", "categories"], ["default_secondary_unit_id", "uoms"]] as const) {
      const from = (s as Record<string, string | null>)[col];
      const to = resolve(table, from, owner);
      if (from && to !== from) catalogRepoints.push({ table: "sub_categories", column: col, id: s.id, tenant: owner, from, to: to! });
    }
  }
  // Unit ids on lines.
  for (const t of UOM_REFS) {
    for (const r of await db.select<{ id: string; uom_id: string; tenant_id: string | null }>(`SELECT id, uom_id, tenant_id FROM ${t} WHERE uom_id IS NOT NULL AND tenant_id IS NOT NULL`)) {
      const to = resolve("uoms", r.uom_id, r.tenant_id!);
      if (to !== r.uom_id) repoints.push({ table: t, column: "uom_id", id: r.id, tenant: r.tenant_id!, from: r.uom_id, to: to! });
    }
  }

  // ── Generic names: owned by the tenants whose products use them as description ──
  const genUse = new Map<string, Usage>();
  const byName = new Map<string, string[]>();
  for (const p of products) {
    const k = normName(p.description);
    if (!k) continue;
    for (const tenant of productTenants.get(p.id) ?? []) {
      const list = byName.get(k) ?? [];
      list.push(tenant);
      byName.set(k, list);
    }
  }
  const gens = await db.select<{ id: string; name: string; tenant_id: string | null; created_at: string }>(`SELECT id, name, tenant_id, created_at FROM generic_names`);
  for (const g of gens) {
    for (const tenant of byName.get(normName(g.name)) ?? []) noteUse(genUse, g.id, tenant, g.created_at);
    const d = decide("generic_names", g, genUse.get(g.id), summary);
    if (d) decisions.push(d);
  }

  return { decisions, repoints, catalogRepoints, summary };
}

const COPY_FK: Partial<Record<Table, [string, Table][]>> = {
  products: [["category_id", "categories"], ["sub_category_id", "sub_categories"], ["base_unit_id", "uoms"], ["secondary_unit_id", "uoms"]],
  sub_categories: [["category_id", "categories"], ["default_secondary_unit_id", "uoms"]],
};
const ORDER: Table[] = ["uoms", "categories", "sub_categories", "products", "generic_names"];

/** Applies a plan. Returns counts; every change is logged under `runId`. */
export async function applyCatalogOwnership(db: OwnDb, plan: Plan, opts: { runId: string; now: string; newId: () => string }) {
  const { runId, now, newId } = opts;
  const log = (table: string, rowId: string, action: string, f: { tenant?: string | null; source?: string | null; column?: string | null; old?: string | null; next?: string | null; reason?: string | null }) =>
    db.execute(
      `INSERT INTO catalog_ownership_log (id, run_id, table_name, row_id, action, tenant_id, source_id, column_name, old_value, new_value, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), runId, table, rowId, action, f.tenant ?? null, f.source ?? null, f.column ?? null, f.old ?? null, f.next ?? null, f.reason ?? null, now]
    );
  const owner = new Map(plan.decisions.map((d) => [`${d.table}:${d.id}`, d.owner]));
  const ownerOf = async (table: Table, id: string) => {
    const k = `${table}:${id}`;
    if (owner.has(k)) return owner.get(k) ?? null;
    const r = await db.select<{ tenant_id: string | null }>(`SELECT tenant_id FROM ${table} WHERE id = ?`, [id]);
    return r[0]?.tenant_id ?? null;
  };
  const counts = { assigned: 0, copied: 0, repointed: 0, quarantined: 0 };

  for (const table of ORDER) {
    for (const d of plan.decisions.filter((x) => x.table === table)) {
      if (!d.owner) {
        await log(table, d.id, "quarantine", { reason: d.reason });
        counts.quarantined++;
        continue;
      }
      const r = (await db.execute(`UPDATE ${table} SET tenant_id = ?, updated_at = ? WHERE id = ? AND tenant_id IS NULL`, [d.owner, now, d.id])) as { changes?: number; rowsAffected?: number };
      if ((r?.changes ?? r?.rowsAffected ?? 1) > 0) {
        await log(table, d.id, "assign", { tenant: d.owner, reason: d.reason });
        counts.assigned++;
      }
      if (!d.copies.length) continue;
      const src = (await db.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [d.id]))[0];
      for (const tenant of d.copies) {
        const id = cloneId(d.id, tenant);
        if ((await db.select(`SELECT id FROM ${table} WHERE id = ?`, [id])).length) continue;
        const row: Record<string, unknown> = { ...src, id, tenant_id: tenant, updated_at: now };
        for (const [col, ref] of COPY_FK[table] ?? []) {
          const v = row[col] as string | null;
          if (v && (await ownerOf(ref, v)) !== tenant) row[col] = cloneId(v, tenant);
        }
        const keys = Object.keys(row);
        await db.execute(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => row[k]));
        await log(table, id, "copy", { tenant, source: d.id, reason: d.reason });
        counts.copied++;
      }
    }
  }
  for (const r of [...plan.catalogRepoints, ...plan.repoints]) {
    await db.execute(`UPDATE ${r.table} SET ${r.column} = ?, updated_at = ? WHERE id = ? AND ${r.column} = ?`, [r.to, now, r.id, r.from]);
    await log(r.table, r.id, "repoint", { tenant: r.tenant, column: r.column, old: r.from, next: r.to });
    counts.repointed++;
  }
  return counts;
}

/** Undoes one run: restores re-pointed values, removes copies, and clears
 * the tenant of rows the run assigned. */
export async function rollbackCatalogOwnership(db: OwnDb, runId: string, now: string) {
  const rows = await db.select<{ table_name: string; row_id: string; action: string; column_name: string | null; old_value: string | null; new_value: string | null }>(
    `SELECT table_name, row_id, action, column_name, old_value, new_value FROM catalog_ownership_log WHERE run_id = ? ORDER BY created_at DESC, rowid DESC`,
    [runId]
  );
  for (const r of rows.filter((x) => x.action === "repoint")) await db.execute(`UPDATE ${r.table_name} SET ${r.column_name} = ?, updated_at = ? WHERE id = ? AND ${r.column_name} = ?`, [r.old_value, now, r.row_id, r.new_value]);
  for (const r of rows.filter((x) => x.action === "copy")) await db.execute(`DELETE FROM ${r.table_name} WHERE id = ?`, [r.row_id]);
  for (const r of rows.filter((x) => x.action === "assign")) await db.execute(`UPDATE ${r.table_name} SET tenant_id = NULL, updated_at = ? WHERE id = ?`, [now, r.row_id]);
  await db.execute(`DELETE FROM catalog_ownership_log WHERE run_id = ?`, [runId]);
  return rows.length;
}
