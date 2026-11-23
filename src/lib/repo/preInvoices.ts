/** Invoices > Pre Invoices: saved invoice patterns a pharmacy bills again and
 * again (e.g. the medicines of a Gynae operation). Using one opens a new
 * invoice with its lines at the day's prices and batches; only the patient's
 * name is left to enter before saving and printing. Kept in invoice_templates
 * (v95), lines as JSON. */
import { dbSelect } from "../db";
import { createTenantRepo, requireCurrentTenantId } from "./base";
import { useAuthStore } from "../../store/authStore";

export interface PreInvoiceLine {
  productId: string;
  /** The product's name when saved (shown if the product is later removed). */
  name: string;
  qty: number;
  /** "secondary": qty in the product's smaller unit (tablets of a strip). */
  unit: "base" | "secondary";
}

interface PreInvoiceRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  lines: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PreInvoice {
  id: string;
  name: string;
  description: string | null;
  lines: PreInvoiceLine[];
  createdByName: string | null;
  updatedAt: string;
}

export const preInvoicesRepo = createTenantRepo<PreInvoiceRow>("invoice_templates");

/** The stored lines, keeping only well-formed ones. */
export function parsePreInvoiceLines(json: string | null | undefined): PreInvoiceLine[] {
  let raw: unknown;
  try { raw = JSON.parse(json || "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l) => {
    const x = l as Record<string, unknown>;
    const qty = Number(x.qty);
    if (typeof x.productId !== "string" || !x.productId || !(qty > 0)) return [];
    return [{ productId: x.productId, name: String(x.name ?? ""), qty, unit: x.unit === "secondary" ? "secondary" as const : "base" as const }];
  });
}

const toPreInvoice = (r: PreInvoiceRow): PreInvoice => ({
  id: r.id, name: r.name, description: r.description, lines: parsePreInvoiceLines(r.lines), createdByName: r.created_by_name, updatedAt: r.updated_at,
});

export async function listPreInvoices(): Promise<PreInvoice[]> {
  return (await preInvoicesRepo.list({ orderBy: "name COLLATE NOCASE ASC" })).map(toPreInvoice);
}

export async function getPreInvoice(id: string): Promise<PreInvoice | null> {
  const r = await preInvoicesRepo.get(id);
  return r && !r.deleted_at ? toPreInvoice(r) : null;
}

/** Creates (no id) or updates a pre invoice. Same product and unit twice is added up. */
export async function savePreInvoice(x: { id?: string | null; name: string; description?: string | null; lines: PreInvoiceLine[] }): Promise<PreInvoice> {
  const name = x.name.trim();
  if (!name) throw new Error("Enter the pre invoice's name (e.g. Gynae operation).");
  const merged: PreInvoiceLine[] = [];
  for (const l of x.lines) {
    if (!(Number(l.qty) > 0)) throw new Error(`Enter the quantity of ${l.name || "every product"}.`);
    const same = merged.find((m) => m.productId === l.productId && m.unit === l.unit);
    if (same) same.qty += Number(l.qty);
    else merged.push({ productId: l.productId, name: l.name, qty: Number(l.qty), unit: l.unit === "secondary" ? "secondary" : "base" });
  }
  if (!merged.length) throw new Error("Add at least one product.");
  const others = await preInvoicesRepo.list({ where: "LOWER(TRIM(name)) = LOWER(?)", params: [name] });
  if (others.some((o) => o.id !== x.id)) throw new Error(`A pre invoice named "${name}" already exists.`);
  const data = { name, description: x.description?.trim() || null, lines: JSON.stringify(merged) };
  if (x.id) {
    const saved = await preInvoicesRepo.update(x.id, data);
    if (!saved) throw new Error("Pre invoice not found.");
    return toPreInvoice(saved);
  }
  const who = useAuthStore.getState().currentUser;
  return toPreInvoice(await preInvoicesRepo.create({ ...data, created_by_name: who?.displayName || who?.username || null }));
}

export async function deletePreInvoice(id: string): Promise<void> {
  await preInvoicesRepo.remove(id);
}

/** Today's estimate of a pre invoice: each line at the latest sale price (a smaller unit at price ÷ packing), and the lines with no stock. */
export async function preInvoiceEstimate(p: PreInvoice): Promise<{ total: number; outOfStock: string[] }> {
  if (!p.lines.length) return { total: 0, outOfStock: [] };
  const T = requireCurrentTenantId();
  const ids = [...new Set(p.lines.map((l) => l.productId))];
  const marks = ids.map(() => "?").join(", ");
  const rows = await dbSelect<{ id: string; packing: number | null; price: number | null; stock: number | null }>(
    `SELECT p.id, p.packing,
            (SELECT pl.sale_price FROM price_list pl WHERE pl.product_id = p.id AND pl.tenant_id = ? AND pl.deleted_at IS NULL ORDER BY pl.created_at DESC LIMIT 1) AS price,
            (SELECT SUM(b.qty) FROM product_batches b WHERE b.product_id = p.id AND b.tenant_id = ? AND b.deleted_at IS NULL AND b.qty > 0) AS stock
     FROM products p WHERE p.id IN (${marks})`,
    [T, T, ...ids]
  );
  const by = new Map(rows.map((r) => [r.id, r]));
  let total = 0;
  const outOfStock: string[] = [];
  for (const l of p.lines) {
    const r = by.get(l.productId);
    const packing = Number(r?.packing) || 1;
    const price = Number(r?.price) || 0;
    total += l.qty * (l.unit === "secondary" ? price / packing : price);
    const need = l.unit === "secondary" ? l.qty / packing : l.qty;
    if (!r || (Number(r.stock) || 0) + 1e-9 < need) outOfStock.push(l.name);
  }
  return { total: Math.round(total * 100) / 100, outOfStock };
}
