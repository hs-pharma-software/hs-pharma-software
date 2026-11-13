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

test("dashboard: month totals, margin, daily trend, top lists, WHT by section, low stock and every salesman's target", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  await admin.setTarget(A.salesman.id, month, 10000);
  await share(h, A.sm);
  const b = await h.as(A.sm).createBooking({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 30 }] }); // 3000 at trade price 100, cost 80
  await h.as(A.sm).submitBooking(b.booking.id);
  await admin.decideBooking(b.booking.id, "approved");
  const inv = await admin.convertBooking(b.booking.id);
  await admin.createSaleReturn({ invoiceId: inv.doc.id, lines: [{ itemId: inv.items[0].id, qty: 5 }], reason: "damaged" });
  await admin.saveProduct({ ...(await admin.getProduct(A.product2.id)), reorder_level: 500 });
  const d = await admin.dashboard(month);
  assert.equal(d.now.invoices, 1);
  assert.equal(d.now.net, 2500, "3000 sold, 500 returned");
  assert.equal(d.now.grossProfit, 500, "net 2500 less cost 2000 (25 × 80)");
  assert.equal(d.now.marginPct, 20);
  assert.equal(d.daily.length, 1);
  assert.equal(d.daily[0].amount, 2500);
  assert.equal(d.companies[0].amount, 2500);
  assert.equal(d.customers[0].label, "pA Medical Store");
  assert.equal(d.products[0].label, "pA Panadol 500");
  assert.ok(d.wht.every((w) => typeof w.rate === "number"), "each section shows its rate");
  assert.deepEqual(d.lowStock.map((p) => p.code), ["PA-P2"]);
  const t = d.targets.find((x) => x.id === A.salesman.id)!;
  assert.deepEqual([t.target, t.achieved, t.pct], [10000, 3000, 30], "approved bookings, the configured metric");
  assert.ok(d.receivable != null && d.receivable > 0);
  // Another business's dashboard never includes these.
  const B = await distributor(h, "pB", "general");
  assert.equal((await h.as(B.owner).dashboard(month)).now.net, 0);
  await assert.rejects(() => h.as(A.sm).dashboard(month), /reports\.view/);
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

// ── Line fields: batch, expiry, bonus, discount %, extra discount %, sales tax, W.T % ──
test("sale lines: discount % then extra % then rupees, bonus leaves stock unpaid, WHT shown per line and adds up", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  // 10 x Rs 100 = 1000; 10 % -> 900; extra 5 % of 900 -> 855; then Rs 5 -> 850. Bonus 2 free.
  const inv = await admin.createSale({ customerId: A.customer.id, lines: [
    { productId: A.product.id, qty: 10, discPct: 10, extraDiscPct: 5, discount: 5, bonusQty: 2, batchNo: "B-77", expiry: "2027-06-30" },
    { productId: A.product2.id, qty: 4 }, // 4 x 50 = 200, 18 % sales tax -> 236
  ] });
  const l1 = inv.items.find((i) => i.product_id === A.product.id)!, l2 = inv.items.find((i) => i.product_id === A.product2.id)!;
  assert.deepEqual([l1.qty, l1.bonus_qty, l1.disc_pct, l1.extra_disc_pct, l1.discount, l1.line_total, l1.batch_no, l1.expiry], [10, 2, 10, 5, 150, 850, "B-77", "2027-06-30"]);
  assert.equal(l2.line_total, 236);
  assert.equal(l1.wht_rate, inv.doc.wht_rate, "each line shows the invoice's rate");
  assert.equal(Math.round((l1.wht_amount + l2.wht_amount) * 100), Math.round(inv.doc.wht_amount * 100), "line shares add up to the invoice's withholding tax");
  assert.equal((await admin.getProduct(A.product.id)).stock, 988, "12 left the shelf: 10 sold + 2 bonus");
  // Bonus and discounts need their own permissions.
  const clerk = A.t.staff("clerk");
  await admin.setPerms(clerk.userId!, ["invoices.view", "invoices.create", "invoices.discount"]);
  await assert.rejects(() => h.as(clerk).createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1, bonusQty: 1 }] }), /invoices\.bonus/);
  await admin.setPerms(clerk.userId!, ["invoices.view", "invoices.create"]);
  await assert.rejects(() => h.as(clerk).createSale({ customerId: A.customer.id, lines: [{ productId: A.product.id, qty: 1, discPct: 5 }] }), /invoices\.discount/);
  // Not enough for the bonus: refused, nothing taken.
  await assert.rejects(() => admin.createSale({ customerId: A.customer.id, lines: [{ productId: A.product2.id, qty: 90, bonusQty: 20 }] }), /bonus included/);
  assert.equal((await admin.getProduct(A.product2.id)).stock, 96);
});

