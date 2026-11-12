/** The gateway's HTTP server (plain HTTP on 127.0.0.1; Caddy in front gives HTTPS).
 *
 *   GET  /health        no auth: { ok, version, uptimeSec }
 *   POST /v1/fbr        signed:  { environment, operation, referencePath?, token, payload?, tenantRef }
 *                                 -> { outcome: "response", status, body } | { outcome: "not_sent" | "uncertain", error }
 *   GET  /v1/egress-ip  signed:  { ip } as FBR would see it (static outbound IP check)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { GatewayConfig } from "./config.ts";
import { ReplayGuard, verifyRequest } from "./auth.ts";
import { callFbr, fbrPath, type Environment, type Operation } from "./fbr.ts";
import { log } from "./log.ts";

export interface GatewayDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  logLine?: (line: string) => void;
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new TooLarge()); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

/** Requests per minute, per key (fixed one-minute windows). */
class RateLimit {
  private counts = new Map<string, { minute: number; n: number }>();
  allow(key: string, limit: number, now: number): boolean {
    const minute = Math.floor(now / 60_000);
    const c = this.counts.get(key);
    if (!c || c.minute !== minute) { this.counts.set(key, { minute, n: 1 }); if (this.counts.size > 10_000) this.counts.clear(); return true; }
    c.n += 1;
    return c.n <= limit;
  }
}

export function createGateway(cfg: GatewayConfig, deps: GatewayDeps = {}): Server & { inFlight: () => number } {
  const now = deps.now ?? Date.now;
  const started = now();
  const replay = new ReplayGuard(cfg.maxSkewMs);
  const rate = new RateLimit();
  const out = deps.logLine;
  let inFlight = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://gateway");
    const reqId = String(req.headers["x-mavin-request-id"] ?? randomUUID()).slice(0, 80);
    const t0 = now();
    inFlight += 1;
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, version: cfg.version, uptimeSec: Math.round((now() - started) / 1000) });
      }
      const route = `${req.method} ${url.pathname}`;
      if (route !== "POST /v1/fbr" && route !== "GET /v1/egress-ip") return send(res, 404, { error: "Not found." });

      let raw: string;
      try { raw = await readBody(req, cfg.maxBodyBytes); } catch (e) {
        if (e instanceof TooLarge) return send(res, 413, { error: "Request too large." });
        throw e;
      }
      const auth = verifyRequest(
        { secrets: cfg.secrets, maxSkewMs: cfg.maxSkewMs, replay, now: now() },
        { timestamp: req.headers["x-mavin-timestamp"] as string | undefined, requestId: req.headers["x-mavin-request-id"] as string | undefined, signature: req.headers["x-mavin-signature"] as string | undefined },
        req.method ?? "", url.pathname, raw,
      );
      if (!auth.ok) {
        log("warn", "auth_rejected", { reqId, route, reason: auth.reason }, out);
        return send(res, 401, { error: "Not authorized." });
      }
      if (!rate.allow("*", cfg.rateTotal, now())) return send(res, 429, { error: "Too many requests." });

      if (route === "GET /v1/egress-ip") {
        const r = await callFbr({ baseUrl: "", timeoutMs: 10_000, fetchImpl: deps.fetchImpl }, cfg.egressCheckUrl, "", "GET");
        const ip = r.outcome === "response" ? r.body.trim().slice(0, 64) : null;
        log("info", "egress_ip", { reqId, ok: !!ip }, out);
        return send(res, ip ? 200 : 502, ip ? { ip } : { error: "Could not check the outbound IP." });
      }

      let b: { environment?: unknown; operation?: unknown; referencePath?: unknown; token?: unknown; payload?: unknown; tenantRef?: unknown };
      try { b = JSON.parse(raw); } catch { return send(res, 400, { error: "Body must be JSON." }); }
      const env = b.environment === "production" ? "production" : b.environment === "sandbox" ? "sandbox" : null;
      const op = b.operation === "post" || b.operation === "validate" || b.operation === "reference" ? (b.operation as Operation) : null;
      const tenantRef = typeof b.tenantRef === "string" && /^[A-Za-z0-9_-]{4,80}$/.test(b.tenantRef) ? b.tenantRef : null;
      const token = typeof b.token === "string" ? b.token.trim() : "";
      if (!env || !op || !tenantRef) return send(res, 400, { error: "environment, operation and tenantRef are required." });
      if (!token || token.length > 500 || /\s/.test(token)) return send(res, 400, { error: "A valid FBR token is required." });
      const path = fbrPath(op, env as Environment, typeof b.referencePath === "string" ? b.referencePath : undefined);
      if (!path) return send(res, 400, { error: "This FBR address is not allowed." });
      if (op !== "reference" && (typeof b.payload !== "object" || b.payload === null)) return send(res, 400, { error: "payload must be the invoice JSON." });
      if (!rate.allow(tenantRef, cfg.ratePerTenant, now())) return send(res, 429, { error: "Too many requests for this business. Try again in a minute." });

      const result = await callFbr(
        { baseUrl: cfg.fbrBaseUrl, timeoutMs: cfg.fbrTimeoutMs, fetchImpl: deps.fetchImpl },
        path, token, op === "reference" ? "GET" : "POST", op === "reference" ? undefined : JSON.stringify(b.payload),
      );
      log(result.outcome === "response" ? "info" : "warn", "fbr_call", {
        reqId, tenantRef, env, op, outcome: result.outcome,
        status: result.outcome === "response" ? result.status : null, ms: now() - t0,
      }, out);
      return send(res, 200, result);
    } catch (e) {
      log("error", "gateway_error", { reqId, message: e instanceof Error ? e.message.slice(0, 200) : "unknown" }, out);
      if (!res.headersSent) send(res, 500, { error: "Gateway error." });
    } finally {
      inFlight -= 1;
    }
  });
  server.requestTimeout = cfg.fbrTimeoutMs + 15_000;
  server.headersTimeout = 15_000;
  // Keep idle connections open longer than any caller does (Caddy closes its idle
  // ones after 30 s, see deploy/Caddyfile). If the gateway closed first, a caller
  // could send a request on a connection being closed: the request fails with a
  // reset and an invoice that never left would look "uncertain".
  server.keepAliveTimeout = 75_000;
  return Object.assign(server, { inFlight: () => inFlight });
}
