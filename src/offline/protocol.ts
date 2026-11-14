/** Offline desktop sync protocol, shared word for word by the server
 * (src/server/offline) and the desktop app (desktop/src/core). No server-only
 * or browser-only imports: it runs in Node (server, Electron main, tests).
 *
 * Operations are immutable facts recorded on a device ("this cash sale
 * happened"). The server applies each operation exactly once (op_id), never
 * reprices it, and records a stock exception instead of inventing stock. */
import { createPublicKey, createPrivateKey, sign as edSign, verify as edVerify } from "node:crypto";
import { callAllowed, type CallModule } from "./callList.ts";

/** Bumped when the request/response shapes change incompatibly. */
export const PROTOCOL_VERSION = 1;
/** Version of the sale operation payload. 2 adds bonus, a customer on credit,
 * charges, a bill discount and editing a sale; version 1 sales (cash only) are still accepted. */
export const SALE_SCHEMA_VERSION = 2;
export const SALE_SCHEMA_VERSIONS = [1, 2] as const;
/** Modules a device can be allowed to run offline. Only cash sales exist in the pilot. */
export const OFFLINE_MODULES = ["sale.cash"] as const;
export type OfflineModule = (typeof OFFLINE_MODULES)[number];
/** Business types whose sale screen works offline (stock in batches, the shared retail invoice).
 * Mobile shop handsets (IMEI) still need the internet; their accessories sell offline. */
export const OFFLINE_BUSINESS_TYPES = ["retail_pharmacy", "medical_store", "general_store", "hospital_pharmacy", "mobile_shop", "cloth_store", "distributor", "electronics_solar"] as const;
/** Offline allowance limits (hours). */
export const MIN_OFFLINE_HOURS = 1;
export const MAX_OFFLINE_HOURS = 14 * 24;
export const STOCK_EPS = 1e-6;
const MONEY_EPS = 0.011;

// ── Offline allowance (grant) ────────────────────────────────────────────

export interface GrantUser { id: string; name: string; role: "owner" | "staff" }
export interface GrantPayload {
  v: 1;
  deviceId: string;
  deviceCode: string;
  tenantId: string;
  tenantName: string;
  businessType: string;
  branchId: string;
  branchName: string;
  users: GrantUser[];
  modules: OfflineModule[];
  issuedAt: string;
  /** Offline sales stop after this moment until the device reconnects. */
  expiresAt: string;
}
export interface SignedGrant { payload: string; sig: string }

const b64u = (b: Buffer) => b.toString("base64url");

/** Server: signs a grant with the Ed25519 private key (PKCS8 PEM). */
export function signGrant(p: GrantPayload, privateKeyPem: string): SignedGrant {
  const payload = b64u(Buffer.from(JSON.stringify(p), "utf8"));
  const sig = b64u(edSign(null, Buffer.from(payload, "utf8"), createPrivateKey(privateKeyPem)));
  return { payload, sig };
}

/** Device: the grant, if the signature is the server's; null otherwise (edited, foreign or broken). */
export function verifyGrant(g: SignedGrant | null | undefined, publicKeyPem: string): GrantPayload | null {
  if (!g || typeof g.payload !== "string" || typeof g.sig !== "string") return null;
  try {
    const ok = edVerify(null, Buffer.from(g.payload, "utf8"), createPublicKey(publicKeyPem), Buffer.from(g.sig, "base64url"));
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(g.payload, "base64url").toString("utf8")) as GrantPayload;
    return p && p.v === 1 && typeof p.deviceId === "string" && typeof p.expiresAt === "string" ? p : null;
  } catch {
    return null;
  }
}

// ── Sale operation ───────────────────────────────────────────────────────

