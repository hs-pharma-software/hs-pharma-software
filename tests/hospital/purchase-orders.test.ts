/** Purchase Cell > Purchase Orders and the vendor portal (schema v109):
 * requests for rates (petty purchase / quotation), vendor logins, quotes that
 * only their vendor sees, the comparison and purchase orders, the vendor's
 * invoice forwarded to the stores, and the payment status the vendor sees. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { usersRepo } from "@/lib/repo/users";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { saveVendor } from "@/lib/repo/vendors";
import { storeArrivals, verifyStoreItems } from "@/lib/repo/hospitalStores";
import { payVendorBill } from "@/lib/repo/vendorPayments";
import {
  cancelPurchaseOrder, createRfq, forwardVendorInvoice, getRfq, issuePurchaseOrders, listPurchaseOrders, listRfqs, listVendorInvoices, lowestBids, returnVendorInvoice,
} from "@/lib/repo/purchaseOrders";
import { vendorAction, vendorActorFor, vendorLoginAction, type VendorActor } from "@/server/vendorPortal";
import { refuseVendor, HttpError } from "@/server/db";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { pagesForStaff } from "@/config/hospitalStaff";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: H, name: "City Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const owner: Caller = { userId: "owner", role: "owner", tenantId: H, permissions: null };
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  const uid = `user-${staff.id}`;
  if (!(await usersRepo.get(uid))) {
    db.prepare(`INSERT INTO users (id, tenant_id, username, display_name, role, password_hash, password_salt, is_active, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, 'staff', 'x', 'x', 1, ?, 'x', 'x')`)
      .run(uid, H, uid, staff.name, JSON.stringify(pagesForStaff(staff)));
    await staffRepo.update(staff.id, { user_id: uid } as Partial<Staff>);
  }
  useAuthStore.setState({ currentUser: { id: uid, username: uid, displayName: staff.name, role: "staff", tenantId: H, permissions: pagesForStaff(staff) }, currentTenant: tenant });
}

beforeEach(() => {
  db = fullSchemaDb();
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, 'City Hospital', 'hospital', 'x', 'x')`).run(H);
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES ('shop', 'Corner Shop', 'general_store', 'x', 'x')`).run();
  setTestDb(db);
  asOwner();
});

/** A vendor login made by the owner, and the portal actor it signs in as. */
async function portalLogin(vendorId: string, username: string): Promise<VendorActor> {
  const sql = sqliteSql(db);
  const r = (await vendorLoginAction(sql, owner, { action: "create", vendorId, username, password: "secret1" })) as { userId: string };
  return vendorActorFor(sql, { userId: r.userId, platformRole: "vendor" });
}
const portal = (a: VendorActor, body: Record<string, unknown>) => vendorAction(sqliteSql(db), a, body);

async function setup() {
  const officer = await saveHospitalStaff(null, { name: "Kamran", staff_category: "purchase_officer", basic_pay: 0 });
  const keeper = await saveHospitalStaff(null, { name: "Rashid", staff_category: "store_keeper", basic_pay: 0, stores: JSON.stringify(["stationery", "general"]) });
  const ali = await saveVendor(null, { name: "Ali Traders" });
  const asim = await saveVendor(null, { name: "Asim & Sons" });
  const afzal = await saveVendor(null, { name: "Afzal Stationers" });
  return { officer, keeper, ali, asim, afzal, aliP: await portalLogin(ali.id, "ali"), asimP: await portalLogin(asim.id, "asim"), afzalP: await portalLogin(afzal.id, "afzal") };
}
const items = [
  { productName: "A4 paper 80 gsm", specification: "500 sheets per ream", qty: 20, uom: "Ream", store: "stationery" as const },
  { productName: "Floor cleaner", qty: 10, uom: "Litre" },
];

test("one vendor asked is a petty purchase, several a quotation; a request needs vendors and products", async () => {
  const s = await setup();
  await as(s.officer);
  const petty = await createRfq({ vendorIds: [s.ali.id], items });
  const quote = await createRfq({ vendorIds: [s.ali.id, s.asim.id, s.afzal.id], items, title: "Stationery" });
  assert.equal(petty.kind, "petty");
  assert.equal(quote.kind, "quotation");
  assert.deepEqual([petty.rfq_no, quote.rfq_no], ["RFQ-0001", "RFQ-0002"]);
  await assert.rejects(createRfq({ vendorIds: [], items }), /at least one vendor/);
  await assert.rejects(createRfq({ vendorIds: [s.ali.id], items: [] }), /at least one product/);
  await assert.rejects(createRfq({ vendorIds: [s.ali.id], items: [{ productName: "Pens", qty: 0 }] }), /quantity of Pens/);
  const rows = await listRfqs({ search: "Asim" });
  assert.deepEqual(rows.map((r) => r.rfq_no), ["RFQ-0002"]);
  // Only the purchase officer (or the administrator) sends requests.
  await as(s.keeper);
  await assert.rejects(createRfq({ vendorIds: [s.ali.id], items }), /purchase officer/);
});

