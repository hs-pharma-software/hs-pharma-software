/** Plan prices for the pricing page and the plan editor: the plan's own term
 * price, and the yearly option (a year of terms less the plan's discount). */

export const DEFAULT_ANNUAL_DISCOUNT = 20;

/** How many plan terms make a year (30 days: 12; 90: 4; 365: 1). */
export function termsPerYear(days: number): number {
  if (days >= 28 && days <= 31) return 12;
  if (days >= 360) return 1;
  return Math.max(1, Math.round(365 / Math.max(1, days)));
}

export function annualPrice(price: number, days: number, discountPct: number | null | undefined): { full: number; price: number; saving: number; pct: number } {
  const pct = Math.max(0, Math.min(90, discountPct ?? DEFAULT_ANNUAL_DISCOUNT));
  const full = Math.round(price * termsPerYear(days));
  const yearly = Math.round(full * (1 - pct / 100));
  return { full, price: yearly, saving: full - yearly, pct };
}

/** A yearly option is offered for plans shorter than a year that have a price. */
export const offersAnnual = (p: { price: number; duration_days: number; annual_enabled?: number }) => p.annual_enabled !== 0 && p.price > 0 && p.duration_days < 360;

export const termLabel = (days: number) =>
  days >= 28 && days <= 31 ? "per month" : days >= 360 && days <= 366 ? "per year" : days === 90 ? "per 3 months" : days === 180 ? "per 6 months" : `per ${days} days`;

/** The description's look on the pricing page. */
export interface DescriptionStyle { size: "sm" | "base" | "lg" | "xl"; align: "left" | "center" | "right"; bold: boolean; italic: boolean }
export const DEFAULT_DESCRIPTION_STYLE: DescriptionStyle = { size: "sm", align: "left", bold: false, italic: false };
export const DESCRIPTION_SIZES: Record<DescriptionStyle["size"], { label: string; cls: string }> = {
  sm: { label: "Small", cls: "text-sm" }, base: { label: "Normal", cls: "text-base" }, lg: { label: "Large", cls: "text-lg" }, xl: { label: "Extra large", cls: "text-xl" },
};

export function parseDescriptionStyle(raw: string | null | undefined): DescriptionStyle {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<DescriptionStyle>) : {};
    return {
      size: v.size && v.size in DESCRIPTION_SIZES ? v.size : DEFAULT_DESCRIPTION_STYLE.size,
      align: v.align === "center" || v.align === "right" ? v.align : "left",
      bold: v.bold === true, italic: v.italic === true,
    };
  } catch {
    return DEFAULT_DESCRIPTION_STYLE;
  }
}

/** Tailwind classes for the description (fixed list, so the styles are always built). */
export const descriptionClasses = (s: DescriptionStyle) =>
  [DESCRIPTION_SIZES[s.size].cls, s.align === "center" ? "text-center" : s.align === "right" ? "text-right" : "text-left", s.bold ? "font-semibold" : "", s.italic ? "italic" : ""].filter(Boolean).join(" ");