test("purchase lines: bonus adds stock and lowers the true cost; supplier WHT adds to what is owed; last purchase rate", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  assert.deepEqual(await admin.lastPurchaseRates(A.product2.id, A.company.id), { any: null, supplier: null }, "never bought yet");
  // 100 x Rs 40 = 4000; 5 % -> 3800; extra 2 % -> 3724; 18 % sales tax -> 4394.32; + 10 bonus; 0.1 % WHT (236G) on it.
  const pur = await admin.createPurchase({ supplierId: A.company.id, supplierInvoiceNo: "INV-9", whtRate: 0.1, lines: [
    { productId: A.product2.id, qty: 100, cost: 40, discPct: 5, extraDiscPct: 2, taxRate: 18, bonusQty: 10, batchNo: "PB-1", expiry: "2028-01-31" },
  ] });
  const it = pur.items[0];
  assert.deepEqual([it.qty, it.bonus_qty, it.discount, it.line_total, it.batch_no], [100, 10, 276, 4394.32, "PB-1"]);
  assert.deepEqual([pur.doc.wht_section, pur.doc.wht_rate], ["236G", 0.1]);
  assert.ok(pur.doc.wht_amount > 0);
  assert.equal(pur.doc.balance, Math.round((4394.32 + pur.doc.wht_amount) * 100) / 100, "owed: the bill plus the supplier's withholding tax");
  const p = await admin.getProduct(A.product2.id);
  assert.equal(p.stock, 210, "100 old + 100 bought + 10 bonus");
  // True cost of the 110 received: 3724 / 110 = 33.85 each; average with 100 old ones at 40.
  assert.equal(Math.round(p.avg_cost * 100) / 100, Math.round(((100 * 40 + 3724) / 210) * 100) / 100);
  const last = await admin.lastPurchaseRates(A.product2.id, A.company.id);
  assert.deepEqual([last.any?.price, last.any?.disc_pct, last.any?.bonus_qty, last.supplier?.price], [40, 5, 10, 40]);
  assert.equal((await admin.lastPurchaseRates(A.product2.id, "another-co")).supplier, null);
});

// ── Products: narcotics (Form-9 CDSL only), CSV import ──
test("narcotics: a controlled generic is detected; only customers with a valid CDSL (Form-9) can buy or book it", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  const tram = await admin.saveProduct({ company_id: A.company.id, code: "TRM50", name: "Tramal 50", generic_name: "Tramadol HCl", trade_price: 60, cost: 50, openingQty: 100 });
  assert.equal(tram.is_narcotic, 1, "detected from the generic name");
  assert.equal((await admin.saveProduct({ ...tram, is_narcotic: 0 })).is_narcotic, 1, "can't be unmarked while the generic is controlled");
  assert.equal(A.product.is_narcotic, 0);
  // A customer without CDSL (allowed for ordinary medicines when CDSL is optional).
  const cur = (await admin.config())!.settings;
  await admin.saveSettings({ ...cur, cdsl: { ...cur.cdsl, required: false } });
  const noLicence = await admin.createCustomer({ business_name: "Corner Store", mobile: "03009998877", address: "Lahore", location: { lat: 31.52, lng: 74.35, accuracy: 15, source: "device" } });
  await admin.createSale({ customerId: noLicence.id, lines: [{ productId: A.product.id, qty: 1 }] });
  await assert.rejects(() => admin.createSale({ customerId: noLicence.id, lines: [{ productId: tram.id, qty: 1 }] }), /Form-9/);
  // An expired licence: refused too; a valid one: sold.
  await admin.updateCustomer(A.customer.id, { cdsl_expiry: "2020-01-01" });
  await assert.rejects(() => admin.createSale({ customerId: A.customer.id, lines: [{ productId: tram.id, qty: 1 }] }), /Form-9|expired/);
  await admin.updateCustomer(A.customer.id, { cdsl_expiry: "2030-01-01" });
  const ok = await admin.createSale({ customerId: A.customer.id, lines: [{ productId: tram.id, qty: 1 }] });
  assert.equal(ok.items[0].qty, 1);
  // General distributors: no CDSL, no narcotic marking.
  const G = await distributor(h, "gC", "general");
  const g = await h.as(G.owner).saveProduct({ company_id: G.company.id, code: "X1", name: "Codeine syrup (not pharma mode)", generic_name: "Codeine", trade_price: 10 });
  assert.equal(g.is_narcotic, 0);
});