export interface SaleLine {
  lineId: string;
  productId: string;
  productName: string;
  batchId: string;
  batchNo: string | null;
  expiryDate: string | null;
  /** Units per pack (strip/box); loose units are fractions of a pack. */
  packing: number;
  unit: "pack" | "loose";
  /** As entered: packs, or loose units. */
  qtyEntered: number;
  /** In packs (the stock unit): qtyEntered, or qtyEntered / packing for loose units. */
  qtyPacks: number;
  /** Price of one pack when sold (captured, never recalculated by the server). */
  pricePerPack: number;
  discountPct: number;
  taxPct: number;
  purchasePrice: number;
  /** Bonus (free) quantity as entered, and in packs; taken from the same batch. Version 2. */
  bonusEntered?: number;
  bonusPacks?: number;
  /** Line amounts (see lineAmounts). */
  gross: number;
  discountRs: number;
  taxRs: number;
  total: number;
}

export interface SalePayload {
  saleId: string;
  /** Receipt number printed offline: <device code>-<6 digits>. The server adds its own invoice number.
   * An edit of an invoice made online has none (null). */
  offlineRef: string | null;
  /** Business day (yyyy-mm-dd) on the device. */
  date: string;
  occurredAt: string;
  userId: string;
  customerName: string | null;
  customerPhone: string | null;
  /** A customer of the business (needed for credit). Version 2. */
  customerId?: string | null;
  /** Cloth store: the customer's saved custom size (measurements) on the bill. Version 2. */
  measurementId?: string | null;
  lines: SaleLine[];
  /** discountRs: the lines' discounts; billDiscountRs and charges: on the whole bill (version 2). */
  totals: { total: number; discountRs: number; taxRs: number; billDiscountRs?: number; charges?: number; payable: number; paid: number; balance: number; tendered: number; change: number };
  /** cash: paid in full. credit: on the customer's account; amount = what was received now (version 2). */
  payment: { method: "cash" | "credit"; amount: number };
  /** Set on an edit (operation sale.update): what this computer last knew of the invoice.
   * afterOpId: this device's own previous operation on it; invoiceUpdatedAt: the server row it saw. */
  edit?: { afterOpId: string | null; invoiceUpdatedAt: string | null; invoiceNo: number | null };
}

export interface Operation {
  opId: string;
  kind: "sale.create" | "sale.update";
  entityId: string;
  schemaVersion: number;
  dependsOn: string[];
  occurredAt: string;
  userId: string;
  payload: SalePayload;
}

/** Packs for an entered quantity (6 decimals, as stock is kept). */
export function toPacks(qtyEntered: number, unit: "pack" | "loose", packing: number): number {
  const q = unit === "loose" ? qtyEntered / (packing > 0 ? packing : 1) : qtyEntered;
  return Math.round(q * 1e6) / 1e6;
}

/** The online invoice form's line arithmetic: price per pack x packs, then line discount, then tax on the rest. */
export function lineAmounts(qtyPacks: number, pricePerPack: number, discountPct: number, taxPct: number) {
  const gross = pricePerPack * qtyPacks;
  const discountRs = gross * (discountPct / 100);
  const taxRs = (gross - discountRs) * (taxPct / 100);
  return { gross, discountRs, taxRs, total: gross - discountRs + taxRs };
}

export interface BillTerms { billDiscountRs?: number; charges?: number; method?: "cash" | "credit"; paid?: number }

/** Bill totals, as the online invoice form: lines (after their discounts, with
 * tax), less the bill discount, plus charges. Cash is paid in full (tendered
 * covers it); on credit, paid is what was received now and the rest is owed. */
