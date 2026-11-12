/** Request signing between MAVIN's server and the gateway.
 *
 * signature = hex(HMAC-SHA256(secret, `${timestamp}.${requestId}.${METHOD}.${path}.${sha256hex(body)}`))
 * headers:    X-Mavin-Timestamp (ms since epoch), X-Mavin-Request-Id (unique), X-Mavin-Signature
 *
 * The same function signs in MAVIN (src/server/fbr/gatewayClient.ts); keep them identical.
 * A request is accepted once: within the clock window, and its id not seen before. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export function signRequest(secret: string, timestamp: string, requestId: string, method: string, path: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${requestId}.${method.toUpperCase()}.${path}.${sha256Hex(body)}`).digest("hex");
}

export type AuthResult = { ok: true } | { ok: false; reason: string };

/** Remembers request ids for the clock window, so a captured request cannot be sent again. */
export class ReplayGuard {
  private seen = new Map<string, number>();
  private readonly windowMs: number;
  constructor(windowMs: number) { this.windowMs = windowMs; }
  /** True the first time an id is offered. */
  firstUse(id: string, now: number): boolean {
    if (this.seen.size > 50_000) this.prune(now);
    if (this.seen.has(id)) return false;
    this.seen.set(id, now);
    return true;
  }
  prune(now: number) {
    for (const [id, at] of this.seen) if (now - at > 2 * this.windowMs) this.seen.delete(id);
  }
}

export function verifyRequest(
  o: { secrets: string[]; maxSkewMs: number; replay: ReplayGuard; now: number },
  h: { timestamp?: string; requestId?: string; signature?: string },
  method: string, path: string, body: string,
): AuthResult {
  const { timestamp, requestId, signature } = h;
  if (!timestamp || !requestId || !signature) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{10,16}$/.test(timestamp) || !/^[A-Za-z0-9-]{8,80}$/.test(requestId) || !/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: "malformed signature headers" };
  if (Math.abs(o.now - Number(timestamp)) > o.maxSkewMs) return { ok: false, reason: "timestamp outside the allowed window" };
  const given = Buffer.from(signature, "hex");
  const match = o.secrets.some((s) => {
    const want = Buffer.from(signRequest(s, timestamp, requestId, method, path, body), "hex");
    return want.length === given.length && timingSafeEqual(want, given);
  });
  if (!match) return { ok: false, reason: "bad signature" };
  // Only a correctly signed request uses up its id.
  if (!o.replay.firstUse(requestId, o.now)) return { ok: false, reason: "request already used" };
  return { ok: true };
}
