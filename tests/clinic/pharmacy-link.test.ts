/** Linking a clinic / hospital to a hospital pharmacy by token: the clinic
 * makes a token, the pharmacy verifies it, and the verified link is fixed.
 * Also: the server refuses direct writes to the link, and the clinic's print
 * templates. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { useAuthStore, type SessionTenant } from "@/store/authStore";
import { createLinkToken, getLinkStatus, verifyLinkToken, listLinkedClinics, unlinkPharmacy } from "@/lib/repo/pharmacyLink";
import { getPharmacyLink, savePharmacyLink } from "@/lib/repo/clinic";
import { hashLinkToken, normalizeLinkToken, redeemLinkToken } from "@/lib/businessLink";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import { loadClinicTemplate, saveClinicTemplate, DEFAULT_CLINIC_TEMPLATES } from "@/lib/clinicPrintTemplates";

let db: DatabaseSync;
const tenant = (id: string, businessType: string): SessionTenant => ({
  id, name: id, subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5,
  maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType,
});
const as = (tenantId: string, businessType: string, role: "owner" | "staff" = "owner") =>
  useAuthStore.setState({ currentUser: { id: `${tenantId}-${role}`, username: role, displayName: role, role, tenantId, permissions: null }, currentTenant: tenant(tenantId, businessType) });

/** Raw database access, as the server route /api/link/verify has. */
const serverDb = () => ({
  select: async <T,>(sql: string, args: unknown[]) => db.prepare(sql).all(...(args as never[])) as T[],
  execute: async (sql: string, args: unknown[]) => { db.prepare(sql).run(...(args as never[])); },
});
const SCOPED = process.env.TENANT_SCOPE === "1";
/** The pharmacy verifies: on the web (scoped) through the server route, else locally. */
async function verify(token: string): Promise<{ clinicName: string }> {
  if (!SCOPED) return verifyLinkToken(token);
  const { currentUser } = useAuthStore.getState();
  if (currentUser?.role !== "owner") return verifyLinkToken(token);
  const r = await redeemLinkToken(serverDb(), { token, pharmacyTenantId: currentUser.tenantId!, userId: currentUser.id });
  return { clinicName: r.clinicName };
}

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  for (const [id, name, type] of [["clinic-a", "Al-Shifa Clinic", "clinic"], ["clinic-b", "City Hospital", "hospital"], ["pharm-1", "Shifa Pharmacy", "hospital_pharmacy"], ["pharm-2", "Other Pharmacy", "hospital_pharmacy"], ["shop", "Corner Store", "retail_pharmacy"]]) {
    db.prepare(`INSERT INTO tenants (id, name, business_type, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')`).run(id, name, type);
  }
});

test("token format: typed loosely, stored only as a hash", async () => {
  as("clinic-a", "clinic");
  const { token } = await createLinkToken();
  assert.match(token, /^HSL-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeLinkToken(` ${token.toLowerCase().replace(/-/g, " ")} `), normalizeLinkToken(token));
  const rows = db.prepare(`SELECT token_hash, status FROM business_link_tokens`).all() as { token_hash: string; status: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, await hashLinkToken(token));
  assert.ok(!JSON.stringify(rows).includes(normalizeLinkToken(token)), "the token itself is not stored");
  assert.ok((await getLinkStatus()).pending);
});

test("the pharmacy verifies the clinic's token; the link is then fixed", async () => {
  as("clinic-a", "clinic");
  const first = await createLinkToken();
  const { token } = await createLinkToken();
  as("pharm-1", "hospital_pharmacy");
  await assert.rejects(verify(first.token), /not valid/, "a replaced token stops working");
  assert.deepEqual(await verify(token), { clinicName: "Al-Shifa Clinic" });
  const linked = await listLinkedClinics();
  assert.equal(linked.length, 1);
  assert.equal(linked[0].clinic_name, "Al-Shifa Clinic");
  assert.ok(linked[0].verified_at);
  await assert.rejects(verify(token), /already been used/);

  as("clinic-a", "clinic");
  const status = await getLinkStatus();
  assert.equal(status.link?.pharmacy_tenant_id, "pharm-1");
  assert.equal(status.link?.pharmacy_name, "Shifa Pharmacy");
  assert.equal((await getPharmacyLink())?.pharmacy_tenant_id, "pharm-1");
  await assert.rejects(createLinkToken(), /fixed/);
  await assert.rejects(savePharmacyLink("pharm-2"), /fixed/);

  // Only the Super Admin can undo it; then a new token links again.
  useAuthStore.setState({ currentUser: { id: "admin", username: "admin", displayName: "admin", role: "super_admin", tenantId: null, permissions: null }, currentTenant: null });
  await unlinkPharmacy("clinic-a");
  as("clinic-a", "clinic");
  const again = await createLinkToken();
  as("pharm-2", "hospital_pharmacy");
  await verify(again.token);
  as("clinic-a", "clinic");
  assert.equal((await getPharmacyLink())?.pharmacy_tenant_id, "pharm-2");
});

