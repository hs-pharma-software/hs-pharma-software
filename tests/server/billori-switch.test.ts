/** Billori off: the server refuses the assistant for that business, and the
 * app's switch state reads "off" (no chat button); on again restores both. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { setTestDb } from "../shims/db.ts";
import { pickAiConfig } from "@/server/ai";
import { useBillori } from "@/lib/billoriState";

const T = "2026-11-07T10:00:00.000Z";
let db: DatabaseSync;
beforeEach(() => {
  db = fullSchemaDb();
  setTestDb(db);
  useBillori.setState({ tenantId: null, enabled: null });
});

test("server: a business with Billori off gets no assistant; on (or never set) gets it", () => {
  const s = new Map([["billori_api_key", "k-test"], ["ta::billori_enabled", "false"]]);
  assert.equal(pickAiConfig("ta", s), null, "off for business A");
  assert.ok(pickAiConfig("tb", s), "business B unaffected");
  s.set("ta::billori_enabled", "true");
  assert.ok(pickAiConfig("ta", s));
});

test("app: unknown until read (no flash); off hides, on shows; another business starts unknown", async () => {
  assert.equal(useBillori.getState().enabled, null);
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('ta::billori_enabled', 'false', ?)`).run(T);
  await useBillori.getState().load("ta");
  assert.equal(useBillori.getState().enabled, false);
  useBillori.getState().set("ta", true);
  assert.equal(useBillori.getState().enabled, true, "switching on in Settings updates at once");
  // A business without the setting: on (same rule as the server).
  const pending = useBillori.getState().load("tb");
  assert.equal(useBillori.getState().enabled, null, "not the previous business's value while loading");
  await pending;
  assert.equal(useBillori.getState().enabled, true);
});
