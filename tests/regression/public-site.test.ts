/** Public website: the product registry matches the app's type registry,
 * demo / contact requests are validated and bot-filtered before
 * saving (tests/server/queries.test.ts), and the proxy serves the site only on the corporate domain,
 * leaving the app's own routes (/products) untouched. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { BUSINESS_TYPES } from "@/config/businessTypes";
import { SITE_PRODUCTS, PRODUCT_GROUPS, productFacts } from "@/config/siteProducts";
import { checkLead, LeadError } from "@/server/leads";

before(() => {
  process.env.NEXT_PUBLIC_SITE_HOSTS = "mavin.pk,www.mavin.pk";
});

test("one site product per business type, with unique slugs and a known group", () => {
  assert.equal(SITE_PRODUCTS.length, BUSINESS_TYPES.length);
  assert.deepEqual(new Set(SITE_PRODUCTS.map((p) => p.typeId)), new Set(BUSINESS_TYPES.map((t) => t.id)));
  assert.equal(new Set(SITE_PRODUCTS.map((p) => p.slug)).size, SITE_PRODUCTS.length);
  for (const p of SITE_PRODUCTS) {
    assert.ok(PRODUCT_GROUPS.includes(p.group), p.slug);
    assert.ok(productFacts(p).workflow.length > 0, `${p.slug} has a workflow from the registry`);
  }
});

test("pilot call-to-action for the partly ready products named in the brief, demo for the rest", () => {
  const pilots = SITE_PRODUCTS.filter((p) => p.cta === "pilot").map((p) => p.slug).sort();
  assert.deepEqual(pilots, ["clinic-management", "contractor-invoicing", "hospital-management", "hospital-pharmacy"]);
  for (const p of SITE_PRODUCTS.filter((x) => x.cta === "pilot")) assert.notEqual(productFacts(p).status, "ready", `${p.slug} is not marked ready in the app`);
});

test("public copy makes no blanket compliance or forever claims", () => {
  const text = JSON.stringify(SITE_PRODUCTS).toLowerCase();
  for (const banned of ["fbr compliant", "fully compliant", "certified", "run forever", "lifetime", "guarantee", "100%"]) {
    assert.ok(!text.includes(banned), `"${banned}" must not appear`);
  }
});

const shown = Date.now() - 10_000;
const good = { kind: "demo", name: "Test Owner", business: "Synthetic Store", businessType: "General Store POS", branches: "2", phone: "0300 1234567", shownAt: shown };

test("a valid demo request is cleaned and accepted", () => {
  const lead = checkLead({ ...good, email: " Owner@Example.COM " }, "10.0.0.1");
  assert.equal(lead?.email, "owner@example.com");
  assert.equal(lead?.branches, "2");
});

test("missing or malformed fields are reported per field", () => {
  try {
    checkLead({ kind: "demo", name: "", business: "x", phone: "abc", email: "nope", branches: "two", shownAt: shown }, "10.0.0.2");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof LeadError);
    assert.equal(e.status, 400);
    assert.deepEqual(Object.keys(e.fields).sort(), ["branches", "business", "businessType", "email", "name", "phone"]);
  }
});

test("bots are dropped silently: honeypot filled, or the form sent too fast", () => {
  assert.equal(checkLead({ ...good, website: "http://spam" }, "10.0.0.3"), null);
  assert.equal(checkLead({ ...good, shownAt: Date.now() - 500 }, "10.0.0.3"), null);
  assert.equal(checkLead({ ...good, shownAt: undefined }, "10.0.0.3"), null);
});

test("one connection is limited to 5 requests in 10 minutes", () => {
  for (let i = 0; i < 5; i++) checkLead(good, "10.0.0.4");
  assert.throws(() => checkLead(good, "10.0.0.4"), (e: unknown) => e instanceof LeadError && e.status === 429);
  assert.ok(checkLead(good, "10.0.0.5"), "another connection is unaffected");
});

test("proxy: clean paths on the corporate domain only; the app's /products is untouched elsewhere", async () => {
  const { siteRoute } = await import("@/lib/siteRoute");
  assert.deepEqual(siteRoute("www.mavin.pk", "/products"), { kind: "rewrite", path: "/site/products" });
  assert.deepEqual(siteRoute("WWW.mavin.pk:443", "/"), { kind: "pass" }, "the home page is the main landing page");
  assert.deepEqual(siteRoute("mavin.pk", "/pricing"), { kind: "redirect-host", host: "www.mavin.pk" }, "mavin.pk goes to the official www address");
  assert.deepEqual(siteRoute("www.mavin.pk", "/robots.txt"), { kind: "rewrite", path: "/site/robots.txt" });
  assert.deepEqual(siteRoute("app.mavin.pk", "/products"), { kind: "pass" }, "the app address keeps the app");
  assert.deepEqual(siteRoute("www.mavin.pk", "/site/pricing"), { kind: "redirect", path: "/pricing" });
  assert.deepEqual(siteRoute("www.mavin.pk", "/api/site/lead/"), { kind: "pass" }, "the site's API is served as is");
  assert.deepEqual(siteRoute("www.mavin.pk", "/mavin-header.png"), { kind: "pass" }, "assets are served as is");
  assert.deepEqual(siteRoute("app.example.vercel.app", "/products"), { kind: "pass" }, "the app's /products is not rewritten");
  assert.deepEqual(siteRoute(null, "/products"), { kind: "pass" });
  for (const p of ["/lab-report/", "/report/", "/set-password/"]) assert.deepEqual(siteRoute("www.mavin.pk", p), { kind: "pass" }, `${p} works on the website address too`);
});

test("public paths: the site and the report link are public, app screens are not", async () => {
  const { isPublicPath } = await import("@/lib/publicPaths");
  for (const p of ["/", "/report", "/site", "/site/products/retail-pharmacy-pos"]) assert.equal(isPublicPath(p), true, p);
  for (const p of ["/products", "/invoices", "/admin", "/sitex"]) assert.equal(isPublicPath(p), false, p);
});
