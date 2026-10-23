/**
 * Sends queued PRA submissions (see store.queuePra) to PRA and records the
 * outcome. Two official transports (PRA spec v1.2):
 *  - local: the PRA Software Fiscal Device (IMS component) installed on the
 *    POS computer, http://localhost:8524 (section 5);
 *  - cloud: ims.pral.com.pk sandbox/production with a Bearer token (7.2.2).
 *
 * Safety rules:
 *  - one sender per submission (store.claimPra conditional claim);
 *  - a submission is never re-sent automatically when the request may have
 *    reached PRA (timeout / app stopped mid-request): it goes to manual
 *    review so a second fiscal invoice is not created by accident;
 *  - HTTP 200 is not acceptance: only Code "100" with an invoice number is;
 *  - a credit note waits until its original invoice is accepted.
 *
 * Relative imports only (runs under `node --test`).
 */

import { toPaisa } from "./engine.ts";
import { PRA_ENDPOINTS, buildPraInvoice, mapPraResponse, validatePraInvoice, type PraInvoiceType, type PraSourceLine } from "./praModel.ts";
import { REST_SETTINGS, RestError, type OrderItemRow, type OrderRow, type PraSubmissionRow, type RestaurantStore } from "./store.ts";

export interface PraHttpResult {
  httpStatus: number | null;
  body: string | null;
  networkError?: string | null;
  /** True when the request may have reached the server (e.g. timed out
   * waiting for the answer); false when it surely did not (refused). */
  maybeDelivered?: boolean;
}

export interface PraTransport {
  post(url: string, body: string, headers: Record<string, string>, timeoutMs: number): Promise<PraHttpResult>;
  get(url: string, timeoutMs: number): Promise<PraHttpResult>;
}

export interface PraConfig {
  enabled: boolean;
  mode: "local" | "cloud";
  environment: "sandbox" | "production";
  posId: string;
  pctCode: string;
}

