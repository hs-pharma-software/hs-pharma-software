/** The only FBR calls the gateway makes: a fixed list, never an open proxy.
 *
 * Outcomes for MAVIN:
 * - "response":  FBR answered (any HTTP status); MAVIN interprets the body.
 * - "not_sent":  the request never left (address not found, connection
 *                refused, TLS failure). Safe to send again.
 * - "uncertain": it may have reached FBR but no answer came back (timeout,
 *                connection dropped mid-way). FBR may have recorded the
 *                invoice: MAVIN must NOT send it again on its own. */

export type Environment = "sandbox" | "production";
export type Operation = "post" | "validate" | "reference" | "atl";

const DI = {
  post: { sandbox: "/di_data/v1/di/postinvoicedata_sb", production: "/di_data/v1/di/postinvoicedata" },
  validate: { sandbox: "/di_data/v1/di/validateinvoicedata_sb", production: "/di_data/v1/di/validateinvoicedata" },
} as const;

/** Reference lookups MAVIN uses (DI API v1.12), with a plain query string. */
const REFERENCE = /^\/pdi\/v[12]\/(SaleTypeToRate|HS_UOM|SroSchedule|SROItem)\?[A-Za-z0-9_=&.%-]{1,300}$/;

/** FBR's Active Taxpayer status (STATL, DI API): one POST with a registration number and a date. */
const ATL_PATH = "/dist/v1/statl";

export function atlPayloadOk(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return Object.keys(o).length === 2 && typeof o.regno === "string" && /^\d{7,13}$/.test(o.regno) && typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date);
}

export function fbrPath(op: Operation, env: Environment, referencePath?: string): string | null {
  if (op === "post" || op === "validate") return DI[op][env];
  if (op === "atl") return ATL_PATH;
  if (op === "reference" && typeof referencePath === "string" && REFERENCE.test(referencePath)) return referencePath;
  return null;
}

export type Outcome =
  | { outcome: "response"; status: number; body: string }
  | { outcome: "not_sent"; error: string }
  | { outcome: "uncertain"; error: string };

/** Network failures that happen before anything is sent. */
const NOT_SENT = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO|bad port/;

export function classifyError(e: unknown): Outcome {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string; name?: string; errors?: { code?: string }[] } };
  // Several addresses tried (IPv4 and IPv6): all of their errors count.
  const all = (err?.cause?.errors ?? []).map((x) => x?.code ?? "").join(" ");
  const code = `${err?.cause?.code ?? ""} ${err?.cause?.name ?? ""} ${err?.cause?.message ?? ""} ${all}`;
  if (NOT_SENT.test(code)) return { outcome: "not_sent", error: `Could not connect to FBR (${(err?.cause?.code ?? err?.cause?.message ?? "connection failed").toString().slice(0, 80)}).` };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return { outcome: "uncertain", error: "FBR did not answer in time." };
  return { outcome: "uncertain", error: `The connection to FBR broke before an answer came (${(err?.cause?.code ?? err?.message ?? "unknown").toString().slice(0, 80)}).` };
}

export async function callFbr(
  o: { baseUrl: string; timeoutMs: number; fetchImpl?: typeof fetch },
  path: string, token: string, method: "GET" | "POST", body?: string,
): Promise<Outcome> {
  const doFetch = o.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${o.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: method === "POST" ? body : undefined,
      signal: AbortSignal.timeout(o.timeoutMs),
      redirect: "error",
    });
    // Reading the answer can also time out: then FBR did get the request.
    const text = await res.text();
    return { outcome: "response", status: res.status, body: text.slice(0, 200_000) };
  } catch (e) {
    return classifyError(e);
  }
}
