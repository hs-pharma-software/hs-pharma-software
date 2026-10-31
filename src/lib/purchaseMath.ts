/** One purchase line's money: the supplier's rate is paid on the quantity
 * bought; bonus units come free, so the cost of one unit in stock is the
 * amount spread over quantity + bonus (85 for 1 + 1 bonus = 42.50 each).
 * Sales tax and withholding tax are both added to what is payable. */
export interface PurchaseLineMath {
  amount: number;
  st: number;
  wht: number;
  total: number;
  /** Cost of one unit received (bonus included), before taxes. */
  netRate: number;
}

export function purchaseLineMath(rate: number, qty: number, bonus: number, stPct: number, whtPct: number): PurchaseLineMath {
  const q = Math.max(0, Number(qty) || 0);
  const b = Math.max(0, Number(bonus) || 0);
  const amount = (Number(rate) || 0) * q;
  const st = amount * ((Number(stPct) || 0) / 100);
  const wht = amount * ((Number(whtPct) || 0) / 100);
  return { amount, st, wht, total: amount + st + wht, netRate: q + b > 0 ? amount / (q + b) : Number(rate) || 0 };
}
