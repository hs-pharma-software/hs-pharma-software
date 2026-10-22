"use client";

/** Small Base/Secondary unit segmented switch \u2014 e.g. "Pack | Tab". Used
 * anywhere a product with a configured secondary unit lets you enter qty
 * and price in either one (Products, Purchase, Order, Quotation, Invoice). */
export function UnitToggle({
  baseLabel,
  secondaryLabel,
  value,
  onChange,
}: {
  baseLabel: string;
  secondaryLabel: string;
  value: "base" | "secondary";
  onChange: (unit: "base" | "secondary") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-neutral-300 bg-white text-xs">
      <button
        type="button"
        onClick={() => onChange("base")}
        className={`px-2.5 py-1 font-medium ${
          value === "base" ? "bg-amber-500 text-white" : "text-neutral-600 hover:bg-neutral-100"
        }`}
      >
        {baseLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange("secondary")}
        className={`px-2.5 py-1 font-medium ${
          value === "secondary" ? "bg-amber-500 text-white" : "text-neutral-600 hover:bg-neutral-100"
        }`}
      >
        {secondaryLabel}
      </button>
    </div>
  );
}