test("vendor logins: made by the owner or the Purchase Cell, once per vendor, only for hospitals", async () => {
  const sql = sqliteSql(db);
  const v = await saveVendor(null, { name: "Bilal Surgical" });
  await vendorLoginAction(sql, owner, { action: "create", vendorId: v.id, username: "bilal", password: "secret1" });
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: v.id, username: "bilal2", password: "secret1" }), /already has a login/);
  const other = await saveVendor(null, { name: "Other" });
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: other.id, username: "bilal", password: "secret1" }), /already taken/);
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: other.id, username: "x y", password: "secret1" }), /Username/);
  await assert.rejects(vendorLoginAction(sql, owner, { action: "create", vendorId: other.id, username: "other", password: "123" }), /at least 6/);
  // A nurse's login cannot; a login with the Purchase Cell section can.
  await assert.rejects(vendorLoginAction(sql, { ...owner, userId: "n", role: "staff", permissions: ["hospital_ipd"] }, { action: "list" }), /Purchase Cell/);
  const list = (await vendorLoginAction(sql, { ...owner, userId: "p", role: "staff", permissions: ["hospital_purchase_cell"] }, { action: "list" })) as { vendorName: string; username: string | null }[];
  assert.deepEqual(list.map((r) => [r.vendorName, r.username]), [["Bilal Surgical", "bilal"], ["Other", null]]);
  // Not a hospital: no vendor portal.
  await assert.rejects(vendorLoginAction(sql, { ...owner, tenantId: "shop" }, { action: "list" }), /for hospitals/);
  // The login is a vendor row: no sections; turned off, it can no longer sign in to the portal.
  const u = db.prepare(`SELECT role, platform_role, permissions FROM users WHERE username = 'bilal'`).get() as Record<string, unknown>;
  assert.deepEqual([u.role, u.platform_role, u.permissions], ["staff", "vendor", "[]"]);
  await vendorLoginAction(sql, owner, { action: "active", vendorId: v.id, active: false });
  const uid = String((db.prepare(`SELECT id FROM users WHERE username = 'bilal'`).get() as { id: string }).id);
  await assert.rejects(vendorActorFor(sql, { userId: uid, platformRole: "vendor" }), /not linked/);
  await assert.rejects(vendorActorFor(sql, { userId: uid }), /for vendor logins/);
});