test("products CSV import: off until the Super Admin switches it on; updates by code, creates the rest, reports bad rows", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const rows: Record<string, string>[] = [
    { code: "pA-P1", name: "pA Panadol 500", company: "pA Pharma Co", trade_price: "110" },
    { Code: "NEW1", Name: "Brand New Tab", Company: "Fresh Labs", Category: "Brand New Category", "Trade Price": "25", Generic_Name: "Alprazolam", "Opening Qty": "40" },
    { code: "BAD1", name: "No price", company: "Fresh Labs" },
  ];
  await assert.rejects(() => h.as(A.owner).importProducts(rows), /not switched on/);
  const on = h.as({ ...A.owner, deniedActions: ["+products.csv"] });
  const r = await on.importProducts(rows);
  assert.deepEqual([r.created, r.updated], [1, 1]);
  assert.deepEqual(r.errors.map((e) => [e.row, e.code]), [[4, "BAD1"]]);
  assert.match(r.errors[0].message, /Trade price/);
  assert.equal((await on.getProduct(A.product.id)).trade_price, 110);
  const fresh = (await on.listProducts({ search: "Brand New" }))[0];
  assert.deepEqual([fresh.stock, fresh.is_narcotic, fresh.company_name, fresh.category_name], [40, 1, "Fresh Labs", "Brand New Category"]);
  // Without catalogue rights the switch is not enough.
  const clerk = A.t.staff("clerk");
  await assert.rejects(() => h.as({ ...clerk, deniedActions: ["+products.csv"] }).importProducts(rows), /catalog\.manage/);
});

