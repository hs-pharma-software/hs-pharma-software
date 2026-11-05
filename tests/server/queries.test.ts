/** Super Admin > Queries: website Contact Us / Book a Demo submissions are
 * saved once, counted as unread, marked read only when opened, and readable
 * only by the Super Admin. Synthetic submissions on the real schema (SQLite). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { checkLead, LeadError } from "@/server/leads";
import { listQueries, openQuery, saveQuery, unreadCount } from "@/server/queries";
import { HttpError } from "@/server/db";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const ADMIN = { userId: "admin-1", role: "super_admin" };
const SUB_SUPER = { userId: "dist-1", role: "staff", platformRole: "distributor" };
const TENANT_OWNER = { userId: "own-1", role: "owner" };
let ip = 0;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
});

/** A visitor's Contact Us submission (a new connection each time, so the rate limit stays out of the way). */
function visitor(over: Record<string, unknown> = {}) {
  return checkLead({
    kind: "contact", name: "Test Visitor", business: "Synthetic Traders", businessType: "General Store POS", phone: "0300 1234567",
    email: "visitor@example.com", workflow: "Line one\nLine two\n\n<b>not bold</b>", topic: "Requesting pricing (Starter)",
    shownAt: Date.now() - 10_000, submissionId: `form-${Math.random().toString(36).slice(2, 12)}`, ...over,
  }, `198.51.100.${++ip}`);
}

test("acceptance: submit, badge 0 -> 1, one unread tile, open shows every field, read, badge back to 0, preserved", async () => {
  assert.equal(await unreadCount(sql, ADMIN), 0);
  const lead = visitor()!;
  await saveQuery(sql, lead);
  assert.equal(await unreadCount(sql, ADMIN), 1, "the badge shows 1");

  const listed = await listQueries(sql, ADMIN);
  assert.equal(listed.rows.length, 1);
  assert.equal(listed.rows[0].status, "unread");
  assert.equal(await unreadCount(sql, ADMIN), 1, "listing the page does not clear anything");

  const opened = await openQuery(sql, ADMIN, String(listed.rows[0].id));
  const q = opened.query!;
  assert.deepEqual(
    [q.name, q.business_name, q.business_type, q.phone, q.email, q.topic, q.kind],
    ["Test Visitor", "Synthetic Traders", "General Store POS", "0300 1234567", "visitor@example.com", "Requesting pricing (Starter)", "contact"],
  );
  assert.equal(q.message, "Line one\nLine two\n\n<b>not bold</b>", "the full message, line breaks kept, stored as typed (shown as plain text)");
  assert.equal(q.status, "read");
  assert.equal(opened.unread, 0, "the badge returns to 0");

  // "Reload": a fresh read of the database keeps the query and its read status.
  const reloaded = await listQueries(sql, ADMIN);
  assert.equal(reloaded.rows.length, 1);
  assert.equal(reloaded.rows[0].status, "read");
});

test("reopening a read query does not change the count again", async () => {
  await saveQuery(sql, visitor()!);
  await saveQuery(sql, visitor({ name: "Second Visitor" })!);
  const [first] = (await listQueries(sql, ADMIN)).rows;
  assert.equal((await openQuery(sql, ADMIN, String(first.id))).unread, 1);
  assert.equal((await openQuery(sql, ADMIN, String(first.id))).unread, 1, "still 1");
  const readAt = db.prepare(`SELECT read_at FROM site_queries WHERE id = ?`).get(String(first.id)) as { read_at: string };
  await openQuery(sql, ADMIN, String(first.id));
  assert.equal((db.prepare(`SELECT read_at FROM site_queries WHERE id = ?`).get(String(first.id)) as { read_at: string }).read_at, readAt.read_at);
});

test("multiple unread queries: newest first, Unread filter and search", async () => {
  await saveQuery(sql, visitor({ name: "Alpha Owner", email: "alpha@example.com" })!, "2026-11-01T08:00:00.000Z");
  await saveQuery(sql, visitor({ name: "Bravo Owner", email: "bravo@example.com", phone: "0311 7654321" })!, "2026-11-03T08:00:00.000Z");
  await saveQuery(sql, visitor({ name: "Charlie Owner", email: "charlie@example.com" })!, "2026-11-02T08:00:00.000Z");
  const all = await listQueries(sql, ADMIN);
  assert.deepEqual(all.rows.map((r) => r.name), ["Bravo Owner", "Charlie Owner", "Alpha Owner"]);
  assert.equal(all.unread, 3);
  await openQuery(sql, ADMIN, String(all.rows[0].id));
  const unread = await listQueries(sql, ADMIN, { filter: "unread" });
  assert.deepEqual(unread.rows.map((r) => r.name), ["Charlie Owner", "Alpha Owner"]);
  assert.deepEqual((await listQueries(sql, ADMIN, { q: "BRAVO@" })).rows.map((r) => r.name), ["Bravo Owner"], "search by email, any case");
  assert.deepEqual((await listQueries(sql, ADMIN, { q: "7654321" })).rows.map((r) => r.name), ["Bravo Owner"], "search by phone");
  assert.deepEqual((await listQueries(sql, ADMIN, { q: "%" })).rows, [], "search wildcards are literal");
});

test("a double-click or a retry saves one query", async () => {
  const sid = "form-retry-12345";
  await saveQuery(sql, visitor({ submissionId: sid })!);
  const again = await saveQuery(sql, visitor({ submissionId: sid })!);
  assert.equal(again.duplicate, true);
  assert.equal(await unreadCount(sql, ADMIN), 1);
  // A page without a form id: identical content is one submission.
  await saveQuery(sql, visitor({ submissionId: undefined, name: "No Id" })!);
  await saveQuery(sql, visitor({ submissionId: undefined, name: "No Id" })!);
  assert.equal(await unreadCount(sql, ADMIN), 2);
});

test("failed submissions save nothing", async () => {
  assert.throws(() => visitor({ name: "", phone: "abc", email: "" }), (e: unknown) => e instanceof LeadError && e.status === 400);
  assert.equal(visitor({ website: "http://spam.example" }), null, "honeypot: dropped, nothing to save");
  assert.equal(visitor({ shownAt: Date.now() }), null, "sent too fast: dropped");
  assert.equal(await unreadCount(sql, ADMIN), 0);
});

test("only the Super Admin can list, count or open queries", async () => {
  await saveQuery(sql, visitor()!);
  const id = String((await listQueries(sql, ADMIN)).rows[0].id);
  for (const who of [SUB_SUPER, TENANT_OWNER, { userId: "x", role: "super_admin", platformRole: "distributor" }]) {
    const denied = (e: unknown) => e instanceof HttpError && e.status === 403;
    await assert.rejects(listQueries(sql, who), denied);
    await assert.rejects(unreadCount(sql, who), denied);
    await assert.rejects(openQuery(sql, who, id), denied);
  }
  assert.equal(await unreadCount(sql, ADMIN), 1, "a refused open does not mark it read");
});