export function createPraService(store: RestaurantStore, transport: PraTransport, getToken: () => Promise<string | null>) {
  async function config(): Promise<PraConfig> {
    const [enabled, mode, env, posId, pct] = await Promise.all([
      store.settings.get(REST_SETTINGS.praEnabled),
      store.settings.get(REST_SETTINGS.praMode),
      store.settings.get(REST_SETTINGS.praEnv),
      store.settings.get(REST_SETTINGS.praPosId),
      store.settings.get(REST_SETTINGS.pctCode),
    ]);
    return {
      enabled: enabled === "true",
      mode: mode === "cloud" ? "cloud" : "local",
      environment: env === "production" ? "production" : "sandbox",
      posId: (posId ?? "").trim(),
      pctCode: (pct ?? "").trim(),
    };
  }

  /** PRA invoice for a submission, from the order's frozen line amounts. */
  async function buildFor(sub: PraSubmissionRow, cfg: PraConfig) {
    const { order, items } = await store.getOrder(sub.order_id);
    const lines = items.filter((i: OrderItemRow) => !i.parent_item_id && i.kitchen_status !== "cancelled");
    const src: PraSourceLine[] = lines.map((i) => ({
      code: i.code || i.id.slice(0, 12),
      name: i.name,
      qty: i.qty,
      grossPaisa: toPaisa(i.line_total),
      discountPaisa: toPaisa(i.line_discount),
      taxPaisa: toPaisa(i.line_tax),
      taxRate: i.tax_exempt ? 0 : order.tax_rate,
    }));
    if (order.service_charge > 0) {
      const lineTax = src.reduce((s, l) => s + l.taxPaisa, 0);
      src.push({
        code: "SERVICE",
        name: "Service Charges",
        qty: 1,
        grossPaisa: toPaisa(order.service_charge),
        discountPaisa: 0,
        taxPaisa: toPaisa(order.tax) - lineTax,
        taxRate: toPaisa(order.tax) - lineTax > 0 ? order.tax_rate : 0,
      });
    }
    const payments = order.payments ? (JSON.parse(order.payments) as { method: string }[]) : [];
    const inv = buildPraInvoice({
      posId: cfg.posId,
      usin: sub.usin,
      refUsin: sub.ref_usin,
      invoiceType: sub.invoice_type as PraInvoiceType,
      at: new Date(order.invoiced_at ?? order.created_at),
      pctCode: cfg.pctCode,
      methods: payments.map((p) => p.method),
      buyerName: order.customer_name,
      buyerPhone: order.customer_phone,
      lines: src,
    });
    return { order: order as OrderRow, inv };
  }

  async function send(body: string, cfg: PraConfig): Promise<PraHttpResult> {
    if (cfg.mode === "local") return transport.post(PRA_ENDPOINTS.localPost, body, { "Content-Type": "application/json" }, 30_000);
    const token = await getToken();
    if (!token) return { httpStatus: 0, body: JSON.stringify({ Code: "NO_TOKEN", Response: "No PRA token is saved on this computer." }) };
    const url = cfg.environment === "production" ? PRA_ENDPOINTS.cloudProduction : PRA_ENDPOINTS.cloudSandbox;
    return transport.post(url, body, { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, 45_000);
  }

  const service = {
    config,

    /** Sends one submission if it is due. Returns its final status. */
    async submit(submissionId: string): Promise<string> {
      const cfg = await config();
      if (!cfg.enabled) return "not_required";
      const sub = await store.claimPra(submissionId);
      if (!sub) return "skipped"; // already being sent, or not due

      // A credit note must reference an invoice PRA already has.
      if (sub.invoice_type === 3) {
        const originals = await store.praSubmissions("accepted");
        if (!originals.some((o) => o.usin === sub.ref_usin && o.invoice_type === 1)) {
          await store.finishPra(sub.id, { status: "pending", last_error: "Waiting for the original invoice to be accepted by PRA." });
          return "pending";
        }
      }

      let inv;
      try {
        inv = (await buildFor(sub, cfg)).inv;
      } catch (e) {
        await store.finishPra(sub.id, { status: "manual_review", last_error: e instanceof Error ? e.message : String(e) });
        return "manual_review";
      }
      const errors = validatePraInvoice(inv);
      if (!cfg.pctCode) errors.unshift("Set the PCT code (Restaurant Settings > PRA).");
      if (errors.length) {
        await store.finishPra(sub.id, { status: "rejected", payload: JSON.stringify(inv), last_error: errors.join(" "), response_text: "Not sent: failed checks before submission" });
        return "rejected";
      }

      const payload = JSON.stringify(inv);
      const res = await send(payload, cfg);
      let outcome = mapPraResponse(res);
      if (outcome.status === "retry_pending" && res.httpStatus == null && res.maybeDelivered) {
        outcome = { ...outcome, status: "manual_review", message: `${outcome.message} The invoice may have reached PRA: check the IMS Fiscal Report, then retry or record the PRA number.` };
      }
      await store.finishPra(sub.id, {
        status: outcome.status,
        pra_invoice_no: outcome.praInvoiceNo,
        response_code: outcome.code,
        response_text: outcome.message,
        payload,
        last_error: outcome.status === "accepted" ? null : outcome.message,
      });
      return outcome.status;
    },

    /** Recovers stuck rows, then sends everything pending. */
    async processQueue(): Promise<Record<string, number>> {
      const cfg = await config();
      if (!cfg.enabled) return {};
      await store.recoverStuckPra();
      const due = [...(await store.praSubmissions("pending")), ...(await store.praSubmissions("retry_pending"))]
        // originals before credit notes
        .sort((a, b) => a.invoice_type - b.invoice_type || a.created_at.localeCompare(b.created_at));
      const counts: Record<string, number> = {};
      for (const s of due) {
        const st = await service.submit(s.id);
        counts[st] = (counts[st] ?? 0) + 1;
      }
      return counts;
    },

    /** Local: the IMS component's health URL. Cloud sandbox: an invoice that
     * PRA must refuse (POS ID 0), to check the token and connectivity
     * without creating a fiscal record. Production cloud has no safe test
     * call, so it is not probed. */
    async testConnection(): Promise<{ ok: boolean; message: string }> {
      const cfg = await config();
      if (cfg.mode === "local") {
        const r = await transport.get(PRA_ENDPOINTS.localHealth, 8000);
        if (r.httpStatus === 200 && /responding/i.test(r.body ?? "")) return { ok: true, message: "PRA IMS component is running on this computer." };
        return { ok: false, message: r.networkError ? `IMS component not reachable at localhost:8524 (${r.networkError}). Install it from PRA and start the service.` : `Unexpected answer: HTTP ${r.httpStatus} ${r.body ?? ""}` };
      }
      if (cfg.environment === "production") return { ok: false, message: "Production has no safe test call; it is checked on the first real invoice." };
      const token = await getToken();
      if (!token) return { ok: false, message: "Save the sandbox token first." };
      const r = await transport.post(PRA_ENDPOINTS.cloudSandbox, JSON.stringify({ POSID: 0, USIN: "CONNECTION-TEST", Items: [] }), { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, 30_000);
      if (r.httpStatus === 401) return { ok: false, message: "PRA rejected the token (Invalid Credentials)." };
      if (r.httpStatus == null) return { ok: false, message: `Could not reach PRA: ${r.networkError}` };
      const out = mapPraResponse(r);
      return { ok: r.httpStatus === 200, message: `Token accepted by the PRA sandbox gateway (answer for a dummy POS: code ${out.code} "${out.message}").` };
    },
  };
  return service;
}

export type PraService = ReturnType<typeof createPraService>;
export { RestError };
