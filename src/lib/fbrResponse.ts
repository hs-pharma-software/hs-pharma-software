/** Reading FBR Digital Invoicing answers: pure (no browser or server state),
 * so the browser (src/lib/fbr.ts) and MAVIN's server (src/server/fbr) read
 * FBR the same way. */

/** accepted: FBR recorded it. rejected: FBR refused it (may be sent again
 * after fixing). uncertain: no clear answer, FBR may have recorded it, so it
 * is NOT sent again until someone checks (Settings > FBR, resolve). */
export type FbrOutcome = "accepted" | "rejected" | "uncertain";

export interface FbrResponse {
  invoiceNumber?: string;
  validationResponse?: {
    statusCode?: string;
    errorCode?: string | null;
    error?: string;
    invoiceStatuses?: { itemSNo?: string; statusCode?: string; errorCode?: string | null; error?: string }[] | null;
  };
}

/** FBR sometimes returns JSON with trailing commas (`"x":"",\n}`). */
export function parseFbrJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return JSON.parse(text.replace(/,\s*([}\]])/g, "$1")) as T;
  }
}

export const UNCERTAIN_MESSAGE =
  "No clear answer came from FBR, so it may already have recorded this invoice. It will not be sent again automatically: check it in IRIS / the PRAL portal, then resolve it in Settings > FBR.";

/** What FBR's answer to a submitted invoice means. */
export function interpretFbrSubmit(status: number, text: string): { outcome: FbrOutcome; fbrInvoiceNo: string | null; error: string | null; json: unknown } {
  const no = (outcome: FbrOutcome, error: string, json: unknown = null) => ({ outcome, fbrInvoiceNo: null, error, json });
  if (status === 401 || status === 403) return no("rejected", `FBR rejected the token (HTTP ${status}). Check the token in Settings > FBR.`);

  let json: FbrResponse;
  try {
    json = parseFbrJson<FbrResponse>(text);
  } catch {
    // A server error page or an empty answer: FBR may have recorded it before failing.
    if (status >= 500 || status === 200) return no("uncertain", `FBR answered HTTP ${status} without a readable result. ${UNCERTAIN_MESSAGE}`);
    return no("rejected", `Unexpected response from FBR (HTTP ${status}): ${text.slice(0, 200)}`);
  }

  const vr = json?.validationResponse;
  const itemErrors = (vr?.invoiceStatuses ?? [])
    .filter((s) => s.statusCode && s.statusCode !== "00")
    .map((s) => `Item ${s.itemSNo}: ${s.error || "invalid"}${s.errorCode ? ` [${s.errorCode}]` : ""}`);

  if (vr?.statusCode === "00" && json.invoiceNumber && itemErrors.length === 0) {
    return { outcome: "accepted", fbrInvoiceNo: json.invoiceNumber, error: null, json };
  }
  if (itemErrors.length > 0) return no("rejected", itemErrors.join("\n"), json);
  if (vr?.errorCode === "500") {
    // FBR returns this generic "expected time" text for server-side crashes,
    // not real timeouts, so retrying the same data never helps.
    return no("rejected", "FBR could not process this invoice (FBR error 500). This is usually caused by invalid data such as special characters in a product name.", json);
  }
  if (vr?.statusCode === "00") return no("uncertain", `FBR reported success but sent no invoice number. ${UNCERTAIN_MESSAGE}`, json);
  if (!vr && status >= 500) return no("uncertain", `FBR server error (HTTP ${status}). ${UNCERTAIN_MESSAGE}`, json);
  return no("rejected", `${vr?.error || "FBR validation failed"}${vr?.errorCode ? ` [${vr.errorCode}]` : ""}`, json);
}

/** Reference lookups MAVIN uses (DI API v1.12), with a plain query string. Same list as the gateway's. */
export const FBR_REFERENCE_PATH = /^\/pdi\/v[12]\/(SaleTypeToRate|HS_UOM|SroSchedule|SROItem)\?[A-Za-z0-9_=&.%-]{1,300}$/;
