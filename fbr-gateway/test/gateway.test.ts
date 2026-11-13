/** Gateway tests against a local stand-in for FBR (never the real FBR). */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { createGateway } from "../src/server.ts";
import { signRequest } from "../src/auth.ts";
import { loadConfig, type GatewayConfig } from "../src/config.ts";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
type Seen = { method: string; url: string; auth: string | undefined; body: string };
const seen: Seen[] = [];
/** What the stand-in FBR does next: answer, hang, or drop the connection. */
let behaviour: "accept" | "reject401" | "error500" | "hang" | "drop" = "accept";

let fbr: Server;
let gw: ReturnType<typeof createGateway>;
let gwUrl = "";
let cfg: GatewayConfig;
const logs: string[] = [];

before(async () => {
  fbr = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      if (behaviour === "hang") return; // never answers
      if (behaviour === "drop") { req.socket.destroy(); return; }
      if (behaviour === "reject401") { res.writeHead(401); res.end(""); return; }
      if (behaviour === "error500") { res.writeHead(500); res.end("{}"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      // FBR's own style, trailing comma included.
      res.end(req.url!.startsWith("/pdi/") ? `[{"uoM_ID":1,"description":"Numbers, pieces, units",}]` : `{"invoiceNumber":"FBR-123","validationResponse":{"statusCode":"00","invoiceStatuses":[]}}`);
    });
  });
  await new Promise<void>((r) => fbr.listen(0, "127.0.0.1", r));
  cfg = loadConfig({ GATEWAY_SECRETS: `old-secret-0123456789abcdef0123456789ab,${SECRET}`, FBR_BASE_URL: `http://127.0.0.1:${(fbr.address() as AddressInfo).port}`, FBR_TIMEOUT_MS: "800", RATE_PER_TENANT_PER_MIN: "20" });
  gw = createGateway(cfg, { logLine: (l) => logs.push(l) });
  await new Promise<void>((r) => gw.listen(0, "127.0.0.1", r));
  gwUrl = `http://127.0.0.1:${(gw.address() as AddressInfo).port}`;
});
after(async () => {
  fbr.closeAllConnections();
  await new Promise((r) => fbr.close(r));
  gw.closeAllConnections();
  await new Promise((r) => gw.close(r));
});

