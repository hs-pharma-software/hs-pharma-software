/** Selling a quantity from several batches: the earliest-expiring batch
 * first (FEFO), then the next, so one invoice line can use more than one
 * batch. Quantities are in base units. */

export interface BatchStock {
  id: string;
  batch_no: string | null;
  expiry_date: string | null;
  qty: number;
  purchase_price: number;
}

export interface BatchPart {
  batch: BatchStock;
  /** Paid quantity taken from this batch. */
  qty: number;
  /** Bonus (free) quantity taken from this batch. */
  bonus: number;
}

const EPS = 1e-9;

/** Splits qty + bonus over the batches in order (paid quantity first, then
 * bonus). `used` holds what earlier lines already took from each batch and is
 * updated. `short` is what could not be covered by stock. */
export function allocateBatches(
  batches: BatchStock[],
  qty: number,
  bonus: number,
  used: Map<string, number> = new Map()
): { parts: BatchPart[]; short: number } {
  let paidLeft = Math.max(0, qty);
  let bonusLeft = Math.max(0, bonus);
  const parts: BatchPart[] = [];
  for (const b of batches) {
    if (paidLeft + bonusLeft <= EPS) break;
    const free = b.qty - (used.get(b.id) ?? 0);
    if (free <= EPS) continue;
    const take = Math.min(free, paidLeft + bonusLeft);
    const q = Math.min(take, paidLeft);
    const bn = take - q;
    paidLeft -= q;
    bonusLeft -= bn;
    used.set(b.id, (used.get(b.id) ?? 0) + take);
    parts.push({ batch: b, qty: round(q), bonus: round(bn) });
  }
  return { parts, short: round(paidLeft + bonusLeft) };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Total stock of a product over its batches. */
export const totalStock = (batches: BatchStock[]) => round(batches.reduce((s, b) => s + Math.max(0, b.qty), 0));

/** "A1, B2" for the batches a quantity would use (or the first batch when nothing is entered yet). */
export function batchLabel(batches: BatchStock[], qty: number, bonus: number): string {
  if (!batches.length) return "—";
  const { parts } = allocateBatches(batches, qty, bonus);
  const used = parts.length ? parts.map((p) => p.batch) : [batches[0]];
  return used.map((b) => b.batch_no ?? "—").join(", ");
}
