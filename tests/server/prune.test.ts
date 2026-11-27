/** Nightly clean-up of log tables: oldest rows first, in batches, only those
 * past the cut-off, and a clean table costs one short read. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { sqliteSql } from "./sqliteSql.ts";
import { pruneOldest } from "@/server/prune";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-27T00:00:00.000Z");

function logDb(ages: number[]) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE server_audit_log (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`);
  const ins = db.prepare(`INSERT INTO server_audit_log (id, created_at) VALUES (?, ?)`);
  ages.forEach((age, i) => ins.run(`r${i}`, new Date(NOW - age * DAY).toISOString()));
  return db;
}
const left = (db: DatabaseSync) => (db.prepare(`SELECT COUNT(*) AS n FROM server_audit_log`).get() as { n: number }).n;

test("removes only rows past the cut-off, across several batches", async () => {
  // 25 rows a year old, then 5 recent ones (written in time order).
  const db = logDb([...Array(25).fill(365), ...Array(5).fill(1)]);
  const r = await pruneOldest(sqliteSql(db), "server_audit_log", "created_at", 180, { batch: 10, now: NOW });
  assert.deepEqual(r, { removed: 25, more: false });
  assert.equal(left(db), 5);
});

test("a clean table: nothing removed, nothing more to do", async () => {
  const db = logDb(Array(30).fill(2));
  assert.deepEqual(await pruneOldest(sqliteSql(db), "server_audit_log", "created_at", 180, { batch: 10, now: NOW }), { removed: 0, more: false });
  assert.equal(left(db), 30);
});

test("stops when its time is up and says there is more", async () => {
  const db = logDb(Array(50).fill(365));
  const r = await pruneOldest(sqliteSql(db), "server_audit_log", "created_at", 180, { batch: 10, budgetMs: -1, now: NOW });
  assert.deepEqual(r, { removed: 10, more: true });
  assert.equal(left(db), 40);
});
