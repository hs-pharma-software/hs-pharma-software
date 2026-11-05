/** The online diagnostic-lab report behind the QR code on the receipt and the
 * printed report: only verified results, the lab's own name / design / logo,
 * "not ready" before verification, unknown tokens refused, and nothing from
 * another business. Synthetic data on the real schema (SQLite). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { getPublicLabVisitReport } from "@/server/labVisitReport";
import { HttpError } from "@/server/db";
import { useAuthStore } from "@/store/authStore";
import { ensureLabVisitToken, labVisitIdFor } from "@/lib/repo/lab";
import { buildLabReportView, labReportUrl } from "@/lib/labReportView";

const LAB = "syn-lab";
const OTHER = "syn-other";
const TOKEN = "a".repeat(48);
const NOW = "2026-11-05T09:00:00.000Z";
let db: DatabaseSync;
const ins = (t: string, r: Record<string, unknown>) => {
  const k = Object.keys(r);
  db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
};
const order = (id: string, tenant: string, status: string, extra: Record<string, unknown> = {}) =>
  ins("clinic_orders", {
    id, tenant_id: tenant, order_no: id.toUpperCase(), patient_id: "pat-1", kind: "lab", name: `Test ${id}`, qty: 1, rate: 500, amount: 500,
    status, ordered_at: NOW, lab_visit_id: "visit-1", invoice_id: "inv-1", created_at: NOW, updated_at: NOW, ...extra,
  });

beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  for (const id of [LAB, OTHER]) ins("tenants", { id, name: id === LAB ? "Synthetic Diagnostic Lab" : "Other Lab", business_type: "lab", created_at: NOW, updated_at: NOW });
  ins("clinic_patients", { id: "pat-1", tenant_id: LAB, mrn: "MRN-000001", name: "Synthetic Patient", gender: "Male", created_at: NOW, updated_at: NOW });
  ins("lab_visits", { id: "visit-1", tenant_id: LAB, visit_no: "LV-0001", patient_id: "pat-1", referred_by: "Dr. Synthetic", priority: "routine", status: "registered", public_token: TOKEN, created_at: NOW, updated_at: NOW });
  ins("settings", { key: `${LAB}::clinic.print.lab`, value: JSON.stringify({ paper: "a5", design: "hospital-blue", signature: true }), updated_at: NOW });
  ins("settings", { key: `${LAB}::print_logo`, value: "data:image/png;base64,AAAA", updated_at: NOW });
  useAuthStore.setState({
    currentUser: { id: "u", username: "u", displayName: "u", role: "owner", tenantId: LAB, permissions: null },
    currentTenant: { id: LAB, name: "Synthetic Diagnostic Lab", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: [], maxStaffLogins: 5, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "lab" },
  });
});

test("not ready before verification, with the number of tests in progress", async () => {
  order("o1", LAB, "collected");
  order("o2", LAB, "awaiting_verification", { result_value: "99" });
  const r = await getPublicLabVisitReport(sqliteSql(db), TOKEN);
  assert.equal(r.ready, false);
  assert.equal(r.view, null, "an unverified result is never shown");
  assert.equal(r.pending, 2);
  assert.equal(r.visitNo, "LV-0001");
});

test("shows only verified results, with the lab's name, design, paper and logo", async () => {
  order("o1", LAB, "reported", { result_value: "12.1", unit: "g/dL", ref_range: "13-17", flag: "L", verified_by: "Dr. Path", reported_by: "Dr. Path", reported_at: NOW });
  order("o2", LAB, "awaiting_verification", { result_value: "250" });
  order("o3", LAB, "cancelled");
  const r = await getPublicLabVisitReport(sqliteSql(db), TOKEN);
  assert.equal(r.ready, true);
  assert.equal(r.pending, 1, "the cancelled test is not counted");
  assert.deepEqual(r.view!.lab.map((l) => l.value), ["12.1"]);
  assert.equal(r.view!.signedBy, "Verified by: Dr. Path");
  assert.equal(r.view!.info.find((i) => i.label === "Referred by")!.value, "Dr. Synthetic");
  assert.equal(r.profile.name, "Synthetic Diagnostic Lab", "the account name when no profile is saved");
  assert.equal(r.template.design, "hospital-blue");
  assert.equal(r.template.paper, "a5");
  assert.equal(r.logo, "data:image/png;base64,AAAA");
});

test("unknown or malformed tokens are refused", async () => {
  for (const t of ["", "short", "b".repeat(48), "z".repeat(48), "' OR 1=1 --"]) {
    await assert.rejects(getPublicLabVisitReport(sqliteSql(db), t), (e: unknown) => e instanceof HttpError && e.status === 404, t);
  }
});

test("another business's tests never appear, even on the same visit id", async () => {
  order("o1", LAB, "reported", { result_value: "1", reported_at: NOW });
  order("x1", OTHER, "reported", { result_value: "SECRET", reported_at: NOW });
  const r = await getPublicLabVisitReport(sqliteSql(db), TOKEN);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
});

test("a visit gets its token once; the receipt and the report find the same visit", async () => {
  ins("lab_visits", { id: "visit-2", tenant_id: LAB, visit_no: "LV-0002", patient_id: "pat-1", priority: "routine", status: "registered", created_at: NOW, updated_at: NOW });
  order("o9", LAB, "ordered", { lab_visit_id: "visit-2", invoice_id: "inv-2" });
  const first = await ensureLabVisitToken("visit-2");
  assert.match(first!, /^[0-9a-f]{48}$/);
  assert.equal(await ensureLabVisitToken("visit-2"), first, "printing again keeps the same QR");
  assert.equal(await labVisitIdFor({ invoiceId: "inv-2" }), "visit-2");
  assert.equal(await labVisitIdFor({ orderIds: ["o9"] }), "visit-2");
  assert.equal(await ensureLabVisitToken("no-such-visit"), null);
  assert.equal(labReportUrl("https://app.mavin.pk/", first!), `https://app.mavin.pk/lab-report/?t=${first}`);
});

test("the report content is built the same way for print and online", () => {
  const v = buildLabReportView({
    orders: [{ id: "a", order_no: "LAB-1", kind: "lab", name: "CBC", result_value: null, unit: null, ref_range: null, flag: null,
      components: JSON.stringify([{ key: "hb", name: "Hb", group: "Red cells", value: "11", unit: "g/dL", ref_range: "13-17", flag: "L" }]), reported_by: "Tech", reported_at: NOW }],
    patient: { name: "P", mrn: "M", gender: null, dob: null },
    referredBy: null,
    signature: false,
  });
  assert.equal(v.title, "Laboratory Report");
  assert.equal(v.lab[0].parts[0].value, "11");
  assert.equal(v.signedBy, "Reported by: Tech");
});
