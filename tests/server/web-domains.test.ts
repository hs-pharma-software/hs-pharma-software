/** Website addresses: host routing, the allowlist that picks a business,
 * custom domains (ownership, hosting, HTTPS) with a fake DNS and a fake
 * Vercel, uniqueness, disconnection, portal logins and image checks. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { enableFeatures, reserveSubdomain, setAdminFlags, publishSite } from "@/server/web/sites";
import { addDomain, canonicalBase, checkDomain, listDomains, normalizeDomain, portalTenantFor, removeDomain, resolveHost, setPrimary } from "@/server/web/domains";
import { webContext } from "@/server/web/publicSite";
import { previewToken } from "@/server/web/core";
import { webRoute, isAppHost } from "@/lib/webRoute";
import { imageInfo, saveImage, sizedImage } from "@/server/web/media";
import type { Http } from "@/server/seo/google";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const T = new Date().toISOString();
const run = (q: string, ...a: unknown[]) => db.prepare(q).run(...(a as never[]));
const VC = { token: "vercel-test", projectId: "prj_1", teamId: "team_1" };

beforeEach(async () => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  for (const [id, name] of [["t1", "Hands Pharmacy"], ["t2", "Other Shop"]]) run(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, 'retail_pharmacy', ?, ?)`, id, name, T, T);
  await enableFeatures(sql, "admin", "t1", { website: true, store: true });
  await enableFeatures(sql, "admin", "t2", { website: true });
  await reserveSubdomain(sql, "o", "t1", "handspharmacy");
  await reserveSubdomain(sql, "o", "t2", "othershop");
  await setAdminFlags(sql, "admin", "t1", { customDomainAllowed: true });
});

/** A fake Vercel: the domain verifies and is configured once `ready` is true. */
function fakeVercel(state: { ready: boolean; conflict?: boolean }) {
  const calls: string[] = [];
  const http: Http = async (url, init) => {
    calls.push(`${init.method} ${url.replace("https://api.vercel.com", "")}`);
    assert.equal(init.headers?.Authorization, "Bearer vercel-test");
    if (init.method === "POST" && url.includes("/v10/projects/")) return state.conflict ? { status: 409, json: { error: { code: "domain_already_in_use" } } } : { status: 200, json: { verified: false } };
    if (url.includes("/verify")) return { status: 200, json: { verified: state.ready } };
    if (url.includes("/v9/projects/") && init.method === "GET") return { status: 200, json: { verified: state.ready, verification: state.ready ? [] : [{ type: "TXT", domain: "_vercel.handspharmacy.pk", value: "vc-domain-verify=abc" }] } };
    if (url.includes("/v6/domains/")) return { status: 200, json: { misconfigured: !state.ready, recommendedCNAME: [{ rank: 1, value: "cname.example-host.net." }], recommendedIPv4: [{ rank: 1, value: ["192.0.2.10"] }] } };
    if (init.method === "DELETE") return { status: 200, json: {} };
    return { status: 404, json: {} };
  };
  return { http, calls };
}

test("routing: app and corporate hosts keep their routes; business hosts go to /web; /web is never reachable directly", () => {
  for (const h of ["app.mavin.pk", "localhost:3000", "hs-pharma-software.vercel.app", "www.mavin.pk", "mavin.pk"]) assert.ok(isAppHost(h), h);
  assert.deepEqual(webRoute("app.mavin.pk", "/dashboard"), { kind: "app" });
  assert.deepEqual(webRoute("app.mavin.pk", "/web/anything"), { kind: "block" });
  assert.deepEqual(webRoute("handspharmacy.mavin.pk", "/"), { kind: "rewrite", host: "handspharmacy.mavin.pk", path: "/web" });
  assert.deepEqual(webRoute("handspharmacy.mavin.pk", "/shop/item/x"), { kind: "rewrite", host: "handspharmacy.mavin.pk", path: "/web/shop/item/x" });
  assert.deepEqual(webRoute("handspharmacy.mavin.pk", "/robots.txt"), { kind: "rewrite", host: "handspharmacy.mavin.pk", path: "/web-meta/robots" });
  assert.equal(webRoute("handspharmacy.mavin.pk", "/admin").kind, "redirect");
  assert.equal(webRoute("handspharmacy.mavin.pk", "/web/x").kind, "block");
  assert.equal(webRoute("handspharmacy.mavin.pk", "/api/web/public/").kind, "pass");
  assert.deepEqual(webRoute("portal.hands.pk", "/", true), { kind: "redirect", url: "/dashboard" });
  assert.equal(webRoute("portal.hands.pk", "/invoices", true).kind, "pass");
});

