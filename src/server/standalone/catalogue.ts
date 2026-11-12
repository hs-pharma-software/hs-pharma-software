/** The approved pharmacy catalogue for Mavin Pharmacy Offline (download only).
 *
 * Only MAVIN's shared catalogue rows: tenant_id NULL, pharma (or ungrouped)
 * products, categories, sub-categories and units. Never a business's own
 * rows, prices, stock or anything else. Incremental by last change:
 *   GET /api/catalogue/pharma/?since=<updated_at>&version=<version the desktop has>
 * - version unchanged: { unchanged: true } and nothing else (no download);
 * - otherwise rows changed after `since` (deleted ones with deleted_at set,
 *   so the desktop can retire them), at most PAGE rows per answer, oldest
 *   first, with the cursor to ask for the next page. */
import type { Sql } from "@/server/subSupers";

export const PAGE = 2000;
const TABLES = ["uoms", "categories", "sub_categories", "products"] as const;
type T = (typeof TABLES)[number];

const groupFilter = (t: T) => (t === "uoms" ? "" : "AND (catalog_group IS NULL OR catalog_group = 'pharma')");

/** Same version string as scripts/standalone/export-catalogue.cjs: latest change | live row count. */
export async function catalogueVersion(sql: Sql): Promise<string> {
  let max = "";
  let count = 0;
  for (const t of TABLES) {
    const r = (await sql.execute(`SELECT MAX(updated_at) AS m, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS n FROM ${t} WHERE tenant_id IS NULL ${groupFilter(t)}`)).rows[0];
    if (String(r?.m ?? "") > max) max = String(r?.m ?? "");
    count += Number(r?.n ?? 0);
  }
  return `${max}|${count}`;
}

export async function cataloguePage(sql: Sql, input: { since?: string | null; version?: string | null }) {
  const version = await catalogueVersion(sql);
  if (input.version && input.version === version) return { version, unchanged: true, rows: {}, cursor: input.since ?? null, more: false };
  const since = typeof input.since === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(input.since) ? input.since : "";
  // Changes at or after `since` from every table, oldest first across tables, one page.
  // Rows on the cursor's own timestamp are sent again next time (applied idempotently),
  // so a page cut in the middle of one timestamp loses nothing.
  const all: { t: T; row: Record<string, unknown> }[] = [];
  for (const t of TABLES) {
    const rs = await sql.execute(
      `SELECT * FROM ${t} WHERE tenant_id IS NULL ${groupFilter(t)} AND updated_at >= ? ORDER BY updated_at, id LIMIT ?`,
      [since, PAGE + 1],
    );
    for (const r of rs.rows) all.push({ t, row: { ...r } as Record<string, unknown> });
  }
  all.sort((a, b) => String(a.row.updated_at ?? "").localeCompare(String(b.row.updated_at ?? "")) || TABLES.indexOf(a.t) - TABLES.indexOf(b.t));
  const more = all.length > PAGE;
  const page = all.slice(0, PAGE);
  const rows: Partial<Record<T, Record<string, unknown>[]>> = {};
  for (const { t, row } of page) (rows[t] ??= []).push(row);
  const cursor = page.length ? String(page[page.length - 1].row.updated_at) : since || null;
  return { version, unchanged: false, rows, cursor, more };
}