test("on the web the pharmacy cannot read the clinic's tokens itself", { skip: !SCOPED }, async () => {
  as("clinic-a", "clinic");
  await createLinkToken();
  as("pharm-1", "hospital_pharmacy");
  const { dbSelect } = await import("../shims/db.ts");
  assert.equal((await dbSelect("SELECT * FROM business_link_tokens", [])).length, 0);
});

test("refused: staff logins, non-hospital pharmacies, expired and wrong tokens", async () => {
  as("clinic-b", "hospital");
  const { token } = await createLinkToken();
  as("pharm-1", "hospital_pharmacy", "staff");
  await assert.rejects(verify(token), /owner login/);
  as("shop", "retail_pharmacy");
  await assert.rejects(verify(token), /Only a hospital pharmacy/);
  as("pharm-1", "hospital_pharmacy");
  await assert.rejects(verify("HSL-AAAA"), /full token/);
  await assert.rejects(verify("HSL-AAAA-BBBB-CCCC-DDDD"), /not valid/);
  await assert.rejects(redeemLinkToken(serverDb(), { token, pharmacyTenantId: "pharm-1", userId: "u", now: new Date(Date.now() + 25 * 3600_000) }), /expired/);
  assert.deepEqual(await verify(token), { clinicName: "City Hospital" });
});

test("the server refuses direct writes to the pharmacy link (token only)", () => {
  const known = new Set(["clinic_pharmacy_link", "business_link_tokens"]);
  const owner: Caller = { userId: "u1", role: "owner", tenantId: "clinic-a" };
  const admin: Caller = { userId: "u0", role: "super_admin", tenantId: null };
  const insert = "INSERT INTO clinic_pharmacy_link (id, clinic_tenant_id, pharmacy_tenant_id, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)";
  assert.equal(authorize(analyzeSql(insert), owner, known).ok, false);
  assert.equal(authorize(analyzeSql("UPDATE clinic_pharmacy_link SET pharmacy_tenant_id = ? WHERE clinic_tenant_id = ?"), owner, known).ok, false);
  assert.equal(authorize(analyzeSql("SELECT * FROM clinic_pharmacy_link WHERE clinic_tenant_id = ?"), owner, known).ok, true);
  assert.equal(authorize(analyzeSql("UPDATE clinic_pharmacy_link SET is_active = 0 WHERE clinic_tenant_id = ?"), admin, known).ok, true);
  assert.equal(authorize(analyzeSql("INSERT INTO business_link_tokens (id, tenant_id) VALUES (?, ?)"), owner, known).ok, true);
});

test("clinic print templates: defaults, saved per document, set by the Super Admin for a clinic", async () => {
  as("clinic-a", "clinic");
  assert.deepEqual(await loadClinicTemplate("prescription"), DEFAULT_CLINIC_TEMPLATES.prescription);
  await saveClinicTemplate("lab", { paper: "thermal", headerAlign: "left", showIds: false, signature: true, footer: "  Fasting samples 8-10 am " });
  const lab = await loadClinicTemplate("lab");
  assert.equal(lab.paper, "thermal");
  assert.equal(lab.footer, "Fasting samples 8-10 am");
  assert.equal((await loadClinicTemplate("invoice")).paper, "thermal");
  // The Super Admin saves for the clinic by its tenant id.
  useAuthStore.setState({ currentUser: { id: "admin", username: "admin", displayName: "admin", role: "super_admin", tenantId: null, permissions: null }, currentTenant: null });
  await saveClinicTemplate("invoice", { ...DEFAULT_CLINIC_TEMPLATES.invoice, paper: "a5" }, "clinic-b");
  as("clinic-b", "hospital");
  assert.equal((await loadClinicTemplate("invoice")).paper, "a5");
});
