/** MAVIN Offline asks MAVIN.pk only when there is a reason to, and a sign-in
 * MAVIN.pk has ended shows the login screen instead of empty screens. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPY_FRESH_MS, RENEW_ALLOWANCE_MS, RENEW_RETRY_MS, copyFresh, syncNeeded } from "../../desktop/src/core/syncPolicy.ts";
import { SESSION_EXPIRED_EVENT, confirmSessionEnded } from "@/lib/serverMode";
import { inTurn } from "@/lib/saveQueue";
import { useAuthStore } from "@/store/authStore";
import { useFormTabs } from "@/store/formTabsStore";

const NOW = Date.parse("2026-11-28T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

test("a computer with nothing waiting asks nothing, until its offline allowance is about to end", () => {
  const idle = { hasUnsent: false, allowanceEndsAt: at(3 * 86_400_000), lastSyncAt: 0, now: NOW };
  assert.equal(syncNeeded(idle), false);
  assert.equal(syncNeeded({ ...idle, hasUnsent: true }), true, "a sale waiting is sent");
  const ending = { ...idle, allowanceEndsAt: at(RENEW_ALLOWANCE_MS - 60_000) };
  assert.equal(syncNeeded(ending), true);
  assert.equal(syncNeeded({ ...ending, lastSyncAt: NOW - RENEW_RETRY_MS + 60_000 }), false, "at most once an hour");
  assert.equal(syncNeeded({ ...idle, allowanceEndsAt: undefined }), false);
});

test("the local copy answers screens only while it has caught up recently", () => {
  assert.equal(copyFresh(NOW - COPY_FRESH_MS, NOW), true);
  assert.equal(copyFresh(NOW - COPY_FRESH_MS - 1, NOW), false);
  assert.equal(copyFresh(0, NOW), false);
});

test("the saved sign-in is read only after the app is ready (Windows encryption is not available before)", () => {
  const main = readFileSync("desktop/src/main.ts", "utf8");
  assert.doesNotMatch(main.replace(/function loadCookies\(\)[\s\S]*?\n}\n/, ""), /secrets\.get\("web-cookies"\)/);
  assert.match(main, /app\.whenReady\(\)\.then\(\(\) => \{[\s\S]{0,200}loadCookies\(\);/);
});

test("the Windows app logs out only when MAVIN.pk confirms the sign-in has ended", async () => {
  const events: string[] = [];
  const had = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { dispatchEvent: (e: Event) => { events.push(e.type); return true; } };
  try {
    const answer = (status: number) => ({ request: async () => ({ ok: true as const, value: { status, body: "{}" } }) });
    await confirmSessionEnded(answer(200));
    await confirmSessionEnded(answer(0));
    await confirmSessionEnded({ request: async () => { throw new Error("offline"); } });
    assert.deepEqual(events, []);
    await confirmSessionEnded(answer(401));
    assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);
  } finally {
    (globalThis as { window?: unknown }).window = had;
  }
});

test("saves made while the next bill is entered run one at a time, in order, and a failed one stops nothing", async () => {
  const order: string[] = [];
  const job = (name: string, ms: number, fail = false) => inTurn(async () => {
    order.push(`start ${name}`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`end ${name}`);
    if (fail) throw new Error(`${name} failed`);
    return name;
  });
  const results = await Promise.allSettled([job("a", 20), job("b", 1, true), job("c", 1)]);
  assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
});

test("a form saving in the background is out of the way, and comes back when it needs the person", () => {
  useAuthStore.setState({ currentUser: { id: "u", username: "o", displayName: "O", role: "owner", tenantId: "t", permissions: null }, currentTenant: { id: "t", name: "T", subscriptionStatus: "active", subscriptionExpiresAt: null, allowedModules: ["invoices", "purchase"], maxStaffLogins: 5, maxInvoicesPerMonth: null, mrpDiscountPct: 0, sourceTenantId: null, businessType: "retail_pharmacy" } });
  const tabs = () => useFormTabs.getState();
  tabs().openNew("invoice");
  const first = tabs().activeId!;
  tabs().saveStarted(first);
  assert.deepEqual([tabs().activeId, tabs().saving], [null, [first]]);
  tabs().activate(first);
  assert.equal(tabs().activeId, null, "a saving form is not opened");
  tabs().openNew("invoice");
  const second = tabs().activeId!;
  assert.notEqual(second, first);
  tabs().cycle(1);
  assert.equal(tabs().activeId, second);
  tabs().needsAttention(first);
  assert.deepEqual([tabs().activeId, tabs().saving], [first, []]);
  tabs().saveStarted(first);
  tabs().close(first);
  assert.deepEqual(tabs().saving, []);
});
