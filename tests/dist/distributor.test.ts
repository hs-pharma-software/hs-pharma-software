/** Wholesaler / Distributor module: isolation, customers, salesmen & GPS,
 * bookings, targets, withholding tax and permissions (real schema). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDist, agePoints } from "./harness.ts";
import { SALESMAN_PRESET, cdslState, whtTreatment, DEFAULT_SETTINGS, targetProgress, normalizeNtn, liveState } from "../../src/lib/dist/engine.ts";

const month = new Date().toISOString().slice(0, 7);
const LAHORE = { lat: 31.5204, lng: 74.3587 };

async function distributor(h: ReturnType<typeof makeDist>, id: string, mode: "pharma" | "general") {
  const t = h.tenant(id);
  const s = h.as(t.owner);
  await s.setup(mode);
  const company = await s.saveCompany({ code: `${id}-CO`, name: `${id} Pharma Co` });
  await s.seedCategories();
  const cat = (await s.listCategories())[0];
  const product = await s.saveProduct({ company_id: company.id, category_id: cat.id, code: `${id}-P1`, name: `${id} Panadol 500`, trade_price: 100, cost: 80, sales_tax_rate: 0, openingQty: 1000 });
  const product2 = await s.saveProduct({ company_id: company.id, category_id: cat.id, code: `${id}-P2`, name: `${id} Brufen`, trade_price: 50, cost: 40, sales_tax_rate: 18, openingQty: 100 });
  const customer = await s.createCustomer({
    business_name: `${id} Medical Store`, owner_name: "Ali", ntn: "1234567", cnic: "35202-1234567-1", mobile: "03001234567", address: "Lahore",
    cdsl_no: mode === "pharma" ? "CDSL-1" : undefined, cdsl_expiry: mode === "pharma" ? "2030-01-01" : undefined,
    location: { ...LAHORE, accuracy: 15, source: "device" },
  });
  const smUser = t.staff("salesman");
  const salesman = await s.saveSalesman({ code: `${id}-S1`, name: `${id} Salesman`, user_id: smUser.userId!, mobile: "03011234567", monthly_target: 2000000 });
  await s.setPerms(smUser.userId!, SALESMAN_PRESET);
  return { t, owner: t.owner, sm: smUser, company, cat, product, product2, customer, salesman };
}

async function share(h: ReturnType<typeof makeDist>, sm: ReturnType<ReturnType<typeof makeDist>["tenant"]>["owner"], accuracy = 20) {
  const s = h.as(sm);
  await s.startSharing("test");
  return s.reportLocation({ ...LAHORE, accuracy, deviceAt: new Date().toISOString() });
}

// ── Tenant isolation ──
test("isolation: pharma A, pharma B, general C, general D each see only their own data", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const B = await distributor(h, "pB", "pharma");
  const C = await distributor(h, "gC", "general");
  const D = await distributor(h, "gD", "general");
  for (const X of [A, B, C, D]) {
    const s = h.as(X.owner);
    assert.deepEqual((await s.listProducts()).map((p) => p.id).sort(), [X.product.id, X.product2.id].sort());
    assert.deepEqual((await s.listCompanies()).map((c) => c.id), [X.company.id]);
    assert.deepEqual((await s.listCustomers()).map((c) => c.id), [X.customer.id]);
    assert.deepEqual((await s.listSalesmen()).map((c) => c.id), [X.salesman.id]);
  }
  // Same product name in two tenants still does not cross.
  const s = h.as(A.owner);
  assert.equal((await s.listProducts({ search: "Panadol" })).length, 1);
  assert.equal(await s.findProduct("pB-P1"), null);
  // Categories follow the mode.
  assert.ok((await h.as(A.owner).listCategories()).some((c) => c.name === "Tablets"));
  assert.ok((await h.as(C.owner).listCategories()).some((c) => c.name === "Beverages"));
  assert.ok(!(await h.as(C.owner).listCategories()).some((c) => c.name === "Tablets"));
});

test("isolation: changing ids cannot reach another distributor's records", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const B = await distributor(h, "pB", "pharma");
  const s = h.as(A.owner);
  await assert.rejects(() => s.getProduct(B.product.id), /Product not found/);
  await assert.rejects(() => s.getCompany(B.company.id), /Company not found/);
  await assert.rejects(() => s.getCustomer(B.customer.id), /Customer not found/);
  await assert.rejects(() => s.listProducts({ companyId: B.company.id }), /Company not found/);
  await assert.rejects(() => s.saveProduct({ company_id: B.company.id, code: "X", name: "X", trade_price: 1 }), /Company not found/);
  await assert.rejects(() => s.updateCustomer(B.customer.id, { owner_name: "x" }), /Customer not found/);
  await assert.rejects(() => s.salesmanLocation(B.salesman.id), /Salesman not found/);
  await assert.rejects(() => s.performance(B.salesman.id, month), /Salesman not found/);
  await assert.rejects(() => s.setTarget(B.salesman.id, month, 1), /Salesman not found/);
  await assert.rejects(() => s.createSale({ customerId: A.customer.id, lines: [{ productId: B.product.id, qty: 1 }] }), /Product not found/);
  await assert.rejects(() => s.createSale({ customerId: B.customer.id, lines: [{ productId: A.product.id, qty: 1 }] }), /Customer not found/);
  // B's invoice is invisible to A.
  const inv = await h.as(B.owner).createSale({ customerId: B.customer.id, lines: [{ productId: B.product.id, qty: 1 }] });
  await assert.rejects(() => h.as(A.owner).getDoc(inv.doc.id), /Document not found/);
  assert.equal((await h.as(A.owner).listDocs({ type: "sale" })).length, 0);
});

test("isolation: a salesman cannot book another tenant's customer or product; other business types are refused", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const B = await distributor(h, "pB", "pharma");
  const s = h.as(A.sm);
  await assert.rejects(() => s.createBooking({ customerId: B.customer.id, lines: [{ productId: A.product.id, qty: 1 }] }), /Customer not found/);
  await assert.rejects(() => s.createBooking({ customerId: A.customer.id, lines: [{ productId: B.product.id, qty: 1 }] }), /Product not found/);
  const pharmacy = h.tenant("ph1", "retail_pharmacy");
  await assert.rejects(() => h.as(pharmacy.owner).listProducts(), /not a Wholesaler/);
  await assert.rejects(() => h.as({ ...A.owner, tenantId: null }).listProducts(), /Sign in/);
});

// ── Customers ──
test("customers: general mode has no CDSL; pharma requires and validates CDSL", async () => {
  const h = makeDist();
  const C = await distributor(h, "gC", "general");
  const g = h.as(C.owner);
  const gc = await g.createCustomer({ business_name: "Kiryana", mobile: "0300-1112223", cdsl_no: "IGNORED", cdsl_expiry: "2030-01-01" });
  assert.equal(gc.cdsl_no, null);
  assert.equal(gc.code.startsWith("C-"), true);
  const A = await distributor(h, "pA", "pharma");
  const p = h.as(A.owner);
  await assert.rejects(() => p.createCustomer({ business_name: "Chemist", mobile: "03001112223" }), /CDSL number and CDSL expiry date are required/);
  await assert.rejects(() => p.createCustomer({ business_name: "Chemist", mobile: "03001112223", cdsl_no: "X", cdsl_expiry: "01/02/2030" }), /CDSL expiry must be a date/);
  await assert.rejects(() => p.createCustomer({ business_name: "Chemist", mobile: "12345" }), /Pakistani mobile/);
  await assert.rejects(() => p.createCustomer({ business_name: "Chemist", mobile: "03001112223", ntn: "12", cdsl_no: "X", cdsl_expiry: "2030-01-01" }), /NTN must be 7 digits/);
  const ok = await p.createCustomer({ business_name: "Chemist", mobile: "03001112223", cnic: "3520212345671", cdsl_no: "CD-9", cdsl_expiry: "2030-01-01" });
  assert.equal(ok.cnic, "35202-1234567-1");
  assert.equal(ok.atl_status, "unverified");
  assert.equal(cdslState("X", "2026-01-10", "2026-01-01", 30), "expiring");
  assert.equal(cdslState("X", "2025-12-31", "2026-01-01", 30), "expired");
});

test("customers: an expired CDSL blocks pharma sales and bookings", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const s = h.as(A.owner);
  await s.updateCustomer(A.customer.id, { cdsl_expiry: "2020-01-01" });
  await assert.rejects(() => s.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1 }] }), /CDSL expired/);
  assert.equal((await s.cdslAlerts()).find((c) => c.id === A.customer.id)?.cdsl_state, "expired");
});

test("customers: geotag captured and stored; invalid / fabricated (0,0) coordinates refused", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const s = h.as(A.owner);
  const c = await s.getCustomer(A.customer.id);
  assert.deepEqual([c.lat, c.lng, c.location_accuracy, c.location_source], [LAHORE.lat, LAHORE.lng, 15, "device"]);
  assert.ok(c.located_at);
  await assert.rejects(() => s.setCustomerLocation(A.customer.id, { lat: 0, lng: 0, source: "device" }), /not valid/);
  await assert.rejects(() => s.setCustomerLocation(A.customer.id, { lat: 95, lng: 10, source: "device" }), /not valid/);
  await s.setCustomerLocation(A.customer.id, { lat: 31.53, lng: 74.35, source: "manual_pin" });
  assert.equal((await s.getCustomer(A.customer.id)).location_source, "manual_pin");
  // Without location permission a customer is still created, just without a geotag.
  const noGeo = await s.createCustomer({ business_name: "No GPS", mobile: "03001112224", cdsl_no: "Y", cdsl_expiry: "2030-01-01", location: null });
  assert.equal(noGeo.lat, null);
  assert.ok((await s.listCustomers({ missingGeo: true })).some((x) => x.id === noGeo.id));
});

test("customers: salesmen add but cannot delete; only the admin deactivates/deletes; invoices survive", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const sm = h.as(A.sm);
  const mine = await sm.createCustomer({ business_name: "Field Shop", mobile: "03005556667", cdsl_no: "Z", cdsl_expiry: "2030-01-01" });
  assert.equal(mine.salesman_id, A.salesman.id);
  await assert.rejects(() => sm.deleteCustomer(mine.id, "x"), /Only the distributor administrator/);
  await assert.rejects(() => sm.setCustomerStatus(mine.id, "inactive", "x"), /Only the distributor administrator/);
  await assert.rejects(() => sm.updateCustomer(mine.id, { owner_name: "X" }), /permission/);
  // Admin grants edit of owner_name only.
  await h.as(A.owner).setPerms(A.sm.userId!, [...SALESMAN_PRESET, "customers.edit"], ["owner_name"]);
  await h.as(A.sm).updateCustomer(mine.id, { owner_name: "Usman" });
  await assert.rejects(() => h.as(A.sm).updateCustomer(mine.id, { ntn: "7654321" }), /may not change the customer's ntn/);
  await assert.rejects(() => h.as(A.sm).updateCustomer(mine.id, { status: "inactive" } as never), /Only the administrator/);
  // Other sub-users cannot delete either.
  const clerk = A.t.staff("clerk");
  await h.as(A.owner).setPerms(clerk.userId!, ["customers.view", "customers.edit"]);
  await assert.rejects(() => h.as(clerk).deleteCustomer(mine.id, "x"), /Only the distributor administrator/);
  // Admin: invoice, then delete -> invoice still there with its customer snapshot.
  const admin = h.as(A.owner);
  const inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1 }] });
  await assert.rejects(() => admin.deleteCustomer(A.customer.id, ""), /Give a reason/);
  await admin.deleteCustomer(A.customer.id, "closed business");
  const again = await admin.getDoc(inv.doc.id);
  assert.equal(again.doc.party_name, "pA Medical Store");
  assert.ok(!(await admin.listCustomers()).some((c) => c.id === A.customer.id));
  assert.ok((await admin.audits()).some((a: { action: string }) => a.action === "customer.delete"));
});

// ── Salesman location & bookings ──
test("location: sharing on/off; bookings need a live, fresh, accurate location", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const s = h.as(A.sm);
  const draft = await s.createBooking({ clientRef: "r1", customerId: A.customer.id, companyId: A.company.id, lines: [{ productId: A.product.id, qty: 10 }] });
  await assert.rejects(() => s.submitBooking(draft.booking.id), /Location sharing is off/);
  await s.startSharing("ua");
  await assert.rejects(() => s.submitBooking(draft.booking.id), /No location received yet/);
  await s.reportLocation({ ...LAHORE, accuracy: 500 });
  await assert.rejects(() => s.submitBooking(draft.booking.id), /accuracy is 500 m/);
  await s.reportLocation({ ...LAHORE, accuracy: 20 });
  agePoints(h.sql, A.salesman.id, 900);
  await assert.rejects(() => s.submitBooking(draft.booking.id), /s old \(limit 300 s\)/);
  await s.reportLocation({ ...LAHORE, accuracy: 20 });
  const sub = await s.submitBooking(draft.booking.id);
  assert.equal(sub.booking.status, "pending_approval");
  assert.equal(sub.booking.loc_lat, LAHORE.lat);
  assert.ok(sub.booking.loc_recorded_at);
  // Stopping sharing blocks new submissions; old bookings stay readable.
  await s.stopSharing();
  const d2 = await s.createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1 }] });
  await assert.rejects(() => s.submitBooking(d2.booking.id), /Location sharing is off/);
  assert.equal((await s.getBooking(draft.booking.id)).booking.status, "pending_approval");
  await assert.rejects(() => s.reportLocation({ ...LAHORE, accuracy: 10 }), /not active/);
});

test("location: implausible jumps and bad coordinates are rejected; admin sees live / stale / stopped correctly", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  await share(h, A.sm);
  const s = h.as(A.sm);
  await assert.rejects(() => s.reportLocation({ lat: 0, lng: 0, accuracy: 5 }), /Invalid coordinates/);
  const jump = await s.reportLocation({ lat: 24.8607, lng: 67.0011, accuracy: 5 }); // Karachi seconds later
  assert.match(String(jump.flag), /implausible jump/);
  const d = await s.createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1 }] });
  await assert.rejects(() => s.submitBooking(d.booking.id), /was rejected \(implausible jump/);
  const admin = h.as(A.owner);
  assert.equal((await admin.salesmanLocation(A.salesman.id)).state, "live");
  agePoints(h.sql, A.salesman.id, 3600);
  assert.equal((await admin.salesmanLocation(A.salesman.id)).state, "stale");
  await h.as(A.sm).stopSharing();
  assert.equal((await admin.salesmanLocation(A.salesman.id)).state, "stopped");
  assert.equal(liveState(null, null, new Date().toISOString(), 300), "never");
  // Location viewing needs the permission.
  const clerk = A.t.staff("clerk");
  await assert.rejects(() => h.as(clerk).salesmanLocation(A.salesman.id), /locations\.view/);
  await assert.rejects(() => h.as(clerk).liveMap(), /locations\.view/);
  // Only a salesman login can share.
  await assert.rejects(() => h.as(A.owner).startSharing(), /Only an active salesman/);
});

test("bookings: state machine, approval, duplicate submission, single conversion", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  await share(h, A.sm);
  const s = h.as(A.sm);
  const b1 = await s.createBooking({ clientRef: "same", customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 5 }] });
  const b1again = await s.createBooking({ clientRef: "same", customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 5 }] });
  assert.equal(b1again.booking.id, b1.booking.id, "repeated submission returns the same booking");
  await assert.rejects(() => s.decideBooking(b1.booking.id, "approved"), /permission/);
  await s.submitBooking(b1.booking.id);
  await assert.rejects(() => s.submitBooking(b1.booking.id), /Only a draft/);
  const admin = h.as(A.owner);
  await assert.rejects(() => admin.convertBooking(b1.booking.id), /Only an approved/);
  await admin.decideBooking(b1.booking.id, "approved");
  const inv = await admin.convertBooking(b1.booking.id);
  assert.equal(inv.doc.booking_id, b1.booking.id);
  assert.equal(inv.items[0].qty, 5);
  await assert.rejects(() => admin.convertBooking(b1.booking.id), /Only an approved/);
  const ev = (await admin.getBooking(b1.booking.id)).events.map((e: { to_status: string }) => e.to_status);
  assert.deepEqual(ev, ["draft", "pending_approval", "approved", "converted"]);
  // Rejection needs a reason; rejected bookings cannot move on.
  const b2 = await h.as(A.sm).createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1 }] });
  await h.as(A.sm).submitBooking(b2.booking.id);
  await assert.rejects(() => admin.decideBooking(b2.booking.id, "rejected"), /reason/);
  await admin.decideBooking(b2.booking.id, "rejected", "credit limit");
  await assert.rejects(() => admin.decideBooking(b2.booking.id, "approved"), /can't become approved/);
  // Salesman cannot change prices or give discounts without permission.
  await assert.rejects(() => h.as(A.sm).createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1, price: 1 }] }), /invoices\.edit_price/);
  await assert.rejects(() => h.as(A.sm).createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1, discount: 5 }] }), /invoices\.discount/);
});

test("bookings: salesmen only book products of their assigned companies", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  const other = await admin.saveCompany({ code: "OTH", name: "Other Co" });
  const op = await admin.saveProduct({ company_id: other.id, code: "OP1", name: "Other product", trade_price: 10, openingQty: 10 });
  await admin.saveSalesman({ ...A.salesman, companyIds: [A.company.id] });
  await assert.rejects(() => h.as(A.sm).createBooking({ customerId: A.customer.id, lines: [{ productId: op.id, qty: 1 }] }), /not assigned to you/);
  await assert.rejects(() => h.as(A.sm).createBooking({ customerId: A.customer.id, companyId: A.company.id, lines: [{ productId: op.id, qty: 1 }] }), /not a product of the selected company/);
});

// ── Targets ──
test("targets: metric drives achievement; conversion is not double counted; returns reduce net sales", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  await admin.setTarget(A.salesman.id, month, 10000);
  await assert.rejects(() => h.as(A.sm).setTarget(A.salesman.id, month, 1), /Only the distributor administrator/);
  await share(h, A.sm);
  const b = await h.as(A.sm).createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 30 }] }); // 3000
  await h.as(A.sm).submitBooking(b.booking.id);
  const draft = await h.as(A.sm).createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 99 }] }); // stays draft
  void draft;
  let p = await admin.performance(A.salesman.id, month);
  assert.equal(p.metric, "approved");
  assert.deepEqual([p.metrics.bookings, p.metrics.approved, p.progress.achieved], [3000, 0, 0], "pending is not approved; drafts never count");
  await admin.decideBooking(b.booking.id, "approved");
  const inv = await admin.convertBooking(b.booking.id);
  p = await admin.performance(A.salesman.id, month);
  assert.deepEqual([p.metrics.approved, p.metrics.invoiced, p.progress.achieved, p.progress.remaining, p.progress.pct], [3000, 3000, 3000, 7000, 30]);
  // Same figures in the salesman's own dashboard.
  const mine = await h.as(A.sm).performance(A.salesman.id, month);
  assert.deepEqual(mine.progress, p.progress);
  // Net sales metric subtracts returns.
  const cur = (await admin.config())!.settings;
  await admin.saveSettings({ ...cur, target: { ...cur.target, metric: "net_sales" } });
  await admin.createSaleReturn({ invoiceId: inv.doc.id, lines: [{ itemId: inv.items[0].id, qty: 10 }], reason: "expired" });
  p = await admin.performance(A.salesman.id, month);
  assert.deepEqual([p.metric, p.metrics.net_sales, p.progress.achieved], ["net_sales", 2000, 2000]);
  assert.equal(p.breakdowns.company[0].amount, 2000);
  // Other salesmen's targets need permission.
  const clerk = A.t.staff("clerk");
  await assert.rejects(() => h.as(clerk).performance(A.salesman.id, month), /targets\.view/);
  const tp = targetProgress(100, 100, "2026-01", "2026-01-10", 0.9);
  assert.equal(tp.status, "achieved");
  assert.equal(targetProgress(100, 10, "2026-01", "2026-01-31", 0.9).status, "below");
});

// ── Withholding tax ──
test("tax: ATL active / inactive / unverified / stale / no NTN follow the configured rates", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  // Unverified -> non-ATL 2.5 % (never treated as active).
  let inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }] }); // 1000
  assert.deepEqual([inv.doc.wht_status, inv.doc.wht_rate, inv.doc.wht_base, inv.doc.wht_amount, inv.doc.balance], ["unverified", 2.5, 1000, 25, 1025]);
  // Recorded ATL check: active -> 0.5 %.
  await admin.recordAtlCheck(A.customer.id, { result: "active", source: "FBR ATL portal", reference: "screenshot 1" });
  inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }] });
  assert.deepEqual([inv.doc.wht_status, inv.doc.wht_rate, inv.doc.wht_amount, inv.doc.wht_section], ["active", 0.5, 5, "236H"]);
  const snap = JSON.parse(inv.doc.tax_snapshot!);
  assert.equal(snap.atlSource, "FBR ATL portal");
  assert.equal(snap.ntn, "1234567");
  // Inactive -> 2.5 %.
  await admin.recordAtlCheck(A.customer.id, { result: "inactive", source: "SMS 9966" });
  inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }] });
  assert.deepEqual([inv.doc.wht_status, inv.doc.wht_rate], ["inactive", 2.5]);
  // A check older than the configured age counts as unverified.
  const old = new Date(Date.now() - 90 * 864e5).toISOString();
  await admin.recordAtlCheck(A.customer.id, { result: "active", source: "FBR ATL portal", checkedAt: old });
  inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }] });
  assert.deepEqual([inv.doc.wht_status, inv.doc.wht_rate], ["unverified", 2.5]);
  // 236G wholesaler class uses its own configured rates.
  await admin.recordAtlCheck(A.customer.id, { result: "active", source: "FBR ATL portal" });
  await admin.updateCustomer(A.customer.id, { tax_class: "wholesaler" });
  inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }] });
  assert.deepEqual([inv.doc.wht_section, inv.doc.wht_rate, inv.doc.wht_amount], ["236G", 0.1, 1]);
  // Changing the NTN resets ATL status to unverified.
  await admin.updateCustomer(A.customer.id, { ntn: "7654321" });
  assert.equal((await admin.getCustomer(A.customer.id)).atl_status, "unverified");
  // No identifier: non-ATL rate.
  const t = whtTreatment(DEFAULT_SETTINGS, { ntn: null, cnic: null, taxClass: "retailer", atlStatus: "active", atlCheckedAt: new Date().toISOString(), atlSource: "x" }, new Date().toISOString());
  assert.deepEqual([t.status, t.rate], ["no_identifier", 2.5]);
  assert.equal(normalizeNtn("1234567-8"), "1234567");
});

test("tax: base (incl / excl sales tax) and rounding follow settings; block policy stops unverified invoices", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  await admin.recordAtlCheck(A.customer.id, { result: "active", source: "FBR ATL portal" });
  // Brufen: 3 x 50 = 150 + 18 % ST = 177.
  let inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product2.id, qty: 3 }] });
  assert.deepEqual([inv.doc.total, inv.doc.sales_tax, inv.doc.wht_base, inv.doc.wht_amount], [177, 27, 177, 0.89]);
  const cur = (await admin.config())!.settings;
  await admin.saveSettings({ ...cur, wht: { ...cur.wht, base: "net_excl_sales_tax", rounding: "rupee" } });
  inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product2.id, qty: 3 }] });
  assert.deepEqual([inv.doc.wht_base, inv.doc.wht_amount], [150, 1]);
  await admin.saveSettings({ ...cur, wht: { ...cur.wht, unverifiedPolicy: "block" } });
  await admin.updateCustomer(A.customer.id, { ntn: "7654321" }); // now unverified
  await assert.rejects(() => admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1 }] }), /not verified/);
  // Rates are configurable, never silently replaced; invalid ones refused.
  await assert.rejects(() => admin.saveSettings({ ...cur, wht: { ...cur.wht, classes: { ...cur.wht.classes, retailer: { section: "236H", activeRate: -1, inactiveRate: 2.5 } } } }), /between 0 and 100/);
  await assert.rejects(() => h.as(A.sm).saveSettings(cur), /Only the distributor administrator/);
});

test("tax: verification service timeout / failure leaves the customer unverified", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  const none = await admin.verifyAtl(A.customer.id, null);
  assert.equal(none.ok, false);
  assert.match(String(none.ok ? "" : none.error), /No authoritative ATL verification service/);
  const slow = await admin.verifyAtl(A.customer.id, { name: "test-slow", check: () => new Promise((r) => setTimeout(() => r({ status: "active" }), 200)) }, 20);
  assert.equal(slow.ok, false);
  const failing = await admin.verifyAtl(A.customer.id, { name: "test-fail", check: async () => { throw new Error("HTTP 503"); } });
  assert.equal(failing.ok, false);
  assert.equal((await admin.getCustomer(A.customer.id)).atl_status, "unverified");
  const good = await admin.verifyAtl(A.customer.id, { name: "test-adapter", check: async () => ({ status: "active", reference: "R1" }) });
  assert.equal(good.ok, true);
  assert.equal((await admin.getCustomer(A.customer.id)).atl_source, "test-adapter");
  await assert.rejects(() => h.as(A.sm).recordAtlCheck(A.customer.id, { result: "active", source: "x" }), /customers\.verify/);
});

test("tax: overrides need the matching permission and a reason, and are audited; finalized invoices keep their snapshot", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const clerk = A.t.staff("clerk");
  const admin = h.as(A.owner);
  await admin.setPerms(clerk.userId!, ["invoices.view", "invoices.create"]);
  const c = h.as(clerk);
  await assert.rejects(() => c.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }], wht: { rate: 0.5, reason: "x" } }), /invoices\.edit_wht_rate/);
  await assert.rejects(() => c.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }], wht: { amount: 1, reason: "x" } }), /invoices\.edit_wht_amount/);
  await assert.rejects(() => c.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10, price: 90 }] }), /invoices\.edit_price/);
  await assert.rejects(() => c.createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }], wht: { base: "net_excl_sales_tax", reason: "x" } }), /invoices\.edit_tax_base/);
  await admin.setPerms(clerk.userId!, ["invoices.view", "invoices.create", "invoices.edit_wht_rate"]);
  await assert.rejects(() => h.as(clerk).createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }], wht: { rate: 0.5 } }), /reason/);
  const inv = await h.as(clerk).createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 10 }], wht: { rate: 0.5, reason: "ATL screenshot shown at counter" } });
  assert.deepEqual([inv.doc.wht_rate, inv.doc.wht_amount, inv.doc.wht_overridden], [0.5, 5, 1]);
  const snap = JSON.parse(inv.doc.tax_snapshot!);
  assert.deepEqual([snap.computedRate, snap.appliedRate, snap.overrideReason], [2.5, 0.5, "ATL screenshot shown at counter"]);
  const audit = (await admin.audits()).find((a: { action: string }) => a.action === "invoice.wht_override") as { old_value: string; new_value: string; user_name: string } | undefined;
  assert.ok(audit && JSON.parse(audit.old_value).rate === 2.5 && JSON.parse(audit.new_value).rate === 0.5 && audit.user_name === "clerk");
  // Later customer / settings changes do not touch the stored invoice.
  await admin.recordAtlCheck(A.customer.id, { result: "inactive", source: "SMS 9966" });
  const reread = await admin.getDoc(inv.doc.id);
  assert.equal(reread.doc.tax_snapshot, inv.doc.tax_snapshot);
  // There is no API to edit a finalized invoice: corrections go through a credit note.
  const cn = await admin.createSaleReturn({ invoiceId: inv.doc.id, lines: [{ itemId: inv.items[0].id, qty: 2 }], reason: "damaged" });
  assert.deepEqual([cn.doc.doc_type, cn.doc.wht_rate, cn.doc.wht_amount, cn.doc.ref_doc_id], ["sale_return", 0.5, 1, inv.doc.id]);
});

// ── Permissions ──
test("permissions: nothing by default; admin-only actions can't be granted; users can't grant themselves", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const fresh = A.t.staff("new");
  await assert.rejects(() => h.as(fresh).listCustomers(), /customers\.view/);
  await assert.rejects(() => h.as(fresh).listProducts(), /catalog\.view/);
  await assert.rejects(() => h.as(fresh).listDocs({ type: "purchase" }), /purchases\.view/);
  await assert.rejects(() => h.as(fresh).setPerms(fresh.userId!, ["customers.view"]), /Only the distributor administrator/);
  await assert.rejects(() => h.as(A.sm).setPerms(A.sm.userId!, ["bookings.approve"]), /Only the distributor administrator/);
  await assert.rejects(() => h.as(A.owner).setPerms(fresh.userId!, ["customers.delete"]), /administrator only/);
  await assert.rejects(() => h.as(A.owner).setPerms(A.owner.userId!, ["customers.view"]), /Only sub-user/);
  // Purchase field permissions are separate from invoice ones.
  await h.as(A.owner).setPerms(fresh.userId!, ["purchases.view", "purchases.create", "invoices.edit_price"]);
  const sup = h.sql.prepare(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('sup1', 'pA', 'Principal', 'x', 'x')`).run();
  void sup;
  await assert.rejects(() => h.as(fresh).createPurchase({ supplierId: "sup1", lines: [{ productId: A.product.id, qty: 5, cost: 70 }] }), /purchases\.edit_price/);
  await assert.rejects(() => h.as(fresh).createPurchase({ supplierId: "sup1", lines: [{ productId: A.product.id, qty: 5, cost: 80, taxRate: 18 }] }), /purchases\.edit_tax/);
  const pur = await h.as(fresh).createPurchase({ supplierId: "sup1", lines: [{ productId: A.product.id, qty: 5, cost: 80 }] });
  assert.equal(pur.doc.total, 400);
  assert.equal((await h.as(A.owner).getProduct(A.product.id)).stock, 1005);
  // Cost is hidden from users without purchase access.
  assert.equal((await h.as(A.sm).listProducts())[0].cost, 0);
  // Mode cannot change once data exists.
  await assert.rejects(() => h.as(A.owner).setup("general"), /can't change/);
});

test("stock: sales can't oversell; returns put stock back; purchase returns take it out", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  await assert.rejects(() => admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product2.id, qty: 101 }] }), /Only 100/);
  assert.equal((await admin.getProduct(A.product2.id)).stock, 100, "failed sale releases claimed stock");
  const inv = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product2.id, qty: 10 }] });
  assert.equal((await admin.getProduct(A.product2.id)).stock, 90);
  await admin.createSaleReturn({ invoiceId: inv.doc.id, lines: [{ itemId: inv.items[0].id, qty: 4 }], reason: "x" });
  assert.equal((await admin.getProduct(A.product2.id)).stock, 94);
  await assert.rejects(() => admin.createSaleReturn({ invoiceId: inv.doc.id, lines: [{ itemId: inv.items[0].id, qty: 7 }], reason: "x" }), /Only 6/);
  const bal = await admin.balances("customer");
  assert.ok(bal.find((b) => b.id === A.customer.id)!.balance > 0);
  h.sql.prepare(`INSERT INTO suppliers (id, tenant_id, name, created_at, updated_at) VALUES ('sup1', 'pA', 'Principal', 'x', 'x')`).run();
  const pur = await admin.createPurchase({ supplierId: "sup1", lines: [{ productId: A.product2.id, qty: 20, cost: 40 }] });
  assert.equal((await admin.getProduct(A.product2.id)).stock, 114);
  await admin.createPurchaseReturn({ purchaseId: pur.doc.id, lines: [{ itemId: pur.items[0].id, qty: 5 }], reason: "short expiry" });
  assert.equal((await admin.getProduct(A.product2.id)).stock, 109);
  assert.deepEqual((await admin.balances("supplier")).map((b) => b.balance), [600]);
});
