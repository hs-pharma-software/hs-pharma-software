/** "Submit to FBR" from the MAVIN Business app, the website's way
 * (lib/fbrSubmit.ts + server/fbr/service.ts): the FBR invoice is built from
 * the saved invoice with the website's buildFbrPayload, then sent through
 * fbr.submit, which allows one live attempt per invoice and records it. With
 * MAVIN's gateway the server sends it; without one ("direct", as the web
 * browser does) the app sends it to FBR itself and reports the answer with
 * finish. Only logins allowed "Submit to FBR"; a PRA invoice is refused. */
import { HttpError } from "./db";
import type { Sql } from "./subSupers";
import type { Caller } from "./sqlPolicy";
import type { BranchScope } from "./branches";
import * as fbr from "./fbr/service";
import { buildFbrPayload, type FbrItemRow } from "@/lib/fbrPayload";
import { normalizeNtn } from "@/lib/fbrData";
import { isPraInvoice } from "@/lib/pra/services";
import type { FbrSettings } from "@/lib/fbr";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** FBR's DI addresses (lib/fbr.ts POST_URL), for the app's direct send. */
export const FBR_POST_URL = {
  sandbox: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb",
  production: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata",
} as const;

async function settingsOf(sql: Sql, tenantId: string): Promise<Map<string, string>> {
  const keys = ["fbr_enabled", "fbr_environment", "fbr_seller_ntn", "fbr_seller_name", "fbr_seller_province", "fbr_seller_address", "fbr_retailer"];
  const r = await sql.execute(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(", ")})`, keys.map((k) => `${tenantId}::${k}`));
  return new Map(r.rows.map((x) => [String(x.key).slice(tenantId.length + 2), String(x.value ?? "")]));
}

/** Whether this login sees "Submit to FBR": FBR switched on for the business and the login allowed to submit. */
export async function fbrAvailable(sql: Sql, caller: Caller): Promise<boolean> {
  if (!caller.tenantId || !fbr.canSubmit(caller)) return false;
  const s = await settingsOf(sql, caller.tenantId);
  if (s.get("fbr_enabled") !== "true") return false;
  const t = await sql.execute(`SELECT fbr_allowed FROM tenants WHERE id = ?`, [caller.tenantId]);
  return Number(t.rows[0]?.fbr_allowed ?? 1) !== 0;
}

export interface AppFbrResult {
  success: boolean;
  fbrInvoiceNo: string | null;
  error: string | null;
  outcome: string;
  submissionId: string | null;
  /** Direct: the app posts `payload` to `url` with the token, then calls finish. */
  direct?: { url: string; token: string; payload: unknown };
}

export async function appFbrSubmit(sql: Sql, caller: Caller, invoiceId: string, scope: BranchScope | undefined): Promise<AppFbrResult> {
  if (!caller.tenantId) throw new HttpError(403, "This login is not attached to a business.");
  if (!fbr.canSubmit(caller)) throw new HttpError(403, "Your login cannot submit invoices to FBR.");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(invoiceId)) throw new HttpError(400, "Which invoice?");
  const T = caller.tenantId;
  const inv = (await sql.execute(`SELECT * FROM invoices WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [invoiceId, T])).rows[0] as Record<string, unknown> | undefined;
  if (!inv) throw new HttpError(404, "Invoice not found.");
  if (isPraInvoice(inv.invoice_type as string | null)) throw new HttpError(400, "A PRA Invoice is reported to PRA, not FBR.");
  if (Number(inv.is_memorized) === 1) throw new HttpError(400, "A draft (memorized invoice) goes to FBR after it is converted to an invoice.");
  if (inv.fbr_invoice_no) return { success: true, fbrInvoiceNo: String(inv.fbr_invoice_no), error: null, outcome: "accepted", submissionId: null };

  const cust = inv.customer_id
    ? ((await sql.execute(`SELECT name, cnic_ntn, province, address FROM customers WHERE id = ? AND tenant_id = ?`, [inv.customer_id, T])).rows[0] as Record<string, unknown> | undefined)
    : undefined;
  const items = (await sql.execute(
    `SELECT ii.qty, ii.sale_price, ii.tax_pct, ii.further_tax_pct, ii.discount_rs,
            COALESCE(NULLIF(TRIM(p.fbr_article_name), ''), p.name) AS product_name, p.hs_code, p.fbr_sale_type, p.fbr_sale_rate, p.fbr_uom,
            p.sro_no, p.sro_item_serial_no, p.fbr_qty_factor
     FROM invoice_items ii
     LEFT JOIN products p ON p.id = ii.product_id AND (p.tenant_id = ii.tenant_id OR p.tenant_id IS NULL)
     WHERE ii.invoice_id = ? AND ii.tenant_id = ? AND ii.deleted_at IS NULL`,
    [invoiceId, T],
  )).rows as unknown as FbrItemRow[];

  const s = await settingsOf(sql, T);
  const environment = s.get("fbr_environment") === "production" ? "production" : "sandbox";
  const settings: FbrSettings = {
    enabled: s.get("fbr_enabled") === "true",
    environment,
    sandboxToken: "",
    productionToken: "",
    sellerNtn: normalizeNtn(s.get("fbr_seller_ntn")),
    sellerName: s.get("fbr_seller_name") ?? "",
    sellerProvince: s.get("fbr_seller_province") ?? "",
    sellerAddress: s.get("fbr_seller_address") ?? "",
    retailer: s.get("fbr_retailer") === "true",
    serverManaged: true,
  };
  if (!settings.enabled) throw new HttpError(400, "FBR Digital Invoicing is not enabled (Settings > FBR on the website).");
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  const built = buildFbrPayload(
    String(inv.date),
    {
      name: str(inv.customer_name) ?? str(cust?.name),
      ntnCnic: str(inv.buyer_ntn_cnic) ?? str(cust?.cnic_ntn),
      province: str(inv.buyer_province) ?? str(cust?.province),
      address: str(inv.buyer_address) ?? str(cust?.address),
      registered: inv.buyer_registration_type === "Registered",
    },
    items,
    settings,
  );
  if ("error" in built) throw new HttpError(400, built.error);

  const r = await fbr.submit(sql, caller, { docType: "invoice", docId: invoiceId, environment, payload: built.payload }, scope);
  const base = { success: r.success, fbrInvoiceNo: r.fbrInvoiceNo, error: r.error, outcome: r.outcome, submissionId: r.submissionId };
  if (r.direct && r.token && r.submissionId) return { ...base, direct: { url: FBR_POST_URL[r.environment ?? environment], token: r.token, payload: built.payload } };
  return base;
}

/** Direct mode: what FBR answered the app (or that no answer came). */
export async function appFbrFinish(sql: Sql, caller: Caller, input: { submissionId?: unknown; report?: unknown }): Promise<AppFbrResult> {
  const r = await fbr.finish(sql, caller, input);
  return { success: r.success, fbrInvoiceNo: r.fbrInvoiceNo, error: r.error, outcome: r.outcome, submissionId: r.submissionId };
}
