/** MAVIN's server → its FBR gateway (fbr-gateway/, on a VPS with a static IP).
 *
 * Requests are signed exactly as fbr-gateway/src/auth.ts verifies them (a test
 * keeps the two identical). The gateway is used when FBR_GATEWAY_URL and
 * FBR_GATEWAY_SECRET are set; otherwise MAVIN works in "direct" mode (each
 * browser calls FBR from its own IP, as before). */
import { createHash, createHmac, randomUUID } from "node:crypto";

export type Environment = "sandbox" | "production";
export type GatewayOutcome =
  | { outcome: "response"; status: number; body: string }
  | { outcome: "not_sent"; error: string }
  | { outcome: "uncertain"; error: string };

export interface GatewaySettings { url: string; secret: string }

export function gatewaySettings(env: NodeJS.ProcessEnv = process.env): GatewaySettings | null {
  const url = env.FBR_GATEWAY_URL?.trim().replace(/\/+$/, "");
  const secret = env.FBR_GATEWAY_SECRET?.split(",")[0]?.trim();
  if (!url || !secret) return null;
  return { url, secret };
}

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** Same formula as fbr-gateway/src/auth.ts signRequest. */
export function signRequest(secret: string, timestamp: string, requestId: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${requestId}.${method.toUpperCase()}.${path}.${sha256Hex(body)}`).digest("hex");
}

/** Failures reaching the gateway before anything was sent. */
const NOT_SENT = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO|bad port/;

export async function callGateway(
  g: GatewaySettings, method: "GET" | "POST", path: string, body: unknown,
  o: { timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<{ httpStatus: number; data: Record<string, unknown> } | { httpStatus: 0; failure: "not_sent" | "uncertain"; error: string }> {
  const raw = method === "GET" ? "" : JSON.stringify(body);
  const ts = String((o.now ?? Date.now)());
  const id = randomUUID();
  try {
    const res = await (o.fetchImpl ?? fetch)(`${g.url}${path}`, {
      method,
      body: method === "GET" ? undefined : raw,
      headers: {
        "Content-Type": "application/json",
        "X-Mavin-Timestamp": ts,
        "X-Mavin-Request-Id": id,
        "X-Mavin-Signature": signRequest(g.secret, ts, id, method, path, raw),
      },
      signal: AbortSignal.timeout(o.timeoutMs ?? 55_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { httpStatus: res.status, data };
  } catch (e) {
    const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
    const code = `${err?.cause?.code ?? ""} ${err?.cause?.message ?? ""} ${(err?.cause?.errors ?? []).map((x) => x?.code ?? "").join(" ")}`;
    if (NOT_SENT.test(code)) return { httpStatus: 0, failure: "not_sent", error: "MAVIN's FBR gateway could not be reached." };
    return { httpStatus: 0, failure: "uncertain", error: err?.name === "TimeoutError" ? "MAVIN's FBR gateway did not answer in time." : "The connection to MAVIN's FBR gateway broke." };
  }
}

/** One FBR call through the gateway, reduced to the gateway's three outcomes. */
export async function viaGateway(
  g: GatewaySettings,
  req: { environment: Environment; operation: "post" | "validate" | "reference"; token: string; tenantRef: string; payload?: unknown; referencePath?: string },
  o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<GatewayOutcome> {
  const r = await callGateway(g, "POST", "/v1/fbr", req, o);
  if (r.httpStatus === 0) {
    const f = r as { failure: "not_sent" | "uncertain"; error: string };
    return { outcome: f.failure, error: f.error };
  }
  const { httpStatus, data } = r as { httpStatus: number; data: Record<string, unknown> };
  if (httpStatus === 200 && (data.outcome === "response" || data.outcome === "not_sent" || data.outcome === "uncertain")) return data as GatewayOutcome;
  // The gateway refused it before calling FBR (bad request, signature, rate limit): FBR never saw it.
  if (httpStatus >= 400 && httpStatus < 500) return { outcome: "not_sent", error: `MAVIN's FBR gateway refused the request (${String(data.error ?? httpStatus)}).` };
  return { outcome: "uncertain", error: `MAVIN's FBR gateway failed (HTTP ${httpStatus}).` };
}

/** A per-business reference for the gateway's logs and rate limits (not the business id itself). */
export const tenantRef = (tenantId: string, secret: string) => createHmac("sha256", secret).update(`tenant:${tenantId}`).digest("hex").slice(0, 24);
