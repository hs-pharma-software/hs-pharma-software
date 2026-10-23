/**
 * Electric / Electronics / Solar store rules. Pure functions, relative
 * imports only (runs under `node --test`).
 *
 * Money: integer paisa. Quantities: integer milli-units (3 decimals), so a
 * 100 m cable roll sold 37.5 m at a time never drifts (100000 - 37500 ...).
 */

import { allocate, toPaisa, toRupees } from "../restaurant/engine.ts";

export { allocate, toPaisa, toRupees };

export const QTY_SCALE = 1000;
export const toMilli = (q: number): number => Math.round((Number(q) || 0) * QTY_SCALE);
export const fromMilli = (m: number): number => Math.round(m) / QTY_SCALE;
/** Rounds a quantity to the configured precision (0-3 decimals). */
export const roundQty = (q: number, decimals = 3): number => {
  const f = 10 ** Math.min(3, Math.max(0, decimals));
  return Math.round((Number(q) || 0) * f) / f;
};

// ── Product types and their specification fields ─────────────────────

export type ProductType = "general" | "electrical" | "cable" | "solar_panel" | "inverter" | "battery" | "electronics";

export interface SpecField {
  key: string;
  /** i18n key for the label. */
  label: string;
  kind: "text" | "number" | "select";
  unit?: string;
  options?: string[];
}

const F = (key: string, label: string, kind: SpecField["kind"] = "text", unit?: string, options?: string[]): SpecField => ({ key, label, kind, unit, options });

/** Only the fields relevant to each product type are shown and stored. */
export const SPEC_FIELDS: Record<ProductType, SpecField[]> = {
  general: [],
  electronics: [F("power_w", "spec.power", "number", "W"), F("voltage_v", "spec.voltage", "number", "V"), F("standard", "spec.standard")],
  electrical: [
    F("voltage_v", "spec.voltage", "number", "V"),
    F("current_a", "spec.current", "number", "A"),
    F("power_w", "spec.power", "number", "W"),
    F("poles", "spec.poles", "number"),
    F("material", "spec.material"),
    F("ip_rating", "spec.ip"),
    F("standard", "spec.standard"),
  ],
  cable: [
    F("cable_category", "spec.cableCategory", "select", undefined, ["Single core", "Multi core", "Flexible", "Armoured", "Solar DC", "Coaxial", "Network (LAN)", "Other"]),
    F("cores", "spec.cores", "number"),
    F("size_mm2", "spec.crossSection", "number", "mm²"),
    F("gauge", "spec.gauge"),
    F("conductor", "spec.conductor", "select", undefined, ["Copper", "Aluminium", "Tinned copper", "Other"]),
    F("insulation", "spec.insulation"),
    F("roll_length_m", "spec.rollLength", "number", "m"),
    F("standard", "spec.standard"),
  ],
  solar_panel: [
    F("watt", "spec.ratedWatt", "number", "W"),
    F("technology", "spec.panelTech", "select", undefined, ["Mono PERC", "TOPCon", "HJT", "Bifacial", "Polycrystalline", "Thin film", "Other"]),
    F("efficiency_pct", "spec.efficiency", "number", "%"),
    F("cell_type", "spec.cellType"),
    F("dimensions", "spec.dimensions"),
    F("voc", "spec.voc", "number", "V"),
    F("vmp", "spec.vmp", "number", "V"),
    F("isc", "spec.isc", "number", "A"),
    F("imp", "spec.imp", "number", "A"),
  ],
  inverter: [
    F("capacity", "spec.capacity", "number", "kW"),
    F("inverter_type", "spec.inverterType", "select", undefined, ["On-grid", "Hybrid", "Off-grid", "UPS"]),
    F("phase", "spec.phase", "select", undefined, ["Single phase", "Three phase"]),
    F("input_voltage", "spec.inputRange"),
    F("output_voltage", "spec.outputVoltage", "number", "V"),
    F("battery_voltage", "spec.batteryVoltage", "number", "V"),
    F("battery_chemistry", "spec.batteryChemistry"),
    F("mppt", "spec.mppt"),
  ],
  battery: [
    F("chemistry", "spec.chemistry", "select", undefined, ["Lithium (LiFePO4)", "Lithium (NMC)", "Lead acid (tubular)", "Lead acid (SMF/AGM)", "Gel", "Other"]),
    F("nominal_v", "spec.nominalVoltage", "number", "V"),
    F("capacity", "spec.batteryCapacity", "number", "Ah"),
    F("capacity_kwh", "spec.energy", "number", "kWh"),
    F("cycle_life", "spec.cycleLife", "number"),
    F("mfg_date", "spec.mfgDate"),
  ],
};

export const SERIAL_DEFAULT: Record<ProductType, boolean> = {
  general: false,
  electrical: false,
  cable: false,
  solar_panel: true,
  inverter: true,
  battery: true,
  electronics: false,
};