// ── Salesmen: wages, salaries, month closing, leaving ──
test("salaries: monthly pro-rated, daily by days worked; paid / unpaid; draft writes nothing; closing posts expenses and locks the month", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  const M = "2026-09"; // 30 days, already over
  const monthly = await admin.saveSalesman({ code: "S-M", name: "Monthly Man", mobile: "03021234567", wage_type: "monthly", wage_amount: 30000, joined_on: "2026-09-11" });
  const daily = await admin.saveSalesman({ code: "S-D", name: "Daily Man", mobile: "03031234567", wage_type: "daily", wage_amount: 1000, joined_on: "2026-08-01" });
  let rows = await admin.salaries(M);
  const get = (id: string) => rows.find((r) => r.salesman_id === id)!;
  assert.deepEqual([get(monthly.id).days_employed, get(monthly.id).amount], [20, 20000], "joined on the 11th: 20 of 30 days");
  assert.deepEqual([get(daily.id).days_worked, get(daily.id).amount], [30, 30000]);
  assert.ok(!rows.some((r) => r.salesman_id === A.salesman.id), "no wage set: not listed");
  await admin.saveSalary(daily.id, M, { daysWorked: 26 });
  await admin.setSalaryPaid(monthly.id, M, { method: "bank", date: "2026-10-01" });
  rows = await admin.salaries(M);
  assert.deepEqual([get(daily.id).amount, get(monthly.id).status, get(monthly.id).paid_method], [26000, "paid", "bank"]);
  const status = await admin.monthStatus(M);
  assert.deepEqual([status.closed, status.due, status.lastDay], [false, true, "2026-09-30"]);
  // Draft: the report, nothing written.
  const expenses = () => h.sql.prepare(`SELECT * FROM expenses WHERE tenant_id = 'pA' AND deleted_at IS NULL`).all() as { amount: number; payment_method: string; category_id: string; date: string }[];
  const draft = await admin.closeMonth(M, { final: false });
  assert.deepEqual([draft.draft, draft.salariesTotal, draft.salariesPaid, draft.salariesUnpaid, draft.salaries.length], [true, 46000, 20000, 26000, 2]);
  assert.equal(expenses().length, 0);
  // Final: one expense per salary under "Salaries", the month locked, the report kept.
  const fin = await admin.closeMonth(M, { final: true });
  assert.equal(fin.draft, false);
  const ex = expenses();
  assert.deepEqual(ex.map((e) => e.amount).sort(), [20000, 26000]);
  assert.deepEqual([...new Set(ex.map((e) => e.date))], ["2026-09-30"]);
  assert.deepEqual(ex.map((e) => e.payment_method).sort(), ["bank", "unpaid"]);
  const cat = h.sql.prepare(`SELECT name FROM expense_categories WHERE id = ?`).get(ex[0].category_id) as { name: string };
  assert.equal(cat.name, "Salaries");
  assert.equal((await admin.monthStatus(M)).closed, true);
  await assert.rejects(() => admin.saveSalary(daily.id, M, { daysWorked: 20 }), /closed/);
  await assert.rejects(() => admin.closeMonth(M, { final: true }), /already closed/);
  assert.equal((await admin.closeMonth(M, { final: false })).salariesTotal, 46000, "the kept report");
  // Paying after closing updates the expense's payment method too.
  await admin.setSalaryPaid(daily.id, M, { method: "cash" });
  assert.deepEqual(expenses().map((e) => e.payment_method).sort(), ["bank", "cash"]);
  // A month not yet over can't be closed; staff can't see salaries.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5)), 0)).toISOString().slice(0, 10);
  if (new Date().toISOString().slice(0, 10) < lastDay) await assert.rejects(() => admin.closeMonth(thisMonth, { final: true }), /from its last day/);
  await assert.rejects(() => h.as(A.sm).salaries(M), /administrator/);
});

test("leaving: a salesman's account closes with a reason; the last month is pro-rated; the career report covers every month", async () => {
  const h = makeDist();
  const A = await distributor(h, "pA", "pharma");
  const admin = h.as(A.owner);
  const s = await admin.saveSalesman({ code: "S-X", name: "Leaving Man", mobile: "03041234567", wage_type: "daily", wage_amount: 800, joined_on: "2026-09-01", monthly_target: 5000 });
  await assert.rejects(() => admin.closeSalesman(s.id, { date: "2026-10-15", reason: "" }), /reason/);
  const closed = await admin.closeSalesman(s.id, { date: "2026-10-15", reason: "Left for another distributor" });
  assert.deepEqual([closed.closed_on, closed.is_active, closed.close_reason], ["2026-10-15", 0, "Left for another distributor"]);
  await assert.rejects(() => admin.closeSalesman(s.id, { reason: "again" }), /already closed/);
  assert.equal((await admin.salaries("2026-10")).find((r) => r.salesman_id === s.id)!.days_worked, 15, "until the closing date");
  assert.equal((await admin.salaries("2026-11")).find((r) => r.salesman_id === s.id), undefined, "no salary after leaving");
  const career = await admin.salesmanCareer(s.id);
  assert.deepEqual(career.months.map((m) => m.month), ["2026-10", "2026-09"]);
  assert.equal(career.totals.months, 2);
  assert.equal(career.months[0].target, 5000);
  // Editing does not reopen a closed account.
  assert.equal((await admin.saveSalesman({ ...closed, is_active: 1 })).is_active, 0);
});
