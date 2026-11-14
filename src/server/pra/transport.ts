/** Sending one invoice to PRA's cloud API (eIMS manual v1.0 §6.4.2), server side.
 *
 * - Only the two documented addresses, chosen by environment; nothing else.
 * - Bearer token from the POS's encrypted credentials; normal TLS checks
 *   (the manual's sample turns certificate checks off: not done here).
 * - Route: through MAVIN's gateway (static outbound IP, the one PRA
 *   whitelists) when PRA_VIA_GATEWAY=1 and the gateway is set up; otherwise
 *   directly from this server. Production goes direct only with
 *   PRA_DIRECT_PRODUCTION=1 (its outbound IP must be the whitelisted one).
 *
 * Outcomes, as the FBR gateway's: "response" (PRA answered), "not_sent"
 * (never left: safe to send again), "uncertain" (may have reached PRA). */
import { gatewaySettings, callGateway, tenantRef, type GatewaySettings } from "@/server/fbr/gatewayClient";

export type PraEnvironment = "sandbox" | "production";
export type PraOutcome =
  | { outcome: "response"; status: number; body: string }
  | { outcome: "not_sent"; error: string }
  | { outcome: "uncertain"; error: string };

export const PRA_URLS: Record<PraEnvironment, string> = {
  sandbox: "https://ims.pral.com.pk/ims/sandbox/api/Live/PostData",
  production: "https://ims.pral.com.pk/ims/production/api/Live/PostData",
};
export const PRA_TIMEOUT_MS = 40_000;

export interface PraTransportDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** null: no gateway. Undefined: from the environment. */
  gateway?: GatewaySettings | null;
}

const NOT_SENT = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO|bad port/;

export function classifyPraError(e: unknown): PraOutcome {
  const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string; name?: string; errors?: { code?: string }[] } };
  const all = (err?.cause?.errors ?? []).map((x) => x?.code ?? "").join(" ");
  const code = `${err?.cause?.code ?? ""} ${err?.cause?.name ?? ""} ${err?.cause?.message ?? ""} ${all}`;
  if (NOT_SENT.test(code)) return { outcome: "not_sent", error: `Could not connect to PRA (${String(err?.cause?.code ?? err?.cause?.message ?? "connection failed").slice(0, 80)}).` };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return { outcome: "uncertain", error: "PRA did not answer in time." };
  return { outcome: "uncertain", error: `The connection to PRA broke before an answer came (${String(err?.cause?.code ?? err?.message ?? "unknown").slice(0, 80)}).` };
}

export function praRoute(environment: PraEnvironment, deps: PraTransportDeps = {}): { via: "gateway" | "direct" | "blocked"; reason?: string } {
  const env = deps.env ?? process.env;
  const gw = deps.gateway === undefined ? gatewaySettings(env as NodeJS.ProcessEnv) : deps.gateway;
  if (env.PRA_VIA_GATEWAY === "1" && gw) return { via: "gateway" };
  if (environment === "production" && env.PRA_DIRECT_PRODUCTION !== "1") {
    return { via: "blocked", reason: "Production PRA submissions go through MAVIN's static-IP gateway (PRA whitelists that IP). Set PRA_VIA_GATEWAY=1 once the gateway's PRA route is deployed." };
  }
  return { via: "direct" };
}

/** One POST of an invoice. `payload` is the JSON text exactly as stored. */
export async function postToPra(environment: PraEnvironment, token: string, payload: string, tenantId: string, deps: PraTransportDeps = {}): Promise<PraOutcome> {
  const route = praRoute(environment, deps);
  if (route.via === "blocked") return { outcome: "not_sent", error: route.reason! };
  if (route.via === "gateway") {
    const gw = (deps.gateway === undefined ? gatewaySettings((deps.env ?? process.env) as NodeJS.ProcessEnv) : deps.gateway)!;
    const r = await callGateway(gw, "POST", "/v1/pra", { environment, token, payload: JSON.parse(payload), tenantRef: tenantRef(tenantId, gw.secret) }, { fetchImpl: deps.fetchImpl, timeoutMs: PRA_TIMEOUT_MS + 15_000 });
    if (r.httpStatus === 0) {
      const f = r as { failure: "not_sent" | "uncertain"; error: string };
      return { outcome: f.failure, error: f.error.replace("FBR gateway", "gateway") };
    }
    const { httpStatus, data } = r as { httpStatus: number; data: Record<string, unknown> };
    if (httpStatus === 200 && (data.outcome === "response" || data.outcome === "not_sent" || data.outcome === "uncertain")) return data as PraOutcome;
    if (httpStatus >= 400 && httpStatus < 500) return { outcome: "not_sent", error: `MAVIN's gateway refused the request (${String(data.error ?? httpStatus)}).` };
    return { outcome: "uncertain", error: `MAVIN's gateway failed (HTTP ${httpStatus}).` };
  }
  try {
    const res = await (deps.fetchImpl ?? fetch)(PRA_URLS[environment], {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: payload,
      signal: AbortSignal.timeout(PRA_TIMEOUT_MS),
      redirect: "error",
    });
    const text = await res.text();
    return { outcome: "response", status: res.status, body: text.slice(0, 100_000) };
  } catch (e) {
    return classifyPraError(e);
  }
}
