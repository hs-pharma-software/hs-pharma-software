/** One purchase line's money: the supplier's rate is paid on the quantity
 * bought; bonus units come free, so the cost of one unit in stock is the
 * amount spread over quantity + bonus (85 for 1 + 1 bonus = 42.50 each).
 * An extra discount % comes off the supplier's amount first; sales tax and
 * withholding tax are then added on the discounted amount. */
export interface PurchaseLineMath {
  /** After the line discount. */
  amount: number;
  discount: number;
  st: number;
  wht: number;
  total: number;
  /** Cost of one unit received (bonus included), before taxes. */
  netRate: number;
}

export function purchaseLineMath(rate: number, qty: number, bonus: number, stPct: number, whtPct: number, discPct = 0): PurchaseLineMath {
  const q = Math.max(0, Number(qty) || 0);
  const b = Math.max(0, Number(bonus) || 0);
  const d = Math.min(100, Math.max(0, Number(discPct) || 0));
  const gross = (Number(rate) || 0) * q;
  const discount = gross * (d / 100);
  const amount = gross - discount;
  const st = amount * ((Number(stPct) || 0) / 100);
  const wht = amount * ((Number(whtPct) || 0) / 100);
  return { amount, discount, st, wht, total: amount + st + wht, netRate: q + b > 0 ? amount / (q + b) : (Number(rate) || 0) * (1 - d / 100) };
}

/** What one unit of a purchase line is worth when it goes back to the supplier: its rate after the line discount. */
export function purchaseReturnRate(item: { purchase_price: number; disc_pct?: number | null }): number {
  return (Number(item.purchase_price) || 0) * (1 - Math.min(100, Math.max(0, Number(item.disc_pct) || 0)) / 100);
}