test("each vendor sees only the requests sent to them and only their own rates", async () => {
  const s = await setup();
  await as(s.officer);
  const petty = await createRfq({ vendorIds: [s.ali.id], items });
  const quote = await createRfq({ vendorIds: [s.ali.id, s.asim.id], items, dueDate: "2999-12-31" });
  const aliSees = (await portal(s.aliP, { action: "requests" })) as { rfqNo: string; kindLabel: string; canQuote: boolean }[];
  assert.deepEqual(aliSees.map((r) => [r.rfqNo, r.kindLabel, r.canQuote]).sort(), [["RFQ-0001", "Petty purchase", true], ["RFQ-0002", "Quotation", true]]);
  assert.deepEqual(((await portal(s.asimP, { action: "requests" })) as { rfqNo: string }[]).map((r) => r.rfqNo), ["RFQ-0002"]);
  assert.deepEqual(await portal(s.afzalP, { action: "requests" }), []);
  // A request not sent to Afzal does not exist for him.
  await assert.rejects(portal(s.afzalP, { action: "quote", rfqId: quote.id, lines: [] }), /not found/);

  const d = (await getRfq(quote.id))!;
  const [paper, cleaner] = d.items;
  await assert.rejects(portal(s.aliP, { action: "quote", rfqId: quote.id, lines: [{ itemId: paper.id, rate: 950 }] }), /Floor cleaner/);
  await assert.rejects(portal(s.aliP, { action: "quote", rfqId: quote.id, lines: [{ itemId: paper.id, rate: 0 }, { itemId: cleaner.id, available: false }] }), /A4 paper/);
  await portal(s.aliP, { action: "quote", rfqId: quote.id, deliveryDays: 3, lines: [{ itemId: paper.id, rate: 950, offeredSpec: "Double A" }, { itemId: cleaner.id, rate: 420 }] });
  await portal(s.asimP, { action: "quote", rfqId: quote.id, remarks: "GST included", lines: [{ itemId: paper.id, rate: 900 }, { itemId: cleaner.id, available: false }] });
  // Sent again while open, Ali's rates replace the earlier ones.
  await portal(s.aliP, { action: "quote", rfqId: quote.id, deliveryDays: 2, lines: [{ itemId: paper.id, rate: 940, offeredSpec: "Double A" }, { itemId: cleaner.id, rate: 420 }] });
  const aliView = ((await portal(s.aliP, { action: "requests" })) as { id: string; myStatus: string; items: { rate: number | null }[] }[]).find((r) => r.id === quote.id)!;
  assert.equal(aliView.myStatus, "quoted");
  assert.deepEqual(aliView.items.map((i) => i.rate), [940, 420], "Ali sees his own rates, never Asim's 900");
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM hospital_rfq_quotes WHERE vendor_id = ? AND deleted_at IS NULL`).get(s.ali.id) as { n: number }).n, 2);
  // Afzal (not asked) cannot decline either; Ali declines the petty purchase.
  await portal(s.aliP, { action: "decline", rfqId: petty.id, reason: "Out of stock" });
  assert.equal(((await getRfq(petty.id))!.vendors[0]).status, "declined");
});

test("comparison: lowest rate per item, one purchase order per chosen vendor; the request then closes", async () => {
  const s = await setup();
  await as(s.officer);
  const r = await createRfq({ vendorIds: [s.ali.id, s.asim.id, s.afzal.id], items });
  const [paper, cleaner] = (await getRfq(r.id))!.items;
  await portal(s.aliP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 950 }, { itemId: cleaner.id, rate: 420 }] });
  await portal(s.asimP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 900 }, { itemId: cleaner.id, available: false }] });
  const d = (await getRfq(r.id))!;
  assert.deepEqual(lowestBids(d), { [paper.id]: s.asim.id, [cleaner.id]: s.ali.id });
  // Afzal did not quote: he cannot be chosen.
  await assert.rejects(issuePurchaseOrders(r.id, { [paper.id]: s.afzal.id }), /has not quoted/);
  await assert.rejects(issuePurchaseOrders(r.id, {}), /at least one item/);
  const pos = await issuePurchaseOrders(r.id, lowestBids(d), { note: "Deliver to the main store" });
  assert.deepEqual(pos.map((p) => [p.po_no, p.total]).sort(), [["PO-0001", 18000], ["PO-0002", 4200]].sort());
  const after = (await getRfq(r.id))!;
  assert.equal(after.rfq.status, "awarded");
  assert.deepEqual(Object.fromEntries(after.vendors.map((v) => [v.vendor_name, v.status])), { "Ali Traders": "awarded", "Asim & Sons": "awarded", "Afzal Stationers": "not_awarded" });
  await assert.rejects(issuePurchaseOrders(r.id, lowestBids(d)), /already issued/);
  // Closed: no more rates; each vendor sees only their own order.
  await assert.rejects(portal(s.afzalP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 1 }, { itemId: cleaner.id, rate: 1 }] }), /closed/);
  const asimOrders = (await portal(s.asimP, { action: "orders" })) as { poNo: string; total: number; items: { productName: string; rate: number }[]; kindLabel: string }[];
  assert.equal(asimOrders.length, 1);
  assert.equal(asimOrders[0].total, 18000);
  assert.deepEqual(asimOrders[0].items.map((i) => [i.productName, i.rate]), [["A4 paper 80 gsm", 900]]);
  assert.equal(asimOrders[0].kindLabel, "Quotation");
  assert.deepEqual(await portal(s.afzalP, { action: "orders" }), []);
  assert.equal((await listPurchaseOrders({ search: "Floor" })).length, 1);
});

test("invoice: the vendor submits it, the Purchase Cell forwards it to the store, the store verifies, Finance pays; the vendor follows each step", async () => {
  const s = await setup();
  await as(s.officer);
  const r = await createRfq({ vendorIds: [s.ali.id], items });
  const [paper, cleaner] = (await getRfq(r.id))!.items;
  await portal(s.aliP, { action: "quote", rfqId: r.id, lines: [{ itemId: paper.id, rate: 950 }, { itemId: cleaner.id, rate: 420 }] });
  const [po] = await issuePurchaseOrders(r.id, lowestBids((await getRfq(r.id))!));
  const stage = async () => ((await portal(s.aliP, { action: "payments" })) as { stage: string; paid: number; balance: number; canSubmitInvoice: boolean; payments: unknown[] }[])[0];
  assert.equal((await stage()).stage, "not_invoiced");

  await assert.rejects(portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "", invoiceDate: "2026-11-20" }), /invoice number/);
  await assert.rejects(portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-9", invoiceDate: "2999-01-01" }), /future/);
  await portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-7", invoiceDate: "2026-11-20", note: "Delivered" });
  await assert.rejects(portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-8", invoiceDate: "2026-11-20" }), /already with the hospital/);
  assert.equal((await stage()).stage, "with_purchase_cell");
  // An invoiced order is not cancelled any more.
  await assert.rejects(cancelPurchaseOrder(po.id, "x"), /return the invoice first/);

  // Returned with a reason: the vendor sees it and submits again.
  const [inv1] = await listVendorInvoices();
  await returnVendorInvoice(inv1.id, "Wrong amount");
  const back = (await portal(s.aliP, { action: "payments" })) as { stage: string; canSubmitInvoice: boolean; invoice: { returnReason: string } }[];
  assert.deepEqual([back[0].stage, back[0].canSubmitInvoice, back[0].invoice.returnReason], ["returned_to_vendor", true, "Wrong amount"]);
  await portal(s.aliP, { action: "submitInvoice", poId: po.id, invoiceNo: "INV-7A", invoiceDate: "2026-11-21" });

  // Forwarded: every item needs its store (paper's came from the request).
  const [inv] = await listVendorInvoices();
  assert.equal(inv.invoice_no, "INV-7A");
  await assert.rejects(forwardVendorInvoice(inv.id, {}), /store for Floor cleaner/);
  const poItems = db.prepare(`SELECT id, product_name FROM hospital_po_items WHERE po_id = ?`).all(po.id) as { id: string; product_name: string }[];
  const cleanerLine = poItems.find((i) => i.product_name === "Floor cleaner")!;
  const fw = await forwardVendorInvoice(inv.id, { [cleanerLine.id]: "general" });
  assert.equal(fw.status, "forwarded");
  assert.equal((await stage()).stage, "with_store");
  const sp = db.prepare(`SELECT status, total, vendor_invoice_no FROM hospital_store_purchases WHERE id = ?`).get(fw.store_purchase_id!) as Record<string, unknown>;
  assert.deepEqual([sp.status, sp.total, sp.vendor_invoice_no], ["posted", 23200, "INV-7A"]);

  // The store keeper verifies both stores' items: with Finance, unpaid.
  await as(s.keeper);
  for (const store of ["stationery", "general"] as const) {
    const arrival = (await storeArrivals(store)).find((a) => a.purchase.id === fw.store_purchase_id)!;
    await verifyStoreItems(arrival.purchase.id, store, Object.fromEntries(arrival.items.map((i) => [i.id, i.qty])));
  }
  assert.equal((await stage()).stage, "unpaid");
  // Finance pays part, then the rest.
  asOwner();
  await payVendorBill({ docType: "store_purchase", docId: fw.store_purchase_id!, amount: 10000, method: "bank", reference: "TRX-1" });
  let st = await stage();
  assert.deepEqual([st.stage, st.paid, st.balance, st.payments.length], ["part_paid", 10000, 13200, 1]);
  await payVendorBill({ docType: "store_purchase", docId: fw.store_purchase_id!, full: true, method: "cheque", reference: "CHQ-5" });
  st = await stage();
  assert.deepEqual([st.stage, st.balance, st.payments.length, st.canSubmitInvoice], ["paid", 0, 2, false]);
});

test("the server keeps vendor logins to the portal and vendors' rates to the vendors", () => {
  // A vendor login is refused on every route that does not allow it.
  assert.throws(() => refuseVendor("vendor"), (e: unknown) => e instanceof HttpError && e.status === 403);
  refuseVendor("vendor", true);
  refuseVendor(null);
  const known = new Set(["hospital_rfq_quotes", "hospital_rfqs", "vendor_portal_logins", "users"]);
  const staff: Caller = { userId: "p", role: "staff", tenantId: H, permissions: ["hospital_purchase_cell"] };
  const check = (sql: string, c: Caller = staff) => authorize(analyzeSql(sql), c, known);
  assert.equal(check(`SELECT * FROM hospital_rfq_quotes WHERE rfq_id = ?`).ok, true, "the hospital reads the rates");
  assert.equal(check(`UPDATE hospital_rfq_quotes SET rate = 1 WHERE id = ?`).ok, false, "but cannot change what a vendor quoted");
  assert.equal(check(`INSERT INTO hospital_rfq_quotes (id) VALUES (?)`, owner).ok, false);
  assert.equal(check(`UPDATE hospital_rfqs SET status = 'open' WHERE id = ?`).ok, true);
  assert.equal(check(`SELECT * FROM vendor_portal_logins`, owner).ok, false, "which supplier a login is: server only");
});
