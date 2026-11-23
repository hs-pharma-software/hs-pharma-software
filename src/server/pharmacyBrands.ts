/** Hospital > Pharmacy Department > Selected Brands: what the hospital's
 * linked pharmacy actually stocks, by generic name, for the administrator to
 * choose each generic's brand. Only names, company, stock and sale price leave
 * the pharmacy (never its costs); only the pharmacy this business has linked. */
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";

type Row = Record<string, unknown>;

export interface PharmacyGeneric { generic: string; brands: number }
export interface PharmacyBrand { id: string; name: string; company: string | null; generic: string; stock: number; price: number | null }

async function linkedPharmacy(sql: Sql, caller: Caller): Promise<string> {
  if (!caller.tenantId) throw new HttpError(403, "Log in to a hospital.");
  const r = (await sql.execute(
    `SELECT pharmacy_tenant_id FROM clinic_pharmacy_link WHERE clinic_tenant_id = ? AND is_active = 1 LIMIT 1`, [caller.tenantId]
  )).rows[0] as Row | undefined;
  if (!r?.pharmacy_tenant_id) throw new HttpError(400, "Link the hospital pharmacy first: Pharmacy Department > Linked Pharmacy.");
  return String(r.pharmacy_tenant_id);
}

/** The pharmacy's products with stock (its own and the shared catalogue's). */
const STOCKED = `FROM products p
  JOIN (SELECT product_id, SUM(qty) AS stock FROM product_batches WHERE tenant_id = ? AND deleted_at IS NULL AND qty > 0 GROUP BY product_id) st ON st.product_id = p.id
  WHERE p.deleted_at IS NULL AND (p.tenant_id = ? OR p.tenant_id IS NULL) AND TRIM(COALESCE(p.description, '')) <> ''`;

export async function pharmacyCatalogue(sql: Sql, caller: Caller, input: Row): Promise<PharmacyGeneric[] | PharmacyBrand[] | PharmacyPreInvoice[]> {
  const P = await linkedPharmacy(sql, caller);
  const action = String(input.action ?? "");
  if (action === "generics") {
    const term = String(input.term ?? "").trim().slice(0, 60);
    const rows = (await sql.execute(
      `SELECT MIN(TRIM(p.description)) AS generic, COUNT(DISTINCT p.id) AS brands ${STOCKED} AND p.description LIKE ?
       GROUP BY UPPER(TRIM(p.description)) ORDER BY generic LIMIT 40`,
      [P, P, `%${term}%`]
    )).rows as Row[];
    return rows.map((r) => ({ generic: String(r.generic), brands: Number(r.brands) || 0 }));
  }
  if (action === "brands") {
    const generic = String(input.generic ?? "").trim();
    if (!generic) throw new HttpError(400, "Choose the generic name.");
    const rows = (await sql.execute(
      `SELECT p.id, p.name, NULLIF(TRIM(p.company_name), '') AS company, TRIM(p.description) AS generic, st.stock,
              (SELECT pl.sale_price FROM price_list pl WHERE pl.product_id = p.id AND pl.tenant_id = ? AND pl.deleted_at IS NULL ORDER BY pl.created_at DESC LIMIT 1) AS price
       ${STOCKED} AND UPPER(TRIM(p.description)) = UPPER(?)
       ORDER BY p.name COLLATE NOCASE LIMIT 100`,
      [P, P, P, generic]
    )).rows as Row[];
    return rows.map((r) => ({
      id: String(r.id), name: String(r.name), company: r.company == null ? null : String(r.company), generic: String(r.generic),
      stock: Number(r.stock) || 0, price: r.price == null ? null : Number(r.price),
    }));
  }
  if (action === "preInvoices") return pharmacyPreInvoices(sql, P);
  throw new HttpError(400, "Unknown request.");
}

export interface PharmacyPreInvoice { id: string; name: string; description: string | null; items: number; total: number }

/** The pharmacy's Pre Invoices (e.g. "Gynae case (C-Section)") with today's
 * total at its sale prices: a surgery's OT / IPD medicine cost. */
async function pharmacyPreInvoices(sql: Sql, P: string): Promise<PharmacyPreInvoice[]> {
  const rows = (await sql.execute(
    `SELECT id, name, description, lines FROM invoice_templates WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`, [P]
  ).catch(() => ({ rows: [] as Row[] }))).rows as Row[];
  const parsed = rows.map((r) => {
    let lines: { productId: string; qty: number; unit: string }[] = [];
    try {
      const v = JSON.parse(String(r.lines ?? "[]"));
      if (Array.isArray(v)) lines = v.filter((l) => l && typeof l.productId === "string" && Number(l.qty) > 0).map((l) => ({ productId: l.productId, qty: Number(l.qty), unit: String(l.unit ?? "base") }));
    } catch { lines = []; }
    return { r, lines };
  });
  const ids = [...new Set(parsed.flatMap((p) => p.lines.map((l) => l.productId)))];
  const prices = new Map<string, { price: number; packing: number }>();
  if (ids.length) {
    const pr = (await sql.execute(
      `SELECT p.id, COALESCE(p.packing, 1) AS packing,
              (SELECT pl.sale_price FROM price_list pl WHERE pl.product_id = p.id AND pl.tenant_id = ? AND pl.deleted_at IS NULL ORDER BY pl.created_at DESC LIMIT 1) AS price
       FROM products p WHERE p.id IN (${ids.map(() => "?").join(", ")}) AND (p.tenant_id = ? OR p.tenant_id IS NULL)`,
      [P, ...ids, P]
    )).rows as Row[];
    for (const x of pr) prices.set(String(x.id), { price: Number(x.price) || 0, packing: Number(x.packing) || 1 });
  }
  return parsed.map(({ r, lines }) => ({
    id: String(r.id), name: String(r.name), description: r.description == null ? null : String(r.description), items: lines.length,
    total: Math.round(lines.reduce((a, l) => {
      const p = prices.get(l.productId);
      return a + (p ? l.qty * (l.unit === "secondary" ? p.price / p.packing : p.price) : 0);
    }, 0) * 100) / 100,
  }));
}
