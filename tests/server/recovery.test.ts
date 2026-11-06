/** Password recovery: codes by email for a username, email or mobile; the
 * same answer whether or not an account exists; limits on tries and
 * requests; a used or older code never works; recovery contacts are set
 * only by the login itself (with its password), its owner or the Super Admin.
 * Made-up logins on the real schema; a fake mailer (no email is sent). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { passwordHash } from "@/server/db";
import {
  CODES_PER_LOGIN, MAX_TRIES, RECOVERY_MESSAGE, completeReset, getContact, maskEmail, maskMobile, normalizeEmail, normalizeMobile, requestReset, resetRateLimits, setContact,
} from "@/server/recovery";
import type { Mail } from "@/server/mailer";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const NOW = new Date("2026-11-06T10:00:00.000Z");
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;

function addUser(id: string, username: string, o: { tenant?: string | null; role?: string; email?: string | null; mobile?: string | null; active?: number; password?: string } = {}) {
  const salt = randomBytes(8).toString("hex");
  db.prepare(`INSERT INTO users (id, tenant_id, username, password_hash, password_salt, role, is_active, email, mobile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, o.tenant === undefined ? "t1" : o.tenant, username, passwordHash(o.password ?? "old-pass", salt), salt, o.role ?? "staff", o.active ?? 1, o.email ?? null, o.mobile ?? null, NOW.toISOString(), NOW.toISOString());
}
const passwordIs = (id: string, pw: string) => {
  const r = one(`SELECT password_hash, password_salt FROM users WHERE id = ?`, id);
  return passwordHash(pw, String(r.password_salt)) === r.password_hash;
};

function mailbox() {
  const sent: Mail[] = [];
  return { sent, send: async (m: Mail) => { sent.push(m); }, code: () => /\b(\d{6})\b/.exec(sent[sent.length - 1]?.text ?? "")?.[1] ?? "" };
}

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
  resetRateLimits();
  for (const t of ["t1", "t2"]) {
    try { db.prepare(`INSERT INTO tenants (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(t, `Shop ${t}`, NOW.toISOString(), NOW.toISOString()); } catch { /* tenants may need more columns; users do not enforce the link here */ }
  }
  addUser("u-ali", "ali", { email: "ali@example.com", mobile: "+923001234567" });
  addUser("u-owner", "owner1", { role: "owner", email: "owner@example.com" });
  addUser("u-other", "otherstaff", { tenant: "t2", email: "other@example.com" });
  addUser("u-nomail", "nomail", { mobile: "+923331112222" });
  addUser("u-off", "inactive", { email: "off@example.com", active: 0 });
  addUser("u-admin", "admin", { tenant: null, role: "super_admin", email: "admin@example.com" });
});

test("contacts are normalised: Pakistani mobiles, emails; bad input is refused", () => {
  for (const m of ["03001234567", "0300-1234567", "923001234567", "+92 300 1234567", "00923001234567"]) assert.equal(normalizeMobile(m), "+923001234567", m);
  assert.equal(normalizeMobile("+447700900123"), "+447700900123");
  assert.equal(normalizeMobile(""), null);
  assert.throws(() => normalizeMobile("12345"), /03001234567/);
  assert.equal(normalizeEmail(" Ali@Example.COM "), "ali@example.com");
  assert.throws(() => normalizeEmail("not-an-email"), /valid email/);
  assert.equal(maskEmail("ali@example.com"), "a**@example.com");
  assert.equal(maskMobile("+923001234567"), "+923******567");
});