test("the allowlist picks the business: subdomains and active custom domains only", async () => {
  assert.equal((await resolveHost(sql, "handspharmacy.mavin.pk"))?.tenantId, "t1");
  assert.equal((await resolveHost(sql, "HandsPharmacy.Mavin.pk:443"))?.tenantId, "t1");
  assert.equal(await resolveHost(sql, "www.mavin.pk"), null, "reserved");
  assert.equal(await resolveHost(sql, "nobody.mavin.pk"), null);
  assert.equal(await resolveHost(sql, "a.b.mavin.pk"), null);
  assert.equal(await resolveHost(sql, "evil.example"), null);
  await addDomain(sql, "o", "t1", "www.handspharmacy.pk", "website");
  assert.equal(await resolveHost(sql, "www.handspharmacy.pk"), null, "pending domains do not resolve");
});

test("custom domain: ownership, then hosting, then HTTPS; never active on DNS alone", async () => {
  const d = await addDomain(sql, "o", "t1", "https://WWW.HandsPharmacy.pk/path", "website");
  assert.equal(d.host, "www.handspharmacy.pk");
  assert.equal(d.status, "pending_verification");
  const token = d.records[0].value;
  const state = { ready: false };
  const v = fakeVercel(state);
  let txt: string[][] = [];
  let https = false;
  const deps = { txt: async () => txt, vercel: VC, http: v.http, https: async () => https };
  assert.equal((await checkDomain(sql, "o", "t1", d.id, deps)).status, "pending_verification");
  txt = [["wrong"]];
  assert.equal((await checkDomain(sql, "o", "t1", d.id, deps)).status, "pending_verification");
  txt = [[token]];
  let c = await checkDomain(sql, "o", "t1", d.id, deps);
  assert.equal(c.status, "dns_pending");
  assert.ok(c.records.some((r) => r.type === "CNAME" && r.value === "cname.example-host.net"), "records come from the hosting provider");
  assert.ok(c.records.some((r) => r.name === "_vercel.handspharmacy.pk"));
  assert.ok(v.calls.some((x) => x.includes("teamId=team_1")));
  state.ready = true;
  c = await checkDomain(sql, "o", "t1", d.id, deps);
  assert.equal(c.status, "ssl_pending", "DNS right but HTTPS not answering yet");
  https = true;
  c = await checkDomain(sql, "o", "t1", d.id, deps);
  assert.equal(c.status, "active");
  assert.equal((await resolveHost(sql, "www.handspharmacy.pk"))?.tenantId, "t1");
  assert.equal(await canonicalBase(sql, "t1", "website"), "https://www.handspharmacy.pk");
  // No hosting connection: ownership can be confirmed, but never active.
  const d2 = await addDomain(sql, "o", "t1", "shop.handspharmacy.pk", "store");
  assert.equal((await checkDomain(sql, "o", "t1", d2.id, { txt: async () => [[d2.records[0].value]], vercel: null })).status, "dns_pending");
});