export function saleTotals(lines: Pick<SaleLine, "gross" | "discountRs" | "taxRs">[], tendered: number, terms: BillTerms = {}) {
  const total = lines.reduce((s, l) => s + l.gross, 0);
  const discountRs = lines.reduce((s, l) => s + l.discountRs, 0);
  const taxRs = lines.reduce((s, l) => s + l.taxRs, 0);
  const billDiscountRs = round2(terms.billDiscountRs ?? 0);
  const charges = round2(terms.charges ?? 0);
  const payable = round2(total - discountRs + taxRs - billDiscountRs + charges);
  if (terms.method === "credit") {
    const paid = round2(terms.paid ?? 0);
    return { total, discountRs, taxRs, billDiscountRs, charges, payable, paid, balance: round2(payable - paid), tendered: paid, change: 0 };
  }
  return { total, discountRs, taxRs, billDiscountRs, charges, payable, paid: payable, balance: 0, tendered, change: round2(tendered - payable) };
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Structural and arithmetic checks of a sale (server and device run the same). Empty = valid. */
export function checkSale(p: unknown): string[] {
  const e: string[] = [];
  const s = p as SalePayload;
  if (!s || typeof s !== "object") return ["payload missing"];
  if (!isStr(s.saleId) || !ID.test(s.saleId)) e.push("saleId");
  const ed = s.edit;
  if (ed != null && (typeof ed !== "object" || (ed.afterOpId != null && !isStr(ed.afterOpId)) || (ed.invoiceUpdatedAt != null && !isStr(ed.invoiceUpdatedAt, 40))
    || (ed.afterOpId == null) === (ed.invoiceUpdatedAt == null))) e.push("edit");
  // An edit of an invoice made online has no offline receipt number.
  if (!(ed != null && s.offlineRef == null) && (!isStr(s.offlineRef, 40) || !/^[A-Z0-9]{3,8}-\d{6,}$/.test(s.offlineRef))) e.push("offlineRef");
  if (s.customerId != null && !isStr(s.customerId, 64)) e.push("customerId");
  if (s.measurementId != null && !isStr(s.measurementId, 64)) e.push("measurementId");
  if (!isStr(s.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) e.push("date");
  if (!isStr(s.occurredAt, 40) || Number.isNaN(Date.parse(s.occurredAt))) e.push("occurredAt");
  if (!isStr(s.userId)) e.push("userId");
  if (s.customerName != null && (typeof s.customerName !== "string" || s.customerName.length > 120)) e.push("customerName");
  if (s.customerPhone != null && (typeof s.customerPhone !== "string" || s.customerPhone.length > 30)) e.push("customerPhone");
  if (!Array.isArray(s.lines) || s.lines.length === 0 || s.lines.length > 300) return [...e, "lines"];
  const seen = new Set<string>();
  s.lines.forEach((l, i) => {
    const bad = (f: string) => e.push(`lines[${i}].${f}`);
    if (!isStr(l.lineId) || !ID.test(l.lineId) || seen.has(l.lineId)) bad("lineId");
    seen.add(l.lineId);
    if (!isStr(l.productId)) bad("productId");
    if (!isStr(l.batchId)) bad("batchId");
    if (!isNum(l.packing) || l.packing <= 0) bad("packing");
    if (l.unit !== "pack" && l.unit !== "loose") bad("unit");
    // A line may hold only bonus when the bonus runs into a second batch (as online).
    if (!isNum(l.qtyEntered) || l.qtyEntered < 0 || (l.qtyEntered === 0 && !((l.bonusPacks ?? 0) > 0))) bad("qtyEntered");
    if (!isNum(l.qtyPacks) || Math.abs(l.qtyPacks - toPacks(l.qtyEntered, l.unit, l.packing)) > STOCK_EPS) bad("qtyPacks");
    if (l.bonusEntered != null || l.bonusPacks != null) {
      if (!isNum(l.bonusEntered) || l.bonusEntered < 0 || !isNum(l.bonusPacks) || Math.abs(l.bonusPacks - toPacks(l.bonusEntered, l.unit, l.packing)) > STOCK_EPS) bad("bonus");
    }
    if (!isNum(l.pricePerPack) || l.pricePerPack < 0) bad("pricePerPack");
    if (!isNum(l.discountPct) || l.discountPct < 0 || l.discountPct > 100) bad("discountPct");
    if (!isNum(l.taxPct) || l.taxPct < 0 || l.taxPct > 100) bad("taxPct");
    const a = lineAmounts(l.qtyPacks, l.pricePerPack, l.discountPct, l.taxPct);
    if (![["gross", l.gross], ["discountRs", l.discountRs], ["taxRs", l.taxRs], ["total", l.total]].every(([k, v]) => isNum(v) && Math.abs((v as number) - a[k as keyof typeof a]) <= MONEY_EPS)) bad("amounts");
  });
  const t = s.totals;
  if (!t || typeof t !== "object") return [...e, "totals"];
  const method = s.payment?.method;
  if (method !== "cash" && method !== "credit") return [...e, "payment"];
  for (const k of ["billDiscountRs", "charges"] as const) if (t[k] != null && (!isNum(t[k]) || t[k]! < 0)) e.push(`totals.${k}`);
  const want = saleTotals(s.lines, t.tendered, { billDiscountRs: t.billDiscountRs, charges: t.charges, method, paid: t.paid });
  for (const k of ["total", "discountRs", "taxRs", "payable", "paid", "balance"] as const) if (!isNum(t[k]) || Math.abs(t[k] - want[k]) > MONEY_EPS) e.push(`totals.${k}`);
  if (!(t.payable >= -MONEY_EPS)) e.push("totals.payable");
  if (method === "cash") {
    if (!isNum(t.tendered) || t.tendered + MONEY_EPS < t.payable) e.push("totals.tendered");
  } else {
    // Credit: on a customer's account; what was received now is between nothing and the bill.
    if (!isStr(s.customerId ?? "", 64)) e.push("customerId");
    if (!(t.paid >= -MONEY_EPS && t.paid <= t.payable + MONEY_EPS)) e.push("totals.paid");
  }
  if (!isNum(s.payment.amount) || Math.abs(s.payment.amount - t.paid) > MONEY_EPS) e.push("payment");
  return e;
}

export function checkOperation(o: unknown): string[] {
  const op = o as Operation;
  if (!op || typeof op !== "object") return ["operation missing"];
  const e: string[] = [];
  if (!isStr(op.opId) || !ID.test(op.opId)) e.push("opId");
  if (op.kind !== "sale.create" && op.kind !== "sale.update") e.push("kind");
  if (!(SALE_SCHEMA_VERSIONS as readonly number[]).includes(op.schemaVersion)) e.push("schemaVersion");
  if (!Array.isArray(op.dependsOn) || op.dependsOn.some((d) => !isStr(d))) e.push("dependsOn");
  if (!isStr(op.occurredAt, 40)) e.push("occurredAt");
  if (!isStr(op.userId)) e.push("userId");
  if (e.length) return e;
  const se = checkSale(op.payload);
  // Only version 2 has the new fields; an edit is a sale.update and says what it changes.
  const p = op.payload;
  if (op.schemaVersion === 1 && (p?.payment?.method !== "cash" || p.edit != null || p.customerId != null || p.measurementId != null || p.totals?.billDiscountRs || p.totals?.charges || p.lines?.some((l) => l.bonusPacks))) se.push("schemaVersion");
  if ((op.kind === "sale.update") !== (p?.edit != null)) se.push("edit");
  if (op.entityId !== op.payload?.saleId) se.push("entityId");
  if (op.userId !== op.payload?.userId) se.push("userId mismatch");
  return se;
}

// ── Pull ─────────────────────────────────────────────────────────────────

export type PullCursor =
  | { phase: "initial"; table: "products" | "price_list" | "product_batches"; after: string; snapSeq: number }
  | { phase: "live"; seq: number };

export interface PulledProduct { id: string; name: string; barcode: string | null; packing: number; taxPct: number; isNarcotic: boolean; trackImei: boolean; deleted: boolean }
export interface PulledPrice { id: string; productId: string; salePrice: number; createdAt: string; deleted: boolean }
export interface PulledBatch { id: string; productId: string; batchNo: string | null; expiryDate: string | null; qty: number; purchasePrice: number; deleted: boolean }

export interface PullResponse {
  products: PulledProduct[];
  prices: PulledPrice[];
  batches: PulledBatch[];
  cursor: PullCursor;
  more: boolean;
  /** The cursor was too old for the change log: the device starts a full download again. */
  reset: boolean;
  grant: SignedGrant;
  serverTime: string;
}

export interface PushResult {
  opId: string;
  /** applied: in the books; conflict: in the books with a stock exception; held: kept for review (device revoked); rejected: not accepted (reason). */
  status: "applied" | "conflict" | "held" | "rejected";
  invoiceId?: string;
  invoiceNo?: number;
  exceptions?: number;
  appliedSeq?: number;
  error?: string;
}

// ── Module call operation (Phase 2: distribution, electronics) ───────────

/** Version of the call operation payload. */
export const CALL_SCHEMA_VERSION = 1;
export { OFFLINE_CALLS, CALL_MODULE_FOR_TYPE, callAllowed, type CallModule } from "./callList.ts";
const MAX_CALL_BYTES = 256_000;

export interface CallPayload {
  callId: string;
  /** Receipt number on this computer: <device code>-<6 digits>, as offline sales. */
  offlineRef: string;
  module: CallModule;
  fn: string;
  args: unknown[];
  /** The ids the save created on this computer, in order: MAVIN.pk uses the same (the copy then matches). */
  ids: string[];
  /** The save's clock (ISO): its dates and times on both sides. */
  at: string;
  /** The business day on the computer at that moment (yyyy-mm-dd): "today" for the save on both sides. */
  day: string;
  userId: string;
  /** What the screens show for it (e.g. "Sale invoice", total). */
  label: string;
  amount: number | null;
}

export interface CallOperation {
  opId: string;
  kind: "call";
  entityId: string;
  schemaVersion: number;
  dependsOn: string[];
  occurredAt: string;
  userId: string;
  payload: CallPayload;
}
export type AnyOperation = Operation | CallOperation;

export function checkCall(p: unknown): string[] {
  const c = p as CallPayload;
  if (!c || typeof c !== "object") return ["payload missing"];
  const e: string[] = [];
  if (!isStr(c.callId) || !ID.test(c.callId)) e.push("callId");
  if (!isStr(c.offlineRef, 40) || !/^[A-Z0-9]{3,8}-\d{6,}$/.test(c.offlineRef)) e.push("offlineRef");
  if (!callAllowed(c.module, c.fn)) e.push("fn");
  if (!Array.isArray(c.args) || c.args.length > 4) e.push("args");
  if (!Array.isArray(c.ids) || c.ids.length > 2000 || c.ids.some((x) => !isStr(x, 64) || !ID.test(x)) || new Set(c.ids).size !== c.ids.length) e.push("ids");
  if (!isStr(c.at, 40) || Number.isNaN(Date.parse(c.at))) e.push("at");
  if (!isStr(c.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(c.day)) e.push("day");
  if (!isStr(c.userId)) e.push("userId");
  if (typeof c.label !== "string" || c.label.length > 80) e.push("label");
  if (c.amount !== null && !isNum(c.amount)) e.push("amount");
  try { if (JSON.stringify(c.args).length > MAX_CALL_BYTES) e.push("args size"); } catch { e.push("args"); }
  return e;
}

export function checkCallOperation(o: unknown): string[] {
  const op = o as CallOperation;
  if (!op || typeof op !== "object") return ["operation missing"];
  const e: string[] = [];
  if (!isStr(op.opId) || !ID.test(op.opId)) e.push("opId");
  if (op.kind !== "call") e.push("kind");
  if (op.schemaVersion !== CALL_SCHEMA_VERSION) e.push("schemaVersion");
  if (!Array.isArray(op.dependsOn) || op.dependsOn.some((d) => !isStr(d))) e.push("dependsOn");
  if (!isStr(op.occurredAt, 40)) e.push("occurredAt");
  if (!isStr(op.userId)) e.push("userId");
  if (e.length) return e;
  const ce = checkCall(op.payload);
  if (op.entityId !== op.payload?.callId) ce.push("entityId");
  if (op.userId !== op.payload?.userId) ce.push("userId mismatch");
  return ce;
}
