/** The services a PRA-integrated contractor bills (Products > Services): each
 * with its price, unit, PCT code and sales tax. Kept as `products` rows (see
 * lib/pra/services.ts), with the price in the price list like any item. */
import { dbSelect } from "../db";
import { getLatestPrice, priceListRepo, productsRepo } from "./products";
import { uomsRepo } from "./uoms";
import { requireCurrentTenantId } from "./base";
import { PRA_SERVICE, formatPctCode } from "../pra/services";

export interface PraServiceRow {
  id: string;
  code: string | null;
  name: string;
  unit: string | null;
  price: number;
  pct_code: string | null;
  tax_pct: number;
}

export interface PraServiceInput {
  id?: string | null;
  code: string;
  name: string;
  unit: string;
  price: number;
  pctCode: string;
  taxPct: number;
}

export async function listPraServices(): Promise<PraServiceRow[]> {
  const t = requireCurrentTenantId();
  return dbSelect<PraServiceRow>(
    `SELECT p.id, p.barcode AS code, p.name, u.name AS unit, p.pct_code, COALESCE(p.gst_rate_pct, 0) AS tax_pct,
            COALESCE((SELECT pl.sale_price FROM price_list pl WHERE pl.product_id = p.id AND pl.tenant_id = p.tenant_id AND pl.deleted_at IS NULL ORDER BY pl.created_at DESC LIMIT 1), 0) AS price
     FROM products p LEFT JOIN uoms u ON u.id = p.base_unit_id
     WHERE p.tenant_id = ? AND p.deleted_at IS NULL AND p.product_classification = ?
     ORDER BY p.name ASC`,
    [t, PRA_SERVICE]
  );
}

/** What is wrong with this service, or null. */
export function praServiceProblem(s: PraServiceInput, others: PraServiceRow[]): string | null {
  const name = s.name.trim();
  if (!name) return "Enter the service name.";
  if (others.some((o) => o.id !== s.id && o.name.trim().toLowerCase() === name.toLowerCase())) return `A service named "${name}" already exists.`;
  if (!s.unit.trim()) return "Enter the unit (job, hour, day, sq ft...).";
  if (!Number.isFinite(s.price) || s.price < 0) return "Enter the service price.";
  if (!formatPctCode(s.pctCode)) return "Enter the 8-digit PCT code from PRA's schedule, like 9824.0000.";
  if (!Number.isFinite(s.taxPct) || s.taxPct < 0 || s.taxPct > 100) return "Enter the sales tax % of this service.";
  return null;
}

/** The business's unit of this name, added when it has none yet. */
async function unitId(name: string): Promise<string> {
  const wanted = name.trim();
  const found = (await uomsRepo.list()).find((u) => u.name.trim().toLowerCase() === wanted.toLowerCase());
  return found ? found.id : (await uomsRepo.create({ name: wanted, description: null })).id;
}

export async function savePraService(s: PraServiceInput): Promise<void> {
  const fields = {
    barcode: s.code.trim() || null,
    name: s.name.trim(),
    base_unit_id: await unitId(s.unit),
    packing: 1,
    gst_rate_pct: s.taxPct,
    tax_rate_pct: s.taxPct,
    pct_code: formatPctCode(s.pctCode),
    product_classification: PRA_SERVICE,
    catalog_group: null,
  };
  const id = s.id ? (await productsRepo.update(s.id, fields))?.id : (await productsRepo.create(fields)).id;
  if (!id) throw new Error("Service not found.");
  const current = s.id ? await getLatestPrice(id) : null;
  if (!current || Math.abs(current.salePrice - s.price) > 0.0001) {
    await priceListRepo.create({ product_id: id, batch_no: null, sale_price: s.price, wholesale_price: 0, mrp: 0, comment: null });
  }
}

export function deletePraService(id: string): Promise<void> {
  return productsRepo.remove(id, "Service deleted", "Services");
}
