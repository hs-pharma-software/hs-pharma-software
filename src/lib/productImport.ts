import { productsRepo, productBatchesRepo, priceListRepo } from "./repo/products";
import { categoriesRepo, subCategoriesRepo, listCategoriesWithShared, listSubCategoriesWithShared } from "./repo/categories";
import { uomsRepo, listUomsWithShared } from "./repo/uoms";

/** Columns the product import reads (Products > Sample File). */
export const PRODUCT_IMPORT_HEADERS = [
  "Name*", "Barcode", "Company", "Category", "Sub Category", "UOM*", "Purchase Price", "Sale Price",
  "Wholesale Price", "MRP", "HS Code", "Packing (units per box)", "Opening Qty",
];

export interface ImportRow {
  line: number;
  name: string;
  barcode: string;
  company: string;
  category: string;
  subCategory: string;
  uom: string;
  purchasePrice: number;
  salePrice: number;
  wholesalePrice: number;
  mrp: number;
  hsCode: string;
  packing: number;
  openingQty: number;
}

/** RFC 4180 CSV: quoted fields, "" inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const key = (s: string) => s.toLowerCase().replace(/\*|\(.*?\)/g, "").replace(/[^a-z]/g, "");
const num = (s: string | undefined) => Number(String(s ?? "").replace(/[^0-9.\-]/g, "")) || 0;
/** Same product name: letter case, spaces and punctuation ignored. */
export const sameName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Reads the CSV rows by their header names (any order, any letter case). */
export function readImportRows(table: string[][]): { rows: ImportRow[]; problems: string[] } {
  const [head, ...body] = table;
  if (!head) return { rows: [], problems: ["The file is empty."] };
  const col = new Map(head.map((h, i) => [key(h), i]));
  const get = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = col.get(key(n));
      if (i != null) return (r[i] ?? "").trim();
    }
    return "";
  };
  if (!col.has("name") && !col.has("productname")) return { rows: [], problems: ['No "Name" column. Use the Sample File headers.'] };
  const rows: ImportRow[] = [];
  const problems: string[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const name = get(r, "Name", "Product Name");
    if (!name || name.startsWith("(")) return;
    const uom = get(r, "UOM", "Unit");
    if (!uom) problems.push(`Line ${line} (${name}): no UOM; "Pcs" will be used.`);
    rows.push({
      line, name,
      barcode: get(r, "Barcode", "SKU"),
      company: get(r, "Company", "Brand"),
      category: get(r, "Category"),
      subCategory: get(r, "Sub Category"),
      uom: uom || "Pcs",
      purchasePrice: num(get(r, "Purchase Price", "PP", "Cost")),
      salePrice: num(get(r, "Sale Price", "SP", "Rate")),
      wholesalePrice: num(get(r, "Wholesale Price")),
      mrp: num(get(r, "MRP")),
      hsCode: get(r, "HS Code"),
      packing: num(get(r, "Packing", "Packing (units per box)")) || 1,
      openingQty: num(get(r, "Opening Qty", "Quantity", "Qty")),
    });
  });
  return { rows, problems };
}

export interface ImportPlan {
  add: ImportRow[];
  /** Already a product of this business (or twice in the file). */
  skip: { row: ImportRow; reason: string }[];
  newCategories: string[];
  newUoms: string[];
}

export async function planImport(rows: ImportRow[]): Promise<ImportPlan> {
  const [existing, cats, uoms] = await Promise.all([productsRepo.list(), listCategoriesWithShared(), listUomsWithShared()]);
  const have = new Set(existing.map((p) => sameName(p.name)));
  const catNames = new Set(cats.map((c) => c.name.trim().toLowerCase()));
  const uomNames = new Set(uoms.map((u) => u.name.trim().toLowerCase()));
  const plan: ImportPlan = { add: [], skip: [], newCategories: [], newUoms: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const k = sameName(r.name);
    if (have.has(k)) plan.skip.push({ row: r, reason: "already in your products" });
    else if (seen.has(k)) plan.skip.push({ row: r, reason: "twice in the file" });
    else {
      plan.add.push(r);
      seen.add(k);
      const c = r.category.trim().toLowerCase();
      if (c && !catNames.has(c) && !plan.newCategories.some((x) => x.toLowerCase() === c)) plan.newCategories.push(r.category.trim());
      const u = r.uom.trim().toLowerCase();
      if (!uomNames.has(u) && !plan.newUoms.some((x) => x.toLowerCase() === u)) plan.newUoms.push(r.uom.trim());
    }
  }
  return plan;
}

