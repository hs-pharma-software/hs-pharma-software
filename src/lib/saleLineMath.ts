/** One sale line's money (invoices and quotations): the line discount comes
 * off the price first, then the customer's extra discount comes off what is
 * left (100 - 15% = 85, then 10% extra on 85 = 76.50), then tax on that.
 * `discountRs` is both discounts together (what invoices store and FBR gets). */
export interface SaleLineMath {
  gross: number;
  /** The line discount (Disc %). */
  discount: number;
  /** The extra discount, on the already discounted amount. */
  extra: number;
  discountRs: number;
  taxable: number;
  tax: number;
  total: number;
}

const pct = (v: unknown) => Math.min(100, Math.max(0, Number(v) || 0));

export function saleLineMath(price: number, qty: number, discountPct: number, extraPct: number, taxPct: number): SaleLineMath {
  const gross = (Number(price) || 0) * (Number(qty) || 0);
  const discount = gross * (pct(discountPct) / 100);
  const extra = (gross - discount) * (pct(extraPct) / 100);
  const taxable = gross - discount - extra;
  const tax = taxable * ((Number(taxPct) || 0) / 100);
  return { gross, discount, extra, discountRs: discount + extra, taxable, tax, total: taxable + tax };
}
