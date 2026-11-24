/** Hospital F3: stores and store purchases. The purchase officer posts a
 * purchase with each item's store; it is then locked. Each store keeper sees
 * only their stores: verifies (received quantity, stock entry number, stock
 * in) or returns it with a reason; the officer cancels or posts it again with
 * a comment. Fully verified, it goes to Finance for payment. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { staffRepo } from "@/lib/repo/staff";
import { saveHospitalStaff } from "@/lib/repo/hospitalOpd";
import { saveVendor, listVendors } from "@/lib/repo/vendors";
import { payVendorBill, pendingVendorBills } from "@/lib/repo/vendorPayments";
import {
  cancelStorePurchase, getStorePurchase, myStores, postStorePurchase, returnStorePurchase, saveStorePurchase, storeArrivals, storeStock, verifyStoreItems,
} from "@/lib/repo/hospitalStores";
import { pagesForStaff } from "@/config/hospitalStaff";
import { visibleNavFor } from "@/config/navFilter";
import type { Staff } from "@/lib/types";

const H = "hosp-a";
const tenant: SessionTenant = {
  id: H, name: "Hospital", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 30,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "hospital",
};
const asOwner = () => useAuthStore.setState({ currentUser: { id: "owner", username: "o", displayName: "Admin", role: "owner", tenantId: H, permissions: null }, currentTenant: tenant });
async function as(staff: Staff) {
  asOwner();
  await staffRepo.update(staff.id, { user_id: `user-${staff.id}` } as Partial<Staff>);
  useAuthStore.setState({ currentUser: { id: `user-${staff.id}`, username: staff.name, displayName: staff.name, role: "staff", tenantId: H, permissions: pagesForStaff(staff) }, currentTenant: tenant });
}

beforeEach(() => {
  setTestDb(fullSchemaDb());
  asOwner();
});

async function people() {
  const officer = await saveHospitalStaff(null, { name: "Kamran", staff_category: "purchase_officer", basic_pay: 0 });
  const general = await saveHospitalStaff(null, { name: "Rashid", staff_category: "store_keeper", basic_pay: 0, stores: JSON.stringify(["general"]) });
  const stationery = await saveHospitalStaff(null, { name: "Naveed", staff_category: "store_keeper", basic_pay: 0, stores: JSON.stringify(["stationery", "lab"]) });
  const vendor = await saveVendor(null, { name: "City Traders", iban: "PK36SCBL0000001123456702" });
  return { officer, general, stationery, vendor };
}

test("store keepers see only their stores; one can work in every store", async () => {
  const { general, stationery } = await people();
  const allStores = await saveHospitalStaff(null, { name: "Asif", staff_category: "store_keeper", basic_pay: 0, stores: JSON.stringify(["all"]) });
  const nurse = await saveHospitalStaff(null, { name: "Rabia", staff_category: "nurse", license_no: "PNC-1", basic_pay: 0, stores: JSON.stringify(["all"]) });
  assert.equal(nurse.stores, null, "a nurse is not given stores");
  const storeTabs = (s: Staff) => visibleNavFor("hospital", null, pagesForStaff(s)).find((i) => i.label === "Store")?.children?.map((c) => c.label) ?? [];
  assert.deepEqual(storeTabs(general), ["General Store"]);
  assert.deepEqual(storeTabs(stationery), ["Stationery & Printing Store", "Lab Store"]);
  assert.equal(storeTabs(allStores).length, 5);
  await as(stationery);
  assert.deepEqual(await myStores(), ["stationery", "lab"]);
  await assert.rejects(storeArrivals("general"), /do not work in the General Store/);
});

test("posted to the stores, verified by each store keeper, then with Finance; a return goes back with a reason", async () => {
  const { officer, general, stationery, vendor } = await people();
  await as(general);
  await assert.rejects(saveStorePurchase({ vendorId: vendor.id, items: [{ productName: "Soap", qty: 1, rate: 1, store: "general" }] }), /by the purchase officer/);
  await as(officer);
  await assert.rejects(saveStorePurchase({ vendorId: vendor.id, items: [{ productName: "Soap", qty: 20, rate: 150, store: "" as never }] }), /store of Soap/);
  const p = await saveStorePurchase({ vendorId: vendor.id, vendorInvoiceNo: "CT-88", items: [
    { productName: "Hand-wash soap 500 ml", qty: 20, rate: 150, store: "general" },
    { productName: "Ballpoint (blue)", companyName: "Dollar", qty: 100, rate: 20, store: "stationery" },
  ] });
  assert.deepEqual([p.purchase_no, p.status, p.total], ["SP-0001", "draft", 5000]);
  await postStorePurchase(p.id);
  await assert.rejects(saveStorePurchase({ id: p.id, vendorId: vendor.id, items: [] }), /cannot be changed/, "a posted purchase is locked");
  assert.equal((await pendingVendorBills()).length, 0, "not with Finance before the stores verify it");

  // The General Store received 16 of 20.
  await as(general);
  const [arr] = await storeArrivals("general");
  assert.deepEqual(arr.items.map((i) => i.product_name), ["Hand-wash soap 500 ml"]);
  await assert.rejects(verifyStoreItems(p.id, "general", { [arr.items[0].id]: 25 }), /More Hand-wash soap 500 ml received/);
  await verifyStoreItems(p.id, "general", { [arr.items[0].id]: 16 });
  assert.deepEqual((await storeStock("general")).map((r) => [r.product_name, r.qty, r.value]), [["Hand-wash soap 500 ml", 16, 2400]]);

  // The stationery store returns it; the officer posts it again with a comment.
  await as(stationery);
  await assert.rejects(returnStorePurchase(p.id, "stationery", " "), /why/);
  await returnStorePurchase(p.id, "stationery", "Black pens came, blue were ordered");
  await as(officer);
  assert.match(String((await getStorePurchase(p.id))!.purchase.return_reason), /Stationery & Printing Store: Black pens/);
  await assert.rejects(cancelStorePurchase(p.id, "no"), /already received into a store/);
  await assert.rejects(postStorePurchase(p.id, ""), /Write a comment/);
  await postStorePurchase(p.id, "Vendor replaced them with blue pens");
  await as(stationery);
  const [again] = await storeArrivals("stationery");
  await verifyStoreItems(p.id, "stationery", { [again.items[0].id]: 100 });

  const done = (await getStorePurchase(p.id))!;
  assert.equal(done.purchase.status, "verified");
  assert.equal(done.purchase.total, 4400, "16 x 150 + 100 x 20");
  assert.deepEqual(done.items.map((i) => i.entry_no).sort(), ["SE-000001", "SE-000002"]);
  const [bill] = await pendingVendorBills();
  assert.deepEqual([bill.docType, bill.balance, bill.iban], ["store_purchase", 4400, "PK36SCBL0000001123456702"]);
  assert.match(String(bill.detail), /Stock entries SE-00000/);
  asOwner();
  assert.equal((await listVendors())[0].balance, 4400);
  await payVendorBill({ docType: "store_purchase", docId: p.id, full: true, method: "bank", reference: "TX-9" });
  assert.equal((await listVendors())[0].balance, 0);
});
