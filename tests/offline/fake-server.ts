/** A throwaway MAVIN server for driving the real desktop app by hand or by
 * script: the real /api/offline service on an in-memory database with a
 * made-up pharmacy. Never touches the real database.
 *   node --import ./tests/register.mjs tests/offline/fake-server.ts <port> <publicKeyOut>
 * GET /_debug returns the server's invoices and stock (test only). */
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { HttpError } from "@/server/db";
import type { Caller } from "@/server/sqlPolicy";
import * as off from "@/server/offline/service";

const port = Number(process.argv[2] ?? 8787);
const keys = generateKeyPairSync("ed25519");
writeFileSync(process.argv[3] ?? "fake-public.pem", keys.publicKey.export({ type: "spki", format: "pem" }).toString());
process.env.OFFLINE_GRANT_PRIVATE_KEY = Buffer.from(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");

const db = fullSchemaDb();
const sql = sqliteSql(db);
const T = new Date().toISOString();
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
run(`INSERT INTO tenants (id, name, business_type, denied_actions, created_at, updated_at) VALUES ('t1', 'Demo Pharmacy', 'retail_pharmacy', '["+desktop.offline"]', ?, ?)`, T, T);
run(`INSERT INTO users (id, tenant_id, username, display_name, role, password_hash, password_salt, is_active, created_at, updated_at) VALUES ('u1', 't1', 'demo', 'Demo Owner', 'owner', 'x', 'x', 1, ?, ?)`, T, T);
const products: [string, string, number, number, number][] = [["p1", "Panadol 500mg", 10, 100, 25], ["p2", "Syrup X 120ml", 1, 250.5, 3], ["p3", "Vitamin C", 30, 300, 12]];
for (const [id, name, packing, price, qty] of products) {
  run(`INSERT INTO products (id, tenant_id, name, barcode, packing, created_at, updated_at) VALUES (?, 't1', ?, ?, ?, ?, ?)`, id, name, `89640000${id}`, packing, T, T);
  run(`INSERT INTO price_list (id, product_id, tenant_id, sale_price, created_at, updated_at) VALUES (?, ?, 't1', ?, ?, ?)`, `${id}-pr`, id, price, T, T);
  run(`INSERT INTO product_batches (id, product_id, tenant_id, branch_id, batch_no, expiry_date, qty, purchase_price, created_at, updated_at) VALUES (?, ?, 't1', 'main-t1', ?, '2027-12-31', ?, 40, ?, ?)`, `${id}-b`, id, `B${id}`, qty, T, T);
}
const owner: Caller = { userId: "u1", role: "owner", tenantId: "t1", permissions: null };

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/_debug") {
    return send(200, { invoices: db.prepare(`SELECT invoice_no, offline_ref, payable FROM invoices`).all(), stock: db.prepare(`SELECT id, qty FROM product_batches`).all() });
  }
  let raw = "";
  for await (const c of req) raw += c;
  const b = JSON.parse(raw || "{}") as Record<string, unknown>;
  try {
    if (req.url === "/api/auth/login/") {
      if (b.username !== "demo" || b.password !== "demo-pass") throw new HttpError(401, "Incorrect username or password.");
      return send(200, { userId: "u1", token: "fake-token", expiresInHours: 12 });
    }
    if (req.url !== "/api/offline/") throw new HttpError(404, "Not found.");
    const device = () => off.deviceFromAuth(sql, String(req.headers["x-mavin-device"] ?? ""));
    const caller = () => { if (req.headers.authorization !== "Bearer fake-token") throw new HttpError(401, "Session ended."); return owner; };
    off.checkProtocol(b.protocol);
    let result: unknown;
    switch (b.action) {
      case "provision": result = await off.provisionDevice(sql, caller(), b); break;
      case "enrol": result = await off.enrolUser(sql, await device(), caller()); break;
      case "pull": result = await off.pull(sql, await device(), b.cursor, b.status as never); break;
      case "push": result = { results: await off.push(sql, await device(), b.ops, b.status as never) }; break;
      default: throw new HttpError(400, "Unknown action.");
    }
    send(200, { result });
  } catch (e) {
    send(e instanceof HttpError ? e.status : 500, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(port, "127.0.0.1", () => console.log(`fake MAVIN server on ${port}`));
