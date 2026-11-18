export interface InvoicePrintSourceLine {
  id: string;
  productId: string;
  name: string;
  hsCode: string | null;
  batch: string | null;
  qty: number;
  bonusQty: number;
  packing: number;
  secondaryUnitId: string | null;
  secondaryUnitName: string | null;
  salePrice: number;
  discountPct: number;
  extraDiscountPct?: number | null;
  taxPct: number;
  taxRs: number;
  total: number;
}

export interface InvoicePrintLine {
  id: string;
  name: string;
  hsCode: string | null;
  batch: string | null;
  qty: string;
  bonus: string | null;
  price: number;
  discountPct: number;
  taxPct: number;
  taxRs: number;
  total: number;
}

const fmtQty = (qty: number) => qty % 1 === 0 ? String(qty) : qty.toFixed(2);

/** Batch-split rows can be combined only when every customer-visible rate matches. */
export function invoicePrintItems(rows: InvoicePrintSourceLine[], mergeEquivalent: boolean): InvoicePrintLine[] {
  const grouped: { line: InvoicePrintLine; qty: number; bonusQty: number; unit: string }[] = [];
  const indexes = new Map<string, number>();

  for (const row of rows) {
    const packing = row.packing || 1;
    const hasSecondary = !!row.secondaryUnitId && packing > 1;
    const fractional = hasSecondary && Math.abs(row.qty - Math.round(row.qty)) > 0.001;
    const unit = fractional && row.secondaryUnitName ? ` ${row.secondaryUnitName}` : "";
    const qty = fractional ? row.qty * packing : row.qty;
    const bonusQty = fractional ? row.bonusQty * packing : row.bonusQty;
    const price = fractional ? row.salePrice / packing : row.salePrice;
    const key = JSON.stringify([
      row.productId, row.name, row.hsCode, row.batch, unit, price, row.discountPct,
      row.extraDiscountPct ?? 0, row.taxPct,
    ]);
    const index = mergeEquivalent ? indexes.get(key) : undefined;

    if (index !== undefined) {
      const current = grouped[index];
      current.qty += qty;
      current.bonusQty += bonusQty;
      current.line.qty = `${fmtQty(current.qty)}${unit}`;
      current.line.bonus = current.bonusQty > 0 ? `${fmtQty(current.bonusQty)}${unit}` : null;
      current.line.taxRs += row.taxRs || 0;
      current.line.total += row.total;
      continue;
    }

    const line: InvoicePrintLine = {
      id: row.id,
      name: row.name,
      hsCode: row.hsCode,
      batch: row.batch,
      qty: `${fmtQty(qty)}${unit}`,
      bonus: bonusQty > 0 ? `${fmtQty(bonusQty)}${unit}` : null,
      price,
      discountPct: row.discountPct,
      taxPct: row.taxPct,
      taxRs: row.taxRs || 0,
      total: row.total,
    };
    if (mergeEquivalent) indexes.set(key, grouped.length);
    grouped.push({ line, qty, bonusQty, unit });
  }

  return grouped.map(({ line }) => line);
}