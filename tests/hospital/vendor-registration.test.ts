/** eProcurement vendor registration (schema v111): a vendor signs up at
 * ep.mavin.pk, fills four steps (company / owner / business type, address,
 * bank, review), submits to the Super Admin, who approves, asks for changes,
 * rejects, suspends or blacklists. Only approved vendors reach the portal's
 * work or the hospitals' directory; hospitals never set vendor passwords. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "../server/sqliteSql.ts";
import {
  accountAction, adminEprocurementAction, signUp, SIGNUPS_PER_IP_PER_DAY, type AdminVendorDetail, type AdminVendorRow, type VendorAccount,
} from "@/server/vendorRegistration";
import { eprocurementAction, vendorAction, vendorActorFor, type VendorOption } from "@/server/vendorPortal";
import { requestReset } from "@/server/recovery";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { emptyProfile, stepProblems, type VendorProfile } from "@/lib/vendorProfile";
import { passwordHash } from "@/server/db";

const H = "hosp-a";
let db: DatabaseSync;
const sql = () => sqliteSql(db);
const superAdmin: Caller = { userId: "sa", role: "super_admin", tenantId: null, permissions: null };
const owner: Caller = { userId: "owner", role: "owner", tenantId: H, permissions: null };
const admin = (body: Record<string, unknown>) => adminEprocurementAction(sql(), superAdmin, body);

beforeEach(() => {
  db = fullSchemaDb();
  db.prepare(`INSERT INTO tenants (id, name, business_type, eprocurement_allowed, created_at, updated_at) VALUES (?, 'City Hospital', 'hospital', 1, 'x', 'x')`).run(H);
  db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES ('hosp-b', 'Mercy Hospital', 'hospital', 'x', 'x')`).run();
  setTestDb(db);
});

const input = (over: Record<string, unknown> = {}) => ({ companyName: "Ali Traders", contactName: "Ali Khan", email: "Sales@Ali.pk", phone: "0300-1234567", username: "ali", password: "secret123", ...over });
async function vendor(over: Record<string, unknown> = {}) {
  await signUp(sql(), input(over), "1.2.3.4");
  const u = db.prepare(`SELECT id FROM users WHERE username = ?`).get(String(over.username ?? "ali")) as { id: string };
  const me = { userId: u.id, platformRole: "vendor" as const };
  return { me, act: (body: Record<string, unknown>) => accountAction(sql(), me, body), account: () => accountAction(sql(), me, { action: "account" }) as Promise<VendorAccount> };
}
function filled(p: VendorProfile = emptyProfile(), email = "sales@ali.pk"): VendorProfile {
  return {
    company: { ...p.company, name: "Ali Traders", phone: "042-1234567", email, regNo: "", ntn: "1234567-8", website: "" },
    owner: { ...p.owner, name: "Ali Khan", mobile: "0300-1234567", cnic: "35202-1234567-1", designation: "Proprietor", email: "" },
    business: { kind: "supplier", categories: ["Stationery & printing", "Medicines & pharmaceuticals"], description: "Paper and office supplies" },
    address: { line1: "12 Hall Road", area: "Anarkali", city: "Lahore", province: "Punjab", postalCode: "54000", country: "Pakistan" },
    bank: { accountTitle: "Ali Traders", bank: "Meezan Bank", iban: "PK36 MEZN 0000 0011 2345 6702", accountNo: "0011234567", branch: "Hall Road", branchCode: "0201", city: "Lahore" },
  };
}

test("sign-up: the vendor's own account (no business), checked fields, one email per vendor, a limit per connection", async () => {
  await assert.rejects(signUp(sql(), input({ email: "not-an-email" }), null), /valid email/);
  await assert.rejects(signUp(sql(), input({ password: "short1" }), null), /at least 8/);
  await assert.rejects(signUp(sql(), input({ password: "longbutnodigits" }), null), /letters and numbers/);
  await assert.rejects(signUp(sql(), input({ username: "a b" }), null), /Username/);
  await assert.rejects(signUp(sql(), input({ companyName: "" }), null), /company name/);
  const { account } = await vendor();
  const u = db.prepare(`SELECT tenant_id, platform_role, role, permissions, email, password_hash, password_salt FROM users WHERE username = 'ali'`).get() as Record<string, string | null>;
  assert.deepEqual([u.tenant_id, u.platform_role, u.role, u.permissions, u.email], [null, "vendor", "staff", "[]", "sales@ali.pk"]);
  assert.equal(u.password_hash, passwordHash("secret123", String(u.password_salt)));
  const a = await account();
  assert.deepEqual([a.status, a.vendorCode, a.editable, a.complete, a.profile.company.name, a.profile.owner.name], ["draft", "EP-0001", true, false, "Ali Traders", "Ali Khan"]);
  await assert.rejects(signUp(sql(), input({ username: "ali2" }), null), /already exists/);
  await assert.rejects(signUp(sql(), input({ email: "x@y.pk" }), null), /already taken/);
  for (let i = 2; i <= SIGNUPS_PER_IP_PER_DAY; i++) await signUp(sql(), input({ username: `vendor${i}`, email: `v${i}@y.pk` }), "1.2.3.4");
  await assert.rejects(signUp(sql(), input({ username: "one-more", email: "more@y.pk" }), "1.2.3.4"), /Too many/);
  await signUp(sql(), input({ username: "elsewhere", email: "else@y.pk" }), "5.6.7.8");
});

test("the four steps: each saved and checked; submitted only complete and confirmed; then waiting, locked, and in the Super Admin's inbox", async () => {
  const { act, account } = await vendor();
  const p = filled();
  // Step problems the screen shows (same rules as the server).
  assert.ok(stepProblems(emptyProfile(), "company")["business.kind"]);
  assert.match(stepProblems({ ...p, bank: { ...p.bank, iban: "PK12" } }, "bank")["bank.iban"], /24 characters/);
  // Only the step being saved changes.
  const r1 = (await act({ action: "saveProfile", step: "company", profile: { ...p, bank: { ...p.bank, iban: "IGNORED" } } })) as { problems: Record<string, string> };
  assert.deepEqual(r1.problems, {});
  assert.equal((await account()).profile.bank.iban, "");
  await assert.rejects(act({ action: "submitRegistration", confirmed: true }), /missing/);
  await act({ action: "saveProfile", step: "address", profile: p });
  const r3 = (await act({ action: "saveProfile", step: "bank", profile: p })) as { problems: Record<string, string> };
  assert.deepEqual(r3.problems, {});
  const a = await account();
  assert.equal(a.profile.bank.iban, "PK36MEZN0000001123456702", "IBAN kept without spaces, in capitals");
  assert.equal(a.complete, true);
  await assert.rejects(act({ action: "submitRegistration" }), /Tick the statement/);
  assert.deepEqual(await act({ action: "submitRegistration", confirmed: true }), { ok: true, status: "pending" });
  const after = await account();
  assert.deepEqual([after.status, after.editable], ["pending", false]);
  await assert.rejects(act({ action: "saveProfile", step: "bank", profile: p }), /for approval/);
  const q = db.prepare(`SELECT topic, business_name FROM site_queries`).get() as Record<string, string>;
  assert.deepEqual([q.topic, q.business_name], ["eprocurement-vendor", "Ali Traders"]);
  // Waiting: no quote requests, orders or payments yet.
  await assert.rejects(vendorActorFor(sql(), { userId: (await vendorMe("ali")).userId, platformRole: "vendor" }), /waiting for approval/);
  // A hospital does not find a vendor that is not approved.
  assert.deepEqual(((await eprocurementAction(sql(), owner, { action: "searchVendors", q: "Ali" })) as VendorOption[]).filter((v) => v.source === "directory"), []);
});

async function vendorMe(username: string) {
  return db.prepare(`SELECT id AS userId FROM users WHERE username = ?`).get(username) as { userId: string };
}
async function submitted(username = "ali", email = "sales@ali.pk") {
  const v = await vendor({ username, email });
  const p = filled(emptyProfile(), email);
  for (const step of ["company", "address", "bank"]) await v.act({ action: "saveProfile", step, profile: p });
  await v.act({ action: "submitRegistration", confirmed: true });
  const id = (await v.account()).epVendorId;
  return { ...v, id };
}

test("Super Admin review: changes requested, corrected, approved; then in the directory, added by a hospital, and working", async () => {
  const v = await submitted();
  const list = (await admin({ action: "vendors", status: "pending" })) as AdminVendorRow[];
  assert.deepEqual(list.map((r) => [r.name, r.kind, r.city, r.categories.length]), [["Ali Traders", "supplier", "Lahore", 2]]);
  assert.deepEqual(await admin({ action: "counts" }), { pending: 1 });
  const d = (await admin({ action: "vendor", id: v.id })) as AdminVendorDetail;
  assert.deepEqual([d.profile.bank.iban, d.profile.owner.cnic, Object.keys(d.problems).length], ["PK36MEZN0000001123456702", "35202-1234567-1", 0]);
  await assert.rejects(admin({ action: "requestChanges", id: v.id, note: "" }), /what the vendor should correct/);
  await admin({ action: "requestChanges", id: v.id, note: "Attach the NTN of the company, not the owner." });
  const back = await v.account();
  assert.deepEqual([back.status, back.editable, back.reviewNote], ["changes", true, "Attach the NTN of the company, not the owner."]);
  await v.act({ action: "saveProfile", step: "company", profile: { ...filled(), company: { ...filled().company, ntn: "7654321-0" } } });
  await v.act({ action: "submitRegistration", confirmed: true });
  await admin({ action: "approve", id: v.id });
  await assert.rejects(admin({ action: "approve", id: v.id }), /cannot be done now/);
  const ok = await v.account();
  assert.deepEqual([ok.status, ok.editable, ok.hospitals], ["approved", false, []]);
  // Approved, no hospital yet: the portal opens with empty lists.
  const actor = await vendorActorFor(sql(), v.me);
  assert.deepEqual(await vendorAction(sql(), actor, { action: "requests" }), []);
  // A hospital finds and adds them; the vendor then supplies it.
  const found = ((await eprocurementAction(sql(), owner, { action: "searchVendors", q: "ali" })) as VendorOption[]).find((x) => x.source === "directory");
  assert.equal(found?.name, "Ali Traders");
  await eprocurementAction(sql(), owner, { action: "addDirectoryVendor", epVendorId: found!.epVendorId });
  assert.deepEqual((await v.account()).hospitals, ["City Hospital"]);
  assert.deepEqual((await vendorActorFor(sql(), v.me)).links.map((l) => l.hospitalName), ["City Hospital"]);
  assert.deepEqual(((await admin({ action: "vendor", id: v.id })) as AdminVendorDetail).hospitalNames, ["City Hospital"]);
  // Approved details cannot be changed by the vendor (bank details especially): MAVIN.pk changes them.
  await assert.rejects(v.act({ action: "saveProfile", step: "bank", profile: filled() }), /contact MAVIN.pk/);
});

test("rejected, suspended and blacklisted: closed to the portal's work and to hospitals; a blacklisted vendor cannot be added; removed from the blacklist it works again", async () => {
  const rejected = await submitted("rej", "rej@v.pk");
  await assert.rejects(admin({ action: "reject", id: rejected.id }), /the reason/);
  await admin({ action: "reject", id: rejected.id, note: "Not a registered business." });
  await assert.rejects(vendorActorFor(sql(), rejected.me), /not approved/);
  assert.equal((await rejected.account()).editable, true, "a rejected vendor may correct and submit again");

  const v = await submitted();
  await admin({ action: "approve", id: v.id });
  const found = ((await eprocurementAction(sql(), owner, { action: "searchVendors", q: "ali" })) as VendorOption[]).find((x) => x.source === "directory")!;
  await admin({ action: "suspend", id: v.id, note: "Late deliveries under review." });
  await assert.rejects(vendorActorFor(sql(), v.me), /suspended/);
  await assert.rejects(eprocurementAction(sql(), owner, { action: "addDirectoryVendor", epVendorId: found.epVendorId }), /not an approved vendor/);
  await admin({ action: "reactivate", id: v.id });
  await eprocurementAction(sql(), owner, { action: "addDirectoryVendor", epVendorId: found.epVendorId });
  await admin({ action: "blacklist", id: v.id, note: "Supplied counterfeit medicines." });
  await assert.rejects(vendorActorFor(sql(), v.me), /blacklisted/);
  const acc = await v.account();
  assert.deepEqual([acc.status, acc.reviewNote, acc.hospitals], ["blacklisted", "Supplied counterfeit medicines.", []]);
  assert.deepEqual(((await admin({ action: "vendors", status: "blacklisted" })) as AdminVendorRow[]).map((r) => [r.name, r.note]), [["Ali Traders", "Supplied counterfeit medicines."]]);
  assert.deepEqual(((await eprocurementAction(sql(), owner, { action: "searchVendors", q: "Ali" })) as VendorOption[]).filter((x) => x.source === "directory"), []);
  await admin({ action: "unblacklist", id: v.id });
  assert.deepEqual((await vendorActorFor(sql(), v.me)).links.map((l) => l.hospitalName), ["City Hospital"]);
  assert.equal(((await admin({ action: "vendor", id: v.id })) as AdminVendorDetail).blacklistReason, null);
});

test("an account a hospital made before v111 stays approved and completes its details once, without a new review", async () => {
  db.prepare(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, display_name, is_active, permissions, platform_role, created_at, updated_at) VALUES ('u-old', NULL, 'old', 'x', 'x', 'staff', 'Old', 1, '[]', 'vendor', 'x', 'x')`).run();
  db.prepare(`INSERT INTO suppliers (id, tenant_id, name, phone, created_at, updated_at) VALUES ('s-old', ?, 'Old Supplier', '0300-7654321', 'x', 'x')`).run(H);
  db.prepare(`INSERT INTO vendor_portal_logins (id, tenant_id, user_id, vendor_id, is_active, created_at, updated_at) VALUES ('l-old', ?, 'u-old', 's-old', 1, 'x', 'x')`).run(H);
  const me = { userId: "u-old", platformRole: "vendor" as const };
  // An account from v109 (no directory row yet) gets one, approved, from its hospital's supplier.
  const a = (await accountAction(sql(), me, { action: "account" })) as VendorAccount;
  assert.deepEqual([a.status, a.editable, a.profile.company.name, a.profile.company.phone, a.hospitals], ["approved", true, "Old Supplier", "0300-7654321", ["City Hospital"]]);
  assert.equal((await vendorActorFor(sql(), me)).links.length, 1, "it keeps working meanwhile");
  for (const step of ["company", "address", "bank"]) await accountAction(sql(), me, { action: "saveProfile", step, profile: filled() });
  assert.deepEqual(await accountAction(sql(), me, { action: "submitRegistration", confirmed: true }), { ok: true, status: "approved" });
  const done = (await accountAction(sql(), me, { action: "account" })) as VendorAccount;
  assert.deepEqual([done.status, done.editable, done.complete], ["approved", false, true]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM site_queries`).get() as { n: number }).n, 0, "no review needed");
});

test("forgot password: the code goes to the vendor's own email; the Super Admin can set a password as a last resort", async () => {
  const v = await vendor();
  const sent: { to: string }[] = [];
  await requestReset(sql(), "ali", null, { send: async (m: { to: string }) => { sent.push(m); } } as never);
  assert.deepEqual(sent.map((m) => m.to), ["sales@ali.pk"]);
  const id = (await v.account()).epVendorId;
  await assert.rejects(adminEprocurementAction(sql(), owner, { action: "setPassword", id, password: "newsecret1" }), /platform owner/);
  await admin({ action: "setPassword", id, password: "newsecret1" });
  const u = db.prepare(`SELECT password_hash, password_salt, password_changed_at FROM users WHERE username = 'ali'`).get() as Record<string, string>;
  assert.equal(u.password_hash, passwordHash("newsecret1", u.password_salt));
  assert.ok(u.password_changed_at, "earlier sessions end");
});

test("business types: seeded lists, added, renamed, turned off (hidden from new registrations) and deleted; Super Admin only", async () => {
  const v = await vendor();
  const seeded = (await v.act({ action: "categories" })) as { kind: string; name: string }[];
  assert.ok(seeded.some((c) => c.kind === "supplier" && c.name === "Surgical & disposables"));
  assert.ok(seeded.some((c) => c.kind === "services" && c.name === "Equipment maintenance & repair"));
  const { id } = (await admin({ action: "saveCategory", kind: "services", name: "Biomedical engineering" })) as { id: string };
  await assert.rejects(admin({ action: "saveCategory", kind: "services", name: "biomedical engineering" }), /already in the list/);
  await admin({ action: "saveCategory", id, kind: "services", name: "Biomedical engineering services" });
  await admin({ action: "categoryActive", id, active: false });
  assert.ok(!((await v.act({ action: "categories" })) as { name: string }[]).some((c) => c.name.startsWith("Biomedical")));
  assert.ok(((await admin({ action: "categories" })) as { name: string; active: boolean }[]).some((c) => c.name === "Biomedical engineering services" && !c.active));
  await admin({ action: "deleteCategory", id });
  assert.ok(!((await admin({ action: "categories" })) as { id: string }[]).some((c) => c.id === id));
  await assert.rejects(adminEprocurementAction(sql(), owner, { action: "categories" }), /platform owner/);
});

test("organizations: every hospital with its eProcurement switch and use; switched by the Super Admin", async () => {
  const rows = (await admin({ action: "organizations" })) as { name: string; allowed: boolean }[];
  assert.deepEqual(rows.map((r) => [r.name, r.allowed]), [["City Hospital", true], ["Mercy Hospital", false]]);
  await admin({ action: "setAllowed", tenantId: "hosp-b", allowed: true });
  assert.equal((db.prepare(`SELECT eprocurement_allowed AS e FROM tenants WHERE id = 'hosp-b'`).get() as { e: number }).e, 1);
});

test("registration details and business types are server-only (never through /api/db)", () => {
  const known = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));
  assert.ok(known.has("ep_categories"));
  for (const s of ["SELECT profile FROM ep_vendors", "SELECT * FROM ep_categories", "UPDATE ep_vendors SET status = 'approved'"]) {
    assert.equal(authorize(analyzeSql(s), superAdmin, known).ok, false, s);
    assert.equal(authorize(analyzeSql(s), owner, known).ok, false, s);
  }
});
