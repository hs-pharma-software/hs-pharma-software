/** Step 5: staff HR records through the server. HR sees and changes them in
 * full, the quality team reads them, everyone else sees only their own and
 * can only acknowledge their own appraisal. Run on a real database with the
 * same rewrite and policy the server uses. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { scopeStatement, ScopeError, type Schema, type Scope } from "@/server/tenantScope";
import { analyzeSql, authorize, personalScope, hrAccess, type Caller } from "@/server/sqlPolicy";

let db: DatabaseSync;
let schema: Schema;
let known: Set<string>;
const NOW = "2026-10-25T00:00:00.000Z";

function seed() {
  db = fullSchemaDb();
  const ins = (t: string, r: Record<string, unknown>) => {
    const k = Object.keys(r);
    db.prepare(`INSERT INTO ${t} (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(k.map((x) => r[x]) as never[]));
  };
  for (const [id, t, u] of [["s-nurse", "hosp-a", "u-nurse"], ["s-other", "hosp-a", "u-other"], ["s-b", "hosp-b", "u-nurse"]]) {
    ins("staff", { id, tenant_id: t, name: id, user_id: u, opening_balance: 0, balance_type: "payable", basic_pay: 0, created_at: NOW, updated_at: NOW });
  }
  for (const [id, t, s] of [["ap-nurse", "hosp-a", "s-nurse"], ["ap-other", "hosp-a", "s-other"], ["ap-b", "hosp-b", "s-b"]]) {
    ins("hospital_appraisals", { id, tenant_id: t, staff_id: s, period_from: "2025-10-01", period_to: "2026-09-30", status: "final", ratings: "{}", created_at: NOW, updated_at: NOW });
    ins("hospital_staff_credentials", { id: `cr-${id}`, tenant_id: t, staff_id: s, kind: "CNIC", created_at: NOW, updated_at: NOW });
  }
  schema = new Map();
  for (const r of db.prepare(`SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'`).all() as { t: string; c: string }[]) {
    if (!schema.has(r.t)) schema.set(r.t, new Set());
    schema.get(r.t)!.add(r.c);
  }
  known = new Set(schema.keys());
}
beforeEach(seed);

const caller = (userId: string, permissions: string[] | null): Caller => ({ userId, role: permissions ? "staff" : "owner", tenantId: "hosp-a", permissions, businessType: "hospital" });
const NURSE = caller("u-nurse", ["hospital_patients", "hospital_episodes"]);
const HR = caller("u-hr", ["hospital_hr"]);
const QM = caller("u-qm", ["hospital_quality", "hospital_facility"]);
const OWNER = caller("owner", null);

/** What the server does: policy check, then the rewrite, then run it. */
function serve(c: Caller, sql: string, args: unknown[] = []) {
  const d = authorize(analyzeSql(sql), c, known);
  if (!d.ok) throw new Error(d.reason);
  const s: Scope = { tenantId: c.tenantId!, sharedGroups: [], linkedPharmacies: [], personal: personalScope(c) };
  const stmt = db.prepare(scopeStatement(sql, args, s, schema));
  return /^\s*select/i.test(sql) ? (stmt.all(...(args as never[])) as { id: string }[]).map((r) => r.id).sort() : Number(stmt.run(...(args as never[])).changes);
}

test("who has which access", () => {
  assert.equal(hrAccess(OWNER), "full");
  assert.equal(hrAccess(HR), "full");
  assert.equal(hrAccess(QM), "read");
  assert.equal(hrAccess(NURSE), "own");
  assert.equal(personalScope(HR), undefined);
});

test("reads: HR and the quality team see the business's HR records, other staff only their own", () => {
  assert.deepEqual(serve(HR, "SELECT * FROM hospital_appraisals"), ["ap-nurse", "ap-other"]);
  assert.deepEqual(serve(QM, "SELECT * FROM hospital_appraisals"), ["ap-nurse", "ap-other"]);
  assert.deepEqual(serve(NURSE, "SELECT * FROM hospital_appraisals"), ["ap-nurse"], "not another nurse's, not the other hospital's");
  assert.deepEqual(serve(NURSE, "SELECT * FROM hospital_appraisals WHERE staff_id = ? OR 1=1", ["s-other"]), ["ap-nurse"], "OR 1=1 does not escape");
  assert.deepEqual(serve(NURSE, "SELECT * FROM hospital_staff_credentials"), ["cr-ap-nurse"]);
  assert.deepEqual(serve(NURSE, "SELECT a.id FROM staff s JOIN hospital_appraisals a ON a.staff_id = s.id"), ["ap-nurse"], "joins are limited too");
});

test("writes: staff only acknowledge their own appraisal; nothing else", () => {
  assert.equal(serve(NURSE, "UPDATE hospital_appraisals SET status = ?, acknowledged_at = ?, staff_comments = ?, updated_at = ? WHERE id = ? AND tenant_id = ?", ["acknowledged", NOW, "ok", NOW, "ap-nurse", "hosp-a"]), 1);
  assert.equal(serve(NURSE, "UPDATE hospital_appraisals SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?", ["acknowledged", NOW, "ap-other", "hosp-a"]), 0, "someone else's appraisal is untouched");
  assert.throws(() => serve(NURSE, "UPDATE hospital_appraisals SET overall = ?, updated_at = ? WHERE id = ?", [5, NOW, "ap-nurse"]), ScopeError, "scores cannot be changed");
  assert.throws(() => serve(NURSE, "INSERT INTO hospital_appraisals (id, tenant_id, staff_id, period_from, period_to, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["x", "hosp-a", "s-nurse", "a", "b", "final", NOW, NOW]), /changed by HR/);
  assert.throws(() => serve(NURSE, "UPDATE hospital_staff_credentials SET verified_on = ? WHERE id = ?", [NOW, "cr-ap-nurse"]), /changed by HR/, "nobody verifies their own credential");
  assert.throws(() => serve(QM, "UPDATE hospital_staff_credentials SET verified_on = ? WHERE id = ?", [NOW, "cr-ap-other"]), /changed by HR/);
  assert.doesNotThrow(() => serve(QM, "INSERT INTO hospital_staff_training (id, tenant_id, staff_id, kind, held_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["t1", "hosp-a", "s-nurse", "bls", "2026-10-01", NOW, NOW]), "the quality team records training");
  assert.equal(serve(HR, "UPDATE hospital_appraisals SET overall = ?, updated_at = ? WHERE id = ?", [4, NOW, "ap-other"]), 1, "HR changes any appraisal of the business");
  assert.equal(serve(HR, "UPDATE hospital_appraisals SET overall = ?, updated_at = ? WHERE id = ?", [4, NOW, "ap-b"]), 0, "but not another hospital's");
});