test("a code is emailed for a username, an email or a mobile; the answer never reveals an account", async () => {
  for (const id of ["ali", "ALI@example.com", "0300-1234567"]) {
    resetRateLimits();
    db.prepare(`DELETE FROM password_resets`).run();
    const box = mailbox();
    const r = await requestReset(sql, id, "1.1.1.1", { send: box.send, now: NOW });
    assert.equal(r.message, RECOVERY_MESSAGE);
    assert.match(r.requestId, /^[0-9a-f]{32}$/);
    assert.equal(box.sent.length, 1, id);
    assert.equal(box.sent[0].to, "ali@example.com");
    assert.match(box.sent[0].subject, /^\d{6} is your MAVIN\.pk reset code$/);
    assert.match(box.sent[0].text, /for the login "ali"/);
    assert.equal(one(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id = 'u-ali'`).n, 1);
  }
  // Nothing matches / inactive / no email: the same answer, nothing sent, nothing stored.
  for (const id of ["nobody", "nobody@example.com", "03009999999", "inactive", "nomail", "03331112222"]) {
    const box = mailbox();
    const r = await requestReset(sql, id, "2.2.2.2", { send: box.send, now: NOW });
    assert.equal(r.message, RECOVERY_MESSAGE, id);
    assert.equal(box.sent.length, 0, id);
  }
  assert.equal(one(`SELECT COUNT(*) AS n FROM password_resets WHERE user_id != 'u-ali'`).n, 0);
  // Not set up: says so (the same for everyone).
  await assert.rejects(requestReset(sql, "ali", "3.3.3.3", { send: null, now: NOW }), /not set up/);
});

test("an email shared by several logins gets the usernames, not a code", async () => {
  addUser("u-ali2", "ali.cashier", { email: "ali@example.com" });
  const box = mailbox();
  await requestReset(sql, "ali@example.com", "1.1.1.1", { send: box.send, now: NOW });
  assert.equal(box.sent.length, 1);
  assert.match(box.sent[0].subject, /Choose which/);
  assert.match(box.sent[0].text, /- ali\n- ali\.cashier|- ali\.cashier\n- ali/);
  assert.equal(one(`SELECT COUNT(*) AS n FROM password_resets`).n, 0);
});

test("the right code sets the new password once; wrong, old, expired and reused codes fail", async () => {
  const box = mailbox();
  const first = await requestReset(sql, "ali", "1.1.1.1", { send: box.send, now: NOW });
  const firstCode = box.code();
  const second = await requestReset(sql, "ali", "1.1.1.1", { send: box.send, now: later(1) });
  const code = box.code();
  await assert.rejects(completeReset(sql, first.requestId, firstCode, "new-pass", { now: later(2) }), /wrong or has expired/, "an older code stops working");
  await assert.rejects(completeReset(sql, second.requestId, code, "abc", { now: later(2) }), /at least 4/);
  await assert.rejects(completeReset(sql, second.requestId, "12ab56", "new-pass", { now: later(2) }), /6-digit/);
  await assert.rejects(completeReset(sql, second.requestId, code, "new-pass", { now: later(12) }), /expired/);

  const third = await requestReset(sql, "ali", "1.1.1.1", { send: box.send, now: later(3) });
  const good = box.code();
  const wrong = good === "000000" ? "111111" : "000000";
  await assert.rejects(completeReset(sql, third.requestId, wrong, "new-pass", { now: later(4) }), /wrong/);
  const r = await completeReset(sql, third.requestId, good, "new-pass", { now: later(4) });
  assert.equal(r.username, "ali");
  assert.ok(passwordIs("u-ali", "new-pass"));
  assert.equal(one(`SELECT password_changed_at FROM users WHERE id = 'u-ali'`).password_changed_at, later(4).toISOString());
  await assert.rejects(completeReset(sql, third.requestId, good, "again-pass", { now: later(5) }), /wrong or has expired/, "used once only");
  assert.ok(passwordIs("u-ali", "new-pass"));
  await assert.rejects(completeReset(sql, "not-a-request", good, "new-pass"), /wrong or has expired/);
});

test("five wrong codes end the code; codes per login and requests per address are limited", async () => {
  const box = mailbox();
  const r = await requestReset(sql, "ali", "1.1.1.1", { send: box.send, now: NOW });
  const good = box.code();
  const wrong = good === "000000" ? "111111" : "000000";
  for (let i = 1; i < MAX_TRIES; i++) await assert.rejects(completeReset(sql, r.requestId, wrong, "new-pass", { now: later(1) }), /wrong/);
  await assert.rejects(completeReset(sql, r.requestId, wrong, "new-pass", { now: later(1) }), /Too many wrong codes/);
  await assert.rejects(completeReset(sql, r.requestId, good, "new-pass", { now: later(1) }), /wrong or has expired/, "even the right code is dead now");
  assert.ok(passwordIs("u-ali", "old-pass"));

  for (let i = 1; i < CODES_PER_LOGIN; i++) await requestReset(sql, "ali", "1.1.1.1", { send: box.send, now: later(i) });
  const before = box.sent.length;
  await requestReset(sql, "ali", "1.1.1.1", { send: box.send, now: later(5) });
  assert.equal(box.sent.length, before, "no more codes for this login for now");
  await requestReset(sql, "ali", "1.1.1.1", { send: box.send, now: later(40) });
  assert.equal(box.sent.length, before + 1, "allowed again after the window");

  resetRateLimits();
  for (let i = 0; i < 10; i++) await requestReset(sql, "nobody", "9.9.9.9", { send: box.send, now: NOW });
  await assert.rejects(requestReset(sql, "nobody", "9.9.9.9", { send: box.send, now: NOW }), /Too many requests/);
});

test("a failed email retires the code and says so", async () => {
  await assert.rejects(requestReset(sql, "ali", "1.1.1.1", { send: async () => { throw new Error("down"); }, now: NOW }), /could not be emailed/);
  assert.ok(one(`SELECT used_at FROM password_resets WHERE user_id = 'u-ali'`).used_at);
});

test("recovery contacts: own (with password), owner for their business, Super Admin; nobody else", async () => {
  const staff: Caller = { userId: "u-ali", role: "staff", tenantId: "t1" };
  const owner: Caller = { userId: "u-owner", role: "owner", tenantId: "t1" };
  const admin: Caller = { userId: "u-admin", role: "super_admin", tenantId: null };
  await assert.rejects(setContact(sql, staff, "u-ali", { email: "new@example.com" }), /current password/);
  await assert.rejects(setContact(sql, staff, "u-ali", { email: "new@example.com", currentPassword: "wrong" }), /current password/);
  assert.deepEqual(await setContact(sql, staff, "u-ali", { email: "New@Example.com", mobile: "0300 7654321", currentPassword: "old-pass" }), { email: "new@example.com", mobile: "+923007654321" });
  await assert.rejects(setContact(sql, staff, "u-owner", { email: "x@example.com" }), /cannot change/);
  await setContact(sql, owner, "u-nomail", { email: "cashier@example.com", mobile: "" });
  assert.deepEqual(await getContact(sql, owner, "u-nomail"), { email: "cashier@example.com", mobile: null });
  await assert.rejects(setContact(sql, owner, "u-other", { email: "x@example.com" }), /cannot change/, "another business");
  await assert.rejects(setContact(sql, owner, "u-admin", { email: "x@example.com" }), /cannot change/);
  await assert.rejects(setContact(sql, owner, "u-nomail", { mobile: "123" }), /03001234567/);
  await setContact(sql, admin, "u-other", { email: "fixed@example.com" });
  assert.equal(one(`SELECT email FROM users WHERE id = 'u-other'`).email, "fixed@example.com");
});

test("the reset table is never reachable from the browser", () => {
  const owner: Caller = { userId: "u-owner", role: "owner", tenantId: "t1" };
  const tables = new Set(["password_resets", "users"]);
  for (const q of ["SELECT * FROM password_resets", "DELETE FROM password_resets"]) {
    const d = authorize(analyzeSql(q), owner, tables);
    assert.equal(d.ok, false, q);
  }
});
