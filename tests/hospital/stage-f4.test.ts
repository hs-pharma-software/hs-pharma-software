/** Hospital F4: indent books, indents (issue, receipt, returns), each
 * store's dashboard, stock register and dead stock register. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { usersRepo } from "@/lib/repo/users";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { saveVendor } from "@/lib/repo/vendors";
import { deadStockRegister, postStorePurchase, recordDeadStock, saveStorePurchase, storeArrivals, storeDashboard, storeRegister, storeStock, verifyStoreItems } from "@/lib/repo/hospitalStores";
import { createIndent, decideIndentReturn, issueIndent, issueIndentBook, myIndents, receiveIndent, requestIndentBook, returnIndentItems, storeIndents } from "@/lib/repo/storeIndents";
import { pagesForStaff } from "@/config/hospitalStaff";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
let db: DatabaseSync;
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
/** A staff login with its designation's pages (a real users row, so permissions can change). */
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
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, 'Hospital', 'hospital', 'x', 'x')`).run(H);
  setTestDb(db);
  asOwner();
});

async function stocked() {
  const officer = await saveHospitalStaff(null, { name: "Kamran", staff_category: "purchase_officer", basic_pay: 0 });
  const keeper = await saveHospitalStaff(null, { name: "Rashid", staff_category: "store_keeper", basic_pay: 0, stores: JSON.stringify(["general"]) });
  const nurse = await saveHospitalStaff(null, { name: "Sister Rabia", staff_category: "head_nurse", license_no: "PNC-1", department: "Surgical Ward", basic_pay: 0 });
  const vendor = await saveVendor(null, { name: "City Traders" });
  await as(officer);
  const p = await saveStorePurchase({ vendorId: vendor.id, items: [{ productName: "Hand-wash soap", qty: 20, rate: 150, store: "general" }, { productName: "Floor cleaner", qty: 10, rate: 400, store: "general" }] });
  await postStorePurchase(p.id);
  await as(keeper);
  const [arr] = await storeArrivals("general");
  await verifyStoreItems(p.id, "general", Object.fromEntries(arr.items.map((i) => [i.id, i.qty])));
  return { officer, keeper, nurse, vendor };
}

test("indent book: ordered by the purchase officer, issued by a store keeper; then Indent Book is in the holder's sidebar", async () => {
  const { officer, keeper, nurse } = await stocked();
  await as(nurse);
  await assert.rejects(createIndent({ store: "general", items: [{ productName: "Hand-wash soap", qty: 2 }] }), /need an indent book/);
  await assert.rejects(requestIndentBook(nurse.id), /ordered by the purchase officer/);
  await as(officer);
  const book = await requestIndentBook(nurse.id, "Surgical ward");
  assert.deepEqual([book.book_no, book.status, book.department], ["IB-0001", "requested", "Surgical Ward"]);
  await assert.rejects(requestIndentBook(nurse.id), /already has indent book IB-0001/);
  await as(keeper);
  await issueIndentBook(book.id);
  const perms = JSON.parse(String((await usersRepo.get(`user-${nurse.id}`))!.permissions)) as string[];
  assert.ok(perms.includes("hospital_indent"));
});

test("an indent: issued in part, a shortfall explained, a return accepted back into stock; the register and dashboards follow", async () => {
  const { officer, keeper, nurse, vendor } = await stocked();
  await as(officer);
  const book = await requestIndentBook(nurse.id);
  await as(keeper);
  await issueIndentBook(book.id);

  await as(nurse);
  const ind = await createIndent({ store: "general", note: "Weekly", items: [{ productName: "Hand-wash soap", qty: 6 }, { productName: "Floor cleaner", qty: 2 }] });
  await as(keeper);
  let d = await storeDashboard("general");
  assert.equal(d.pendingIndents, 1);
  const [pending] = await storeIndents("general");
  const soap = pending.items.find((i) => i.product_name === "Hand-wash soap")!;
  await assert.rejects(issueIndent(ind.id, { [soap.id]: 8 }), /between 0 and 6/);
  await issueIndent(ind.id, { [soap.id]: 5 });
  assert.deepEqual((await storeStock("general")).map((r) => [r.product_name, r.qty]), [["Floor cleaner", 8], ["Hand-wash soap", 15]]);

  await as(nurse);
  await assert.rejects(receiveIndent(ind.id, { [soap.id]: { qty: 4 } }), /Write why less Hand-wash soap/);
  await receiveIndent(ind.id, { [soap.id]: { qty: 4, note: "One bottle leaking, left at the store" } });
  await assert.rejects(returnIndentItems(ind.id, { [soap.id]: { qty: 9, note: "x" } }), /Return at most 4/);
  await returnIndentItems(ind.id, { [soap.id]: { qty: 1, note: "Not needed" } });
  assert.equal((await myIndents())[0].items.find((i) => i.id === soap.id)!.return_status, "pending");

  await as(keeper);
  d = await storeDashboard("general");
  assert.equal(d.pendingReturns, 1);
  assert.ok(d.notices.some((n) => /Return of Hand-wash soap from Surgical Ward/.test(n.text)));
  await decideIndentReturn(soap.id, true);
  assert.equal((await storeStock("general")).find((r) => r.product_name === "Hand-wash soap")!.qty, 16);
  await as(nurse);
  assert.equal((await myIndents())[0].items.find((i) => i.id === soap.id)!.return_status, "accepted", "the holder sees the return's status");

  // Dead stock: two bottles broke.
  await as(keeper);
  await assert.rejects(recordDeadStock("general", { productName: "Hand-wash soap", qty: 50, reason: "Broken" }), /Only 16/);
  await recordDeadStock("general", { productName: "Hand-wash soap", qty: 2, reason: "Broken", note: "Dropped" });
  const dead = await deadStockRegister("general");
  assert.deepEqual(dead.map((r) => [r.product_name, r.qty, r.notes]), [["Hand-wash soap", -2, "Broken: Dropped"]]);
  assert.equal((await storeStock("general")).find((r) => r.product_name === "Hand-wash soap")!.qty, 14);

  // The register: by vendor number, item and company.
  const reg = await storeRegister("general", { vendor: vendor.vendor_no! });
  assert.deepEqual(reg.map((r) => r.kind).sort(), ["receipt", "receipt"]);
  const soapMoves = await storeRegister("general", { product: "soap" });
  assert.deepEqual(soapMoves.map((r) => r.kind).sort(), ["dead", "issue", "receipt", "return_in"]);
  d = await storeDashboard("general");
  assert.deepEqual([d.pendingIndents, d.pendingReturns, d.lowStock.length], [0, 0, 0]);
});
