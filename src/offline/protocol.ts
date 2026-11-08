/** Offline desktop sync protocol, shared word for word by the server
 * (src/server/offline) and the desktop app (desktop/src/core). No server-only
 * or browser-only imports: it runs in Node (server, Electron main, tests).
 *
 * Operations are immutable facts recorded on a device ("this cash sale
 * happened"). The server applies each operation exactly once (op_id), never
 * reprices it, and records a stock exception instead of inventing stock. */
import { createPublicKey, createPrivateKey, sign as edSign, verify as edVerify } from "node:crypto";

/** Bumped when the request/response shapes change incompatibly. */
export const PROTOCOL_VERSION = 1;
/** Version of the sale operation payload. */
export const SALE_SCHEMA_VERSION = 1;
/** Modules a device can be allowed to run offline. Only cash sales exist in the pilot. */
export const OFFLINE_MODULES = ["sale.cash"] as const;
export type OfflineModule = (typeof OFFLINE_MODULES)[number];
/** Business types whose sale screen the pilot reproduces (stock in batches, retail billing). */
export const OFFLINE_BUSINESS_TYPES = ["retail_pharmacy", "medical_store", "general_store"] as const;
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
  /** Line amounts (see lineAmounts). */
  gross: number;
  discountRs: number;
  taxRs: number;
  total: number;
}

export interface SalePayload {
  saleId: string;
  /** Receipt number printed offline: <device code>-<6 digits>. The server adds its own invoice number. */
  offlineRef: string;
  /** Business day (yyyy-mm-dd) on the device. */
  date: string;
  occurredAt: string;
  userId: string;
  customerName: string | null;
  customerPhone: string | null;
  lines: SaleLine[];
  totals: { total: number; discountRs: number; taxRs: number; payable: number; paid: number; balance: number; tendered: number; change: number };
  payment: { method: "cash"; amount: number };
}

export interface Operation {
  opId: string;
  kind: "sale.create";
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

/** Bill totals from the lines (no bill-level discount or charges in the pilot). */
export function saleTotals(lines: Pick<SaleLine, "gross" | "discountRs" | "taxRs">[], tendered: number) {
  const total = lines.reduce((s, l) => s + l.gross, 0);
  const discountRs = lines.reduce((s, l) => s + l.discountRs, 0);
  const taxRs = lines.reduce((s, l) => s + l.taxRs, 0);
  const payable = round2(total - discountRs + taxRs);
  return { total, discountRs, taxRs, payable, paid: payable, balance: 0, tendered, change: round2(tendered - payable) };
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
  if (!isStr(s.offlineRef, 40) || !/^[A-Z0-9]{3,8}-\d{6,}$/.test(s.offlineRef)) e.push("offlineRef");
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
    if (!isNum(l.qtyEntered) || l.qtyEntered <= 0) bad("qtyEntered");
    if (!isNum(l.qtyPacks) || Math.abs(l.qtyPacks - toPacks(l.qtyEntered, l.unit, l.packing)) > STOCK_EPS) bad("qtyPacks");
    if (!isNum(l.pricePerPack) || l.pricePerPack < 0) bad("pricePerPack");
    if (!isNum(l.discountPct) || l.discountPct < 0 || l.discountPct > 100) bad("discountPct");
    if (!isNum(l.taxPct) || l.taxPct < 0 || l.taxPct > 100) bad("taxPct");
    const a = lineAmounts(l.qtyPacks, l.pricePerPack, l.discountPct, l.taxPct);
    if (![["gross", l.gross], ["discountRs", l.discountRs], ["taxRs", l.taxRs], ["total", l.total]].every(([k, v]) => isNum(v) && Math.abs((v as number) - a[k as keyof typeof a]) <= MONEY_EPS)) bad("amounts");
  });
  const t = s.totals;
  if (!t || typeof t !== "object") return [...e, "totals"];
  const want = saleTotals(s.lines, t.tendered);
  for (const k of ["total", "discountRs", "taxRs", "payable", "paid", "balance"] as const) if (!isNum(t[k]) || Math.abs(t[k] - want[k]) > MONEY_EPS) e.push(`totals.${k}`);
  if (!isNum(t.tendered) || t.tendered + MONEY_EPS < t.payable) e.push("totals.tendered");
  if (!s.payment || s.payment.method !== "cash" || !isNum(s.payment.amount) || Math.abs(s.payment.amount - t.payable) > MONEY_EPS) e.push("payment");
  return e;
}

export function checkOperation(o: unknown): string[] {
  const op = o as Operation;
  if (!op || typeof op !== "object") return ["operation missing"];
  const e: string[] = [];
  if (!isStr(op.opId) || !ID.test(op.opId)) e.push("opId");
  if (op.kind !== "sale.create") e.push("kind");
  if (op.schemaVersion !== SALE_SCHEMA_VERSION) e.push("schemaVersion");
  if (!Array.isArray(op.dependsOn) || op.dependsOn.some((d) => !isStr(d))) e.push("dependsOn");
  if (!isStr(op.occurredAt, 40)) e.push("occurredAt");
  if (!isStr(op.userId)) e.push("userId");
  if (e.length) return e;
  const se = checkSale(op.payload);
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