/** Adds the planned products to the logged-in business, creating missing
 * categories and units. Opening stock only when asked. */
export async function runImport(
  plan: ImportPlan,
  opts: { openingStock: boolean; onProgress?: (done: number, total: number) => void }
): Promise<{ created: number; failed: { name: string; error: string }[] }> {
  const cats = new Map((await listCategoriesWithShared()).map((c) => [c.name.trim().toLowerCase(), c.id]));
  const uoms = new Map((await listUomsWithShared()).map((u) => [u.name.trim().toLowerCase(), u.id]));
  const subs = new Map<string, string>();
  const categoryId = async (name: string) => {
    const k = name.trim().toLowerCase();
    if (!k) return null;
    if (!cats.has(k)) cats.set(k, (await categoriesRepo.create({ name: name.trim(), description: null, flat_discount_pct: 0, image_url: null })).id);
    return cats.get(k)!;
  };
  const subCategoryId = async (catId: string | null, name: string) => {
    if (!catId || !name.trim()) return null;
    const k = `${catId}|${name.trim().toLowerCase()}`;
    if (!subs.has(k)) {
      const found = (await listSubCategoriesWithShared(catId)).find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
      subs.set(k, found?.id ?? (await subCategoriesRepo.create({ category_id: catId, name: name.trim(), description: null, image_url: null })).id);
    }
    return subs.get(k)!;
  };
  const uomId = async (name: string) => {
    const k = name.trim().toLowerCase();
    if (!uoms.has(k)) uoms.set(k, (await uomsRepo.create({ name: name.trim(), description: null })).id);
    return uoms.get(k)!;
  };

  let created = 0;
  const failed: { name: string; error: string }[] = [];
  for (const [i, r] of plan.add.entries()) {
    try {
      const catId = await categoryId(r.category);
      const product = await productsRepo.create({
        barcode: r.barcode || null,
        name: r.name,
        company_name: r.company || null,
        description: null,
        category_id: catId,
        sub_category_id: await subCategoryId(catId, r.subCategory),
        base_unit_id: await uomId(r.uom),
        secondary_unit_id: null,
        packing: r.packing,
        gst_rate_pct: 0,
        max_stock_qty: null,
        stock_expiry_limit_days: null,
        location: null,
        hs_code: r.hsCode || null,
        fbr_sale_rate: 0,
        fbr_qty_factor: 1,
        is_narcotic: 0,
        catalog_group: null,
        product_classification: null,
      } as never);
      const qty = opts.openingStock ? r.openingQty : 0;
      // The purchase price lives on a stock row: keep it even with no stock.
      if (qty > 0 || r.purchasePrice > 0) {
        await productBatchesRepo.create({ product_id: product.id, batch_no: null, expiry_date: null, qty: Math.max(0, qty), location: null, purchase_price: r.purchasePrice });
      }
      if (r.salePrice > 0 || r.mrp > 0) {
        await priceListRepo.create({ product_id: product.id, batch_no: null, sale_price: r.salePrice, wholesale_price: r.wholesalePrice, mrp: r.mrp, comment: "Imported" });
      }
      created++;
    } catch (e) {
      failed.push({ name: r.name, error: e instanceof Error ? e.message : String(e) });
    }
    opts.onProgress?.(i + 1, plan.add.length);
  }
  return { created, failed };
}
