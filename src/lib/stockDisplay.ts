export interface StockDisplayRow {
  id: string;
  product_id: string;
  barcode: string | null;
  product_name: string;
  company_name: string | null;
  supplier_name?: string | null;
  location: string | null;
  category_name: string | null;
  uom_name: string | null;
  secondary_unit_id: string | null;
  secondary_unit_name: string | null;
  packing: number;
  avail_qty: number;
  batch_no: string | null;
  expiry_date: string | null;
  mrp: number;
  sale_price: number;
  purchase_price: number;
}

export type StockDisplayEntry<T> = T & { isSummary: boolean; entryCount: number };

/** Group duplicate Contractor receipts for display without changing stored batches. */
export function groupUnbatchedStockRows<T extends StockDisplayRow>(rows: T[]): StockDisplayEntry<T>[] {
  const output: StockDisplayEntry<T>[] = [];
  const positions = new Map<string, number>();

  for (const row of rows) {
    const batch = row.batch_no?.trim() || null;
    const expiry = row.expiry_date?.trim() || null;
    const location = row.location?.trim() || null;
    if (batch || expiry || location) {
      output.push({ ...row, isSummary: false, entryCount: 1 });
      continue;
    }

    const key = JSON.stringify([
      row.product_id, row.barcode, row.product_name, row.company_name, row.supplier_name ?? null,
      row.uom_name, row.secondary_unit_id, row.secondary_unit_name, row.packing,
      row.sale_price, row.mrp, row.purchase_price,
    ]);
    const index = positions.get(key);
    if (index === undefined) {
      positions.set(key, output.length);
      output.push({ ...row, isSummary: false, entryCount: 1 });
      continue;
    }

    const current = output[index];
    output[index] = {
      ...current,
      avail_qty: current.avail_qty + row.avail_qty,
      isSummary: true,
      entryCount: current.entryCount + 1,
    };
  }

  return output;
}
