/**
 * Wholesaler / Distributor rules that need no database: withholding tax
 * treatment, target metrics and status, location freshness, booking state
 * machine and field validation. Relative imports only (node --test).
 */
import { calcDoc, toPaisa, toRupees, type DocCalc } from "../electric/engine.ts";

export { calcDoc, toPaisa, toRupees, type DocCalc };

export type DistMode = "pharma" | "general";

// ── Settings ──────────────────────────────────────────────────────────

/** Withholding income tax at sale (Income Tax Ordinance 2001, Division XIV /
 * XV of Part IV of the First Schedule). FBR's rate card "updated up to June 30,
 * 2025 as per Finance Act 2025" lists:
 *   236H sales to retailers                      ATL 0.50 %  non-ATL 2.50 %
 *   236G sales to distributors/dealers/wholesalers (other than fertilizers)
 *                                                 ATL 0.10 %  non-ATL 2.00 %
 * The requested defaults (0.5 % / 2.5 %) therefore match 236H (retailers)
 * only; customers who are themselves distributors/wholesalers fall under
 * 236G. Every rate, the base and the policies are configurable; the statute
 * prevails over these defaults. */
export interface WhtClassRule {
  section: string;
  /** Rate when the customer is verified on the Active Taxpayers List. */
  activeRate: number;
  /** Rate when verified NOT on the ATL (or no NTN/CNIC to check). */
  inactiveRate: number;
}

export interface DistSettings {
  wht: {
    enabled: boolean;
    classes: Record<string, WhtClassRule>;
    /** What to do when the customer's ATL status is unknown or too old. */
    unverifiedPolicy: "block" | "inactive_rate";
    /** A check older than this counts as unverified (FBR refreshes the ATL periodically). */
    maxCheckAgeDays: number;
    /** Taxable base: amount after discounts, with or without sales tax. */
    base: "net_incl_sales_tax" | "net_excl_sales_tax";
    rounding: "paisa" | "rupee";
  };
  location: {
    requiredForBooking: boolean;
    maxAgeSeconds: number;
    maxAccuracyMeters: number;
    /** Points implying a faster move than this are flagged (likely spoofed / jump). */
    maxSpeedKmh: number;
    retentionDays: number;
  };
  target: {
    metric: "bookings" | "approved" | "invoiced" | "net_sales";
    /** "On track" when achieved >= this share of the pro-rata target to date. */
    onTrackRatio: number;
  };
  cdsl: { required: boolean; alertDays: number; blockSaleWhenExpired: boolean };
  stock: { allowNegative: boolean };
  booking: { requireApproval: boolean };
}

export const DEFAULT_SETTINGS: DistSettings = {
  wht: {
    enabled: true,
    classes: {
      retailer: { section: "236H", activeRate: 0.5, inactiveRate: 2.5 },
      wholesaler: { section: "236G", activeRate: 0.1, inactiveRate: 2.0 },
      exempt: { section: "exempt", activeRate: 0, inactiveRate: 0 },
    },
    unverifiedPolicy: "inactive_rate",
    maxCheckAgeDays: 30,
    base: "net_incl_sales_tax",
    rounding: "paisa",
  },
  location: { requiredForBooking: true, maxAgeSeconds: 300, maxAccuracyMeters: 100, maxSpeedKmh: 200, retentionDays: 180 },
  target: { metric: "approved", onTrackRatio: 0.9 },
  cdsl: { required: true, alertDays: 30, blockSaleWhenExpired: true },
  stock: { allowNegative: false },
  booking: { requireApproval: true },
};

/** Deep-merges stored settings over the defaults (unknown keys dropped). */
export function mergeSettings(stored: unknown): DistSettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<DistSettings>;
  const d = DEFAULT_SETTINGS;
  return {
    wht: { ...d.wht, ...(s.wht ?? {}), classes: { ...d.wht.classes, ...(s.wht?.classes ?? {}) } },
    location: { ...d.location, ...(s.location ?? {}) },
    target: { ...d.target, ...(s.target ?? {}) },
    cdsl: { ...d.cdsl, ...(s.cdsl ?? {}) },
    stock: { ...d.stock, ...(s.stock ?? {}) },
    booking: { ...d.booking, ...(s.booking ?? {}) },
  };
}