/** Keeps only the spec keys that belong to the product type, trimmed. */
export function cleanSpecs(type: ProductType, specs: Record<string, unknown> | null | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of SPEC_FIELDS[type] ?? []) {
    const v = specs?.[f.key];
    if (v == null || String(v).trim() === "") continue;
    if (f.kind === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${f.key} must be a number ≥ 0.`);
      out[f.key] = n;
    } else out[f.key] = String(v).trim();
  }
  return out;
}

// ── Units ─────────────────────────────────────────────────────────────

export interface UnitInfo {
  unit: string;
  purchase_unit: string | null;
  purchase_factor: number;
}

/** Base-unit quantity for a line entered in `unit` ("base" or "purchase"). */
export function toBaseQty(p: UnitInfo, qty: number, unit: "base" | "purchase"): number {
  const factor = unit === "purchase" && p.purchase_unit ? p.purchase_factor || 1 : 1;
  return fromMilli(toMilli(qty * factor));
}

/** Stock after a signed movement, exact to 3 decimals. */
export const addQty = (a: number, b: number): number => fromMilli(toMilli(a) + toMilli(b));

export function canDeduct(stock: number, qty: number, allowNegative: boolean): boolean {
  return allowNegative || toMilli(stock) - toMilli(qty) >= 0;
}

// ── Lines and documents ───────────────────────────────────────────────

export interface LineInput {
  qty: number;
  price: number; // per entered unit, rupees
  discount: number; // rupees on this line
  taxRate: number; // %
}

export interface LineCalc {
  grossPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
}

export function calcLine(l: LineInput): LineCalc {
  const grossPaisa = Math.round(toPaisa(l.price) * (Number(l.qty) || 0));
  const discountPaisa = Math.min(Math.max(0, toPaisa(l.discount)), grossPaisa);
  const taxable = grossPaisa - discountPaisa;
  const taxPaisa = Math.round((taxable * Math.max(0, Number(l.taxRate) || 0)) / 100);
  return { grossPaisa, discountPaisa, taxPaisa, totalPaisa: taxable + taxPaisa };
}

export interface DocCalc {
  lines: LineCalc[];
  grossPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
}

/** Lines plus an optional bill-level discount spread over the lines before
 * tax (so tax is on what the customer actually pays). */
export function calcDoc(lines: LineInput[], billDiscount = 0): DocCalc {
  const first = lines.map(calcLine);
  const nets = first.map((c) => c.grossPaisa - c.discountPaisa);
  const extra = Math.min(Math.max(0, toPaisa(billDiscount)), nets.reduce((a, b) => a + b, 0));
  const share = allocate(extra, nets);
  const out = lines.map((l, i) => {
    const discountPaisa = first[i].discountPaisa + share[i];
    const taxable = first[i].grossPaisa - discountPaisa;
    const taxPaisa = Math.round((taxable * Math.max(0, Number(l.taxRate) || 0)) / 100);
    return { grossPaisa: first[i].grossPaisa, discountPaisa, taxPaisa, totalPaisa: taxable + taxPaisa };
  });
  const sum = (f: (c: LineCalc) => number) => out.reduce((s, c) => s + f(c), 0);
  return { lines: out, grossPaisa: sum((c) => c.grossPaisa), discountPaisa: sum((c) => c.discountPaisa), taxPaisa: sum((c) => c.taxPaisa), totalPaisa: sum((c) => c.totalPaisa) };
}

export interface PaymentIn {
  method: "cash" | "card" | "bank" | "digital" | "cheque";
  amount: number;
}

export function settle(totalPaisa: number, payments: PaymentIn[]): { paidPaisa: number; balancePaisa: number; changePaisa: number } {
  const tendered = payments.reduce((s, p) => s + Math.max(0, toPaisa(p.amount)), 0);
  const changePaisa = Math.max(0, tendered - totalPaisa);
  const paidPaisa = tendered - changePaisa;
  return { paidPaisa, balancePaisa: totalPaisa - paidPaisa, changePaisa };
}

// ── Costing ───────────────────────────────────────────────────────────

/** Weighted average cost per base unit after receiving `qty` at `unitCost`. */
export function weightedAverage(stock: number, avgCost: number, qty: number, unitCost: number): number {
  const s = Math.max(0, stock);
  if (s + qty <= 0) return unitCost;
  return Math.round(((s * avgCost + qty * unitCost) / (s + qty)) * 10000) / 10000;
}

// ── Warranty ──────────────────────────────────────────────────────────

/** End date (YYYY-MM-DD) of a warranty starting on `start` for `months`. */
export function warrantyEnd(start: string, months: number | null | undefined): string | null {
  if (!months || months <= 0) return null;
  const [y, m, d] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d));
  // Covers up to the day before the same date `months` later. If that date
  // doesn't exist (Jan 31 + 1 month), it ends on the last day of that month.
  if (end.getUTCDate() !== d) end.setUTCDate(0);
  else end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

export function warrantyActive(end: string | null, today: string): boolean {
  return !!end && end >= today;
}

// ── Serials ───────────────────────────────────────────────────────────

/** Normalises and de-duplicates entered serial numbers. */
export function cleanSerials(list: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const s of list ?? []) {
    const v = String(s).trim().toUpperCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}