async function call(body: unknown, o: { secret?: string; ts?: number; id?: string; path?: string; method?: string; tamper?: boolean } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const ts = String(o.ts ?? Date.now());
  const id = o.id ?? randomUUID();
  const method = o.method ?? "POST";
  const path = o.path ?? "/v1/fbr";
  const sig = signRequest(o.secret ?? SECRET, ts, id, method, path, raw);
  const res = await fetch(`${gwUrl}${path}`, {
    method, body: method === "GET" ? undefined : o.tamper ? raw.replace("sandbox", "production") : raw,
    headers: { "Content-Type": "application/json", "X-Mavin-Timestamp": ts, "X-Mavin-Request-Id": id, "X-Mavin-Signature": sig },
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const invoice = { invoiceType: "Sale Invoice", items: [{ hsCode: "3004.9099" }] };
const post = (extra: Record<string, unknown> = {}) => ({ environment: "sandbox", operation: "post", token: "tok-abc", payload: invoice, tenantRef: "tenant-ref-1", ...extra });

test("health answers without a signature and tells nothing secret", async () => {
  const r = await fetch(`${gwUrl}/health`);
  const j = (await r.json()) as Record<string, unknown>;
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.deepEqual(Object.keys(j).sort(), ["ok", "uptimeSec", "version"]);
});

test("a signed invoice goes to FBR's sandbox address with the business's token, and FBR's answer comes back", async () => {
  behaviour = "accept";
  seen.length = 0;
  const r = await call(post());
  assert.equal(r.status, 200);
  assert.equal(r.json.outcome, "response");
  assert.equal(r.json.status, 200);
  assert.match(String(r.json.body), /FBR-123/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/di_data/v1/di/postinvoicedata_sb");
  assert.equal(seen[0].auth, "Bearer tok-abc");
  assert.deepEqual(JSON.parse(seen[0].body), invoice);
});

test("production and validate use their own addresses; sandbox never reaches production", async () => {
  behaviour = "accept";
  seen.length = 0;
  await call(post({ environment: "production" }));
  await call(post({ operation: "validate" }));
  await call(post({ environment: "production", operation: "validate" }));
  assert.deepEqual(seen.map((s) => s.url), ["/di_data/v1/di/postinvoicedata", "/di_data/v1/di/validateinvoicedata_sb", "/di_data/v1/di/validateinvoicedata"]);
});

test("reference lookups: only FBR's known lookups, as GET", async () => {
  behaviour = "accept";
  seen.length = 0;
  const ok = await call({ environment: "sandbox", operation: "reference", referencePath: "/pdi/v2/HS_UOM?hs_code=3004.9099&annexure_id=3", token: "t1", tenantRef: "tenant-ref-1" });
  assert.equal(ok.json.outcome, "response");
  assert.equal(seen[0].method, "GET");
  for (const bad of ["/pdi/v2/Anything?x=1", "/di_data/v1/di/postinvoicedata", "https://evil.example/x", "/pdi/v2/HS_UOM?x=1/../../admin", "/pdi/v2/HS_UOM"]) {
    const r = await call({ environment: "sandbox", operation: "reference", referencePath: bad, token: "t1", tenantRef: "tenant-ref-1" });
    assert.equal(r.status, 400, bad);
  }
  assert.equal(seen.length, 1, "nothing else reached FBR");
});

test("ATL status (STATL): a registration number and a date, POSTed to FBR's statl address; anything else refused", async () => {
  behaviour = "accept";
  seen.length = 0;
  const ok = await call({ environment: "production", operation: "atl", payload: { regno: "7308865", date: "2026-11-13" }, token: "t1", tenantRef: "tenant-ref-1" });
  assert.equal(ok.json.outcome, "response");
  assert.deepEqual([seen[0].url, seen[0].method], ["/dist/v1/statl", "POST"]);
  for (const bad of [{ regno: "12", date: "2026-11-13" }, { regno: "7308865" }, { regno: "7308865", date: "13-11-2026" }, { regno: "7308865", date: "2026-11-13", extra: "x" }, { regno: "73088 65", date: "2026-11-13" }]) {
    const r = await call({ environment: "production", operation: "atl", payload: bad, token: "t1", tenantRef: "tenant-ref-1" });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(seen.length, 1, "nothing else reached FBR");
});

test("unsigned, wrongly signed, tampered, stale or replayed requests are refused before FBR", async () => {
  behaviour = "accept";
  seen.length = 0;
  const unsigned = await fetch(`${gwUrl}/v1/fbr`, { method: "POST", body: JSON.stringify(post()) });
  assert.equal(unsigned.status, 401);
  assert.equal((await call(post(), { secret: "wrong-secret-0123456789abcdef0123456789" })).status, 401);
  assert.equal((await call(post(), { tamper: true })).status, 401, "body changed after signing");
  assert.equal((await call(post(), { ts: Date.now() - 10 * 60_000 })).status, 401, "too old");
  const id = randomUUID();
  assert.equal((await call(post(), { id })).status, 200);
  assert.equal((await call(post(), { id })).status, 401, "same request id again");
  assert.equal(seen.length, 1, "only the one good request reached FBR");
});

test("the previous secret still works during a key change", async () => {
  behaviour = "accept";
  const r = await call(post(), { secret: "old-secret-0123456789abcdef0123456789ab" });
  assert.equal(r.status, 200);
});

test("bad bodies are refused: no token, unknown environment, no tenant reference, oversized", async () => {
  assert.equal((await call(post({ token: "" }))).status, 400);
  assert.equal((await call(post({ environment: "live" }))).status, 400);
  assert.equal((await call(post({ tenantRef: "" }))).status, 400);
  assert.equal((await call(post({ payload: null }))).status, 400);
  assert.equal((await call("not json")).status, 400);
  const huge = post({ payload: { items: "x".repeat(cfg.maxBodyBytes + 10) } });
  const r = await fetch(`${gwUrl}/v1/fbr`, { method: "POST", body: JSON.stringify(huge) }).catch(() => null);
  assert.ok(!r || r.status === 413, "too large");
});

test("FBR's own refusals and errors come back as answers (MAVIN decides)", async () => {
  behaviour = "reject401";
  let r = await call(post());
  assert.deepEqual([r.json.outcome, r.json.status], ["response", 401]);
  behaviour = "error500";
  r = await call(post());
  assert.deepEqual([r.json.outcome, r.json.status], ["response", 500]);
});

test("no answer from FBR (timeout or dropped mid-way) is 'uncertain'; nothing listening is 'not_sent'", async () => {
  behaviour = "hang";
  let r = await call(post());
  assert.equal(r.json.outcome, "uncertain", "timed out after sending");
  behaviour = "drop";
  r = await call(post());
  assert.equal(r.json.outcome, "uncertain", "connection dropped after sending");

  // A port nothing listens on: take a free one, then close it.
  const probe = createServer();
  await new Promise<void>((res) => probe.listen(0, "127.0.0.1", res));
  const closedPort = (probe.address() as AddressInfo).port;
  await new Promise((res) => probe.close(res));
  const down = createGateway(loadConfig({ GATEWAY_SECRETS: SECRET, FBR_BASE_URL: `http://127.0.0.1:${closedPort}`, FBR_TIMEOUT_MS: "800" }), { logLine: () => undefined });
  await new Promise<void>((res) => down.listen(0, "127.0.0.1", res));
  const saved = gwUrl;
  gwUrl = `http://127.0.0.1:${(down.address() as AddressInfo).port}`;
  try {
    r = await call(post());
    assert.equal(r.json.outcome, "not_sent", "connection refused: never sent");
  } finally {
    gwUrl = saved;
    await new Promise((res) => down.close(res));
  }
});

test("a business that sends too much is slowed down, others are not", async () => {
  behaviour = "accept";
  let limited = 0;
  for (let i = 0; i < 25; i++) if ((await call(post({ tenantRef: "busy-business" }))).status === 429) limited++;
  assert.ok(limited >= 5, `limited ${limited}`);
  assert.equal((await call(post({ tenantRef: "quiet-business" }))).status, 200);
});

test("logs never hold the token, the invoice or the signature", () => {
  const all = logs.join("\n");
  assert.ok(logs.some((l) => l.includes("fbr_call")));
  for (const secret of ["tok-abc", "3004.9099", SECRET, "Sale Invoice"]) assert.ok(!all.includes(secret), secret);
});

test("settings: secrets are required and must be long", () => {
  assert.throws(() => loadConfig({}), /GATEWAY_SECRETS/);
  assert.throws(() => loadConfig({ GATEWAY_SECRETS: "short" }), /32/);
});