// ── Validation ────────────────────────────────────────────────────────

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** NTN: 7 digits (old style 1234567-8 accepted) or a 13-digit CNIC used as NTN. Format only. */
export function normalizeNtn(v: string | null | undefined): string | null {
  const d = digits(v);
  if (!d) return null;
  if (d.length === 7 || d.length === 13) return d;
  if (d.length === 8) return d.slice(0, 7); // 1234567-8 check digit form
  throw new Error("NTN must be 7 digits (or a 13-digit CNIC).");
}
export function normalizeCnic(v: string | null | undefined): string | null {
  const d = digits(v);
  if (!d) return null;
  if (d.length !== 13) throw new Error("CNIC must be 13 digits.");
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}
export function normalizeMobile(v: string | null | undefined): string | null {
  const d = digits(v);
  if (!d) return null;
  const local = d.startsWith("92") && d.length === 12 ? `0${d.slice(2)}` : d;
  if (!/^03\d{9}$/.test(local)) throw new Error("Mobile number must be a Pakistani mobile (03XXXXXXXXX).");
  return local;
}
export function validCoords(lat: unknown, lng: unknown): boolean {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180 && !(a === 0 && b === 0);
}

export type CdslState = "missing" | "valid" | "expiring" | "expired";
export function cdslState(no: string | null, expiry: string | null, today: string, alertDays: number): CdslState {
  if (!no || !expiry) return "missing";
  if (expiry < today) return "expired";
  const t = new Date(`${today}T00:00:00Z`).getTime();
  const e = new Date(`${expiry}T00:00:00Z`).getTime();
  return (e - t) / 864e5 <= alertDays ? "expiring" : "valid";
}

// ── Withholding tax ───────────────────────────────────────────────────

export type AtlStatus = "active" | "inactive" | "unverified";

export interface WhtInput {
  ntn: string | null;
  cnic: string | null;
  taxClass: string;
  atlStatus: AtlStatus;
  atlCheckedAt: string | null;
  atlSource: string | null;
}

export interface WhtTreatment {
  section: string;
  /** Status used for the rate: an old or missing check is "unverified". */
  status: AtlStatus | "no_identifier" | "exempt" | "disabled";
  rate: number;
  blocked: string | null;
  note: string;
}

export function whtTreatment(s: DistSettings, c: WhtInput, nowIso: string): WhtTreatment {
  if (!s.wht.enabled) return { section: "-", status: "disabled", rate: 0, blocked: null, note: "Withholding tax disabled in settings." };
  const rule = s.wht.classes[c.taxClass] ?? s.wht.classes.retailer;
  if (rule.activeRate === 0 && rule.inactiveRate === 0) return { section: rule.section, status: "exempt", rate: 0, blocked: null, note: `Customer class "${c.taxClass}" carries no withholding.` };
  if (!c.ntn && !c.cnic) return { section: rule.section, status: "no_identifier", rate: rule.inactiveRate, blocked: null, note: "No NTN / CNIC: cannot be on the Active Taxpayers List; non-ATL rate." };
  const age = c.atlCheckedAt ? (new Date(nowIso).getTime() - new Date(c.atlCheckedAt).getTime()) / 864e5 : Infinity;
  const status: AtlStatus = c.atlStatus === "unverified" || age > s.wht.maxCheckAgeDays ? "unverified" : c.atlStatus;
  if (status === "active") return { section: rule.section, status, rate: rule.activeRate, blocked: null, note: `On ATL per ${c.atlSource ?? "check"} of ${c.atlCheckedAt?.slice(0, 10)}.` };
  if (status === "inactive") return { section: rule.section, status, rate: rule.inactiveRate, blocked: null, note: `Not on ATL per ${c.atlSource ?? "check"} of ${c.atlCheckedAt?.slice(0, 10)}.` };
  if (s.wht.unverifiedPolicy === "block")
    return { section: rule.section, status, rate: rule.inactiveRate, blocked: "The customer's Active Taxpayers List status is not verified (or the check is too old). Record an ATL check before invoicing.", note: "" };
  return { section: rule.section, status, rate: rule.inactiveRate, blocked: null, note: "ATL status not verified: non-ATL rate applied (customer was NOT treated as active)." };
}

