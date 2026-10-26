import type { Product } from "./types";

/** Whether a product actually has a distinct secondary unit worth offering
 * a Pack/sub-unit toggle for \u2014 no secondary unit (or same as base) means
 * there's nothing to convert to, so callers should just show a plain
 * qty/price field the way every screen already did before this feature. */
export function hasSecondaryUnit(product: Pick<Product, "secondary_unit_id" | "base_unit_id">): boolean {
  return Boolean(product.secondary_unit_id) && product.secondary_unit_id !== product.base_unit_id;
}

/** Effective packing (sub-units per base unit) \u2014 guards against a stray 0
 * that would otherwise divide-by-zero when converting to the secondary
 * unit. */
export function effectivePacking(packing: number): number {
  return packing > 0 ? packing : 1;
}

/** Quantity conversion when the unit toggle flips: going TO the secondary
 * unit multiplies by packing (1 pack -> 10 Tab), going back to base divides
 * by it \u2014 preserves the physical amount the qty describes. */
export function convertQtyOnUnitToggle(qty: number, togglingToSecondary: boolean, packing: number): number {
  const p = effectivePacking(packing);
  return togglingToSecondary ? qty * p : qty / p;
}

/** Price conversion is the inverse of quantity's, so qty * price (the line
 * total) stays the same across the toggle \u2014 a Rs.100 pack of 10 becomes
 * Rs.10 per Tab automatically ("MRP auto divides by sub-unit count"). */
export function convertPriceOnUnitToggle(price: number, togglingToSecondary: boolean, packing: number): number {
  const p = effectivePacking(packing);
  return togglingToSecondary ? price / p : price * p;
}

/** Normalizes a qty entered in whichever unit was selected back to base
 * units (packs) \u2014 what product_batches.qty / stock deduction and receipt
 * always operate in, regardless of which unit the cashier transacted in. */
export function toBaseUnitQty(qty: number, isSecondaryUnit: boolean, packing: number): number {
  return isSecondaryUnit ? qty / effectivePacking(packing) : qty;
}

/** Inverse of toBaseUnitQty \u2014 how much of a base-unit stock figure (avail
 * qty, max stock, ...) reads as when displayed in the secondary unit. */
export function fromBaseUnitQty(qty: number, isSecondaryUnit: boolean, packing: number): number {
  return isSecondaryUnit ? qty * effectivePacking(packing) : qty;
}

/** A quantity in a report: whole base units as they are ("2 Pack"); a part of
 * a base unit in the secondary unit instead ("0.1" Pack of 20 -> "2 Tab").
 * Without a secondary unit, the decimals are rounded. */
export function formatReportQty(qty: number, packing?: number | null, baseUnit?: string | null, secondaryUnit?: string | null): string {
  const q = Number(qty) || 0;
  const whole = Math.abs(q - Math.round(q)) < 1e-6;
  const p = Number(packing) || 1;
  if (!whole && p > 1 && secondaryUnit) {
    const s = Math.round(q * p * 100) / 100;
    return `${Number.isInteger(s) ? s : s.toFixed(2)} ${secondaryUnit}`;
  }
  const n = whole ? String(Math.round(q)) : (Math.round(q * 100) / 100).toString();
  return baseUnit ? `${n} ${baseUnit}` : n;
}