test("one business per domain; limits; only allowed businesses; disconnect stops it at once", async () => {
  await addDomain(sql, "o", "t1", "www.handspharmacy.pk", "website");
  await assert.rejects(addDomain(sql, "o", "t2", "www.handspharmacy.pk", "website"), /not included/);
  await setAdminFlags(sql, "admin", "t2", { customDomainAllowed: true });
  await assert.rejects(addDomain(sql, "o", "t2", "www.handspharmacy.pk", "website"), /already connected/);
  await assert.rejects(addDomain(sql, "o", "t1", "x.mavin.pk", "website"), /Free address/);
  await assert.rejects(addDomain(sql, "o", "t1", "not a domain", "website"), /domain like/);
  await assert.rejects(addDomain(sql, "o", "t2", "shop.other.pk", "store"), /store is not switched on/);
  await setAdminFlags(sql, "admin", "t1", { maxCustomDomains: 1 });
  await assert.rejects(addDomain(sql, "o", "t1", "shop.handspharmacy.pk", "store"), /up to 1/);
  const [d] = await listDomains(sql, "t1");
  run(`UPDATE web_domains SET status = 'active', verification = json_set(verification, '$.addedToVercel', 1) WHERE id = ?`, d.id);
  assert.equal((await resolveHost(sql, d.host))?.tenantId, "t1");
  await assert.rejects(removeDomain(sql, "o", "t2", d.id), /not found/, "another business cannot remove it");
  await assert.rejects(setPrimary(sql, "o", "t2", d.id), /not found/);
  const v = fakeVercel({ ready: true });
  await removeDomain(sql, "o", "t1", d.id, { vercel: VC, http: v.http });
  assert.equal(await resolveHost(sql, d.host), null);
  assert.ok(v.calls.some((x) => x.startsWith("DELETE")));
});

test("portal domains sign in that business's logins only; the public site does not open there", async () => {
  const p = await addDomain(sql, "o", "t1", "portal.handspharmacy.pk", "portal");
  assert.equal(await portalTenantFor(sql, "portal.handspharmacy.pk"), null, "not active yet");
  run(`UPDATE web_domains SET status = 'active' WHERE id = ?`, p.id);
  assert.equal(await portalTenantFor(sql, "portal.handspharmacy.pk"), "t1");
  assert.equal(await portalTenantFor(sql, "handspharmacy.mavin.pk"), null);
  assert.equal(await webContext(sql, "portal.handspharmacy.pk", null), null);
});

test("public visibility: unpublished sites show nothing except to a preview link for that business; suspension hides it", async () => {
  assert.equal(await webContext(sql, "handspharmacy.mavin.pk", null), null, "draft");
  const ctx = await webContext(sql, "handspharmacy.mavin.pk", previewToken("t1"));
  assert.ok(ctx?.preview);
  assert.equal(await webContext(sql, "handspharmacy.mavin.pk", previewToken("t2")), null, "another business's preview link");
  await publishSite(sql, "o", "t1");
  assert.ok(await webContext(sql, "handspharmacy.mavin.pk", null));
  await setAdminFlags(sql, "admin", "t1", { publicSuspended: true });
  assert.equal(await webContext(sql, "handspharmacy.mavin.pk", null), null);
  await setAdminFlags(sql, "admin", "t1", { publicSuspended: false });
  run(`UPDATE tenants SET subscription_status = 'suspended' WHERE id = 't1'`);
  assert.equal(await webContext(sql, "handspharmacy.mavin.pk", null), null, "suspended subscription");
});

test("images: real image bytes only, size and dimension limits, storage limit, per-business folder", async () => {
  const png = (w: number, h: number) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  assert.deepEqual(imageInfo(png(800, 600)), { mime: "image/png", width: 800, height: 600 });
  assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  const folders: string[] = [];
  const up = async (_b: Blob, folder: string) => { folders.push(folder); return { url: "https://res.cloudinary.com/demo/image/upload/v1/x.png" }; };
  const r = await saveImage(sql, "o", "t1", png(800, 600), "Shop front", up);
  assert.equal(r.width, 800);
  assert.deepEqual(folders, ["mavin-web/t1"]);
  await assert.rejects(saveImage(sql, "o", "t1", png(9000, 10), "", up), /6000 pixels/);
  await assert.rejects(saveImage(sql, "o", "t1", Buffer.from("not an image at all, just text....."), "", up), /JPG, PNG/);
  await setAdminFlags(sql, "admin", "t1", { maxStorageMb: 0 });
  await assert.rejects(saveImage(sql, "o", "t1", png(10, 10), "", up), /storage/);
  assert.equal(sizedImage("https://res.cloudinary.com/demo/image/upload/v1/x.png", 480), "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_480/v1/x.png");
});