export function whtAmount(s: DistSettings, calc: DocCalc, rate: number): { basePaisa: number; amountPaisa: number } {
  const net = calc.totalPaisa - (s.wht.base === "net_excl_sales_tax" ? calc.taxPaisa : 0);
  let amount = Math.round((net * rate) / 100);
  if (s.wht.rounding === "rupee") amount = Math.round(amount / 100) * 100;
  return { basePaisa: net, amountPaisa: amount };
}

// ── Location ──────────────────────────────────────────────────────────

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type LiveState = "live" | "stale" | "stopped" | "never";
/** Live only while a session is active AND its last point is fresh. */
export function liveState(session: { status: string } | null, lastPointAt: string | null, nowIso: string, maxAgeSeconds: number): LiveState {
  if (!session) return lastPointAt ? "stopped" : "never";
  if (session.status !== "active") return "stopped";
  if (!lastPointAt) return "stale";
  return (new Date(nowIso).getTime() - new Date(lastPointAt).getTime()) / 1000 <= maxAgeSeconds ? "live" : "stale";
}

// ── Bookings ──────────────────────────────────────────────────────────

export type BookingStatus = "draft" | "submitted" | "pending_approval" | "approved" | "rejected" | "converted" | "cancelled";
export const BOOKING_FLOW: Record<BookingStatus, BookingStatus[]> = {
  draft: ["submitted", "pending_approval", "cancelled"],
  submitted: ["pending_approval", "approved", "rejected", "cancelled"],
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["converted", "cancelled"],
  rejected: [],
  converted: [],
  cancelled: [],
};
export const canMove = (from: BookingStatus, to: BookingStatus) => BOOKING_FLOW[from]?.includes(to) ?? false;

// ── Targets ───────────────────────────────────────────────────────────

export type TargetStatus = "achieved" | "on_track" | "below";

export function targetProgress(target: number, achieved: number, month: string, today: string, onTrackRatio: number) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const elapsed = today.slice(0, 7) > month ? days : today.slice(0, 7) < month ? 0 : Number(today.slice(8, 10));
  const pct = target > 0 ? Math.round((achieved / target) * 10000) / 100 : 0;
  const expected = target * (elapsed / days);
  const status: TargetStatus = target > 0 && achieved >= target ? "achieved" : achieved >= expected * onTrackRatio ? "on_track" : "below";
  return { target, achieved, remaining: Math.max(0, toRupees(toPaisa(target) - toPaisa(achieved))), pct, status, elapsedDays: elapsed, daysInMonth: days };
}

// ── Permissions ───────────────────────────────────────────────────────

export const DIST_PERMS = [
  "customers.view", "customers.add", "customers.edit", "customers.verify",
  "catalog.view", "catalog.manage", "companies.manage",
  "bookings.create", "bookings.submit", "bookings.approve", "bookings.view_all",
  "invoices.view", "invoices.create", "invoices.edit_lines", "invoices.edit_qty", "invoices.edit_price", "invoices.discount",
  "invoices.edit_description", "invoices.edit_tax_base", "invoices.edit_wht_rate", "invoices.edit_wht_amount", "invoices.edit_customer", "invoices.return",
  "purchases.view", "purchases.create", "purchases.edit_qty", "purchases.edit_price", "purchases.discount", "purchases.edit_tax", "purchases.return",
  "payments.receive", "reports.view", "locations.view", "targets.view", "salesmen.view",
] as const;
export type DistPerm = (typeof DIST_PERMS)[number];

/** Never grantable to sub-users: only the distributor administrator. */
export const ADMIN_ONLY = ["customers.delete", "permissions.manage", "settings.manage", "targets.set", "salesmen.manage"] as const;
export type AdminAction = (typeof ADMIN_ONLY)[number];

/** Suggested starting set for a salesman login (still applied explicitly). */
export const SALESMAN_PRESET: DistPerm[] = ["customers.view", "customers.add", "catalog.view", "bookings.create", "bookings.submit", "targets.view"];

export const CUSTOMER_FIELDS = ["business_name", "owner_name", "ntn", "cnic", "mobile", "phone2", "email", "address", "territory", "tax_class", "cdsl_no", "cdsl_expiry", "notes", "location"] as const;
