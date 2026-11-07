/** Free trial (demo account): 3 days, then paused; the owner confirms and the
 * plan's full term starts, once; staff and other businesses cannot. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { confirmTrial } from "@/server/trial";
import { TRIAL_DAYS, trialState } from "@/lib/subscription";
import type { Caller } from "@/server/sqlPolicy";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const T = "2026-11-07T10:00:00.000Z";
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  db.prepare(`INSERT INTO subscription_plans (id, name, price, duration_days, allowed_modules, max_staff_logins, created_at, updated_at) VALUES ('pl', 'Pharmacy Basic', 2500, 30, '[]', 2, ?, ?)`).run(T, T);
  db.prepare(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, subscription_started_at, subscription_expires_at, created_at, updated_at) VALUES ('t1', 'Trial Shop', 'pl', 'trial', ?, '2026-11-10T10:00:00.000Z', ?, ?)`).run(T, T, T);
  db.prepare(`INSERT INTO tenants (id, name, subscription_plan_id, subscription_status, created_at, updated_at) VALUES ('t2', 'Paid Shop', 'pl', 'active', ?, ?)`).run(T, T);
});

test("trial state: days left, then ended; other statuses are not trials", () => {
  assert.equal(TRIAL_DAYS, 3);
  assert.deepEqual(trialState("trial", "2026-11-10T10:00:00.000Z", new Date(T)), { trial: true, ended: false, endsOn: "2026-11-10", daysLeft: 3 });
  assert.deepEqual(trialState("trial", "2026-11-10T10:00:00.000Z", new Date("2026-11-10T10:00:01.000Z")), { trial: true, ended: true, endsOn: "2026-11-10", daysLeft: 0 });
  assert.deepEqual(trialState("active", "2026-11-10T10:00:00.000Z"), { trial: false });
});

test("the owner confirms: active on the plan for a full term from now, once; the Super Admin is told", async () => {
  const owner: Caller = { userId: "u1", role: "owner", tenantId: "t1" };
  const now = new Date("2026-11-12T08:00:00.000Z");
  const r = await confirmTrial(sql, owner, now);
  assert.equal(r.plan, "Pharmacy Basic");
  const t = one(`SELECT subscription_status, subscription_started_at, subscription_expires_at FROM tenants WHERE id = 't1'`);
  assert.equal(t.subscription_status, "active");
  assert.equal(t.subscription_started_at, now.toISOString());
  assert.equal(t.subscription_expires_at, "2026-12-12T08:00:00.000Z", "30-day plan term from confirmation (even after the trial ended)");
  const q = one(`SELECT topic, business_name, message FROM site_queries`);
  assert.equal(q.topic, "trial-confirmed");
  assert.match(String(q.message), /Trial Shop continues on Pharmacy Basic/);
  await assert.rejects(confirmTrial(sql, owner, now), /not on a trial/);
});

test("only the owner of a trial business can confirm", async () => {
  await assert.rejects(confirmTrial(sql, { userId: "s1", role: "staff", tenantId: "t1" }), /Only the business owner/);
  await assert.rejects(confirmTrial(sql, { userId: "u2", role: "owner", tenantId: "t2" }), /not on a trial/);
  await assert.rejects(confirmTrial(sql, { userId: "a", role: "super_admin", tenantId: null }), /Only the business owner/);
  assert.equal(one(`SELECT subscription_status FROM tenants WHERE id = 't1'`).subscription_status, "trial");
});
