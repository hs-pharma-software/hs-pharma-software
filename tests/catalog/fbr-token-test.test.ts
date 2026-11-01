/** Testing an FBR token on the validate endpoint of its environment: nothing
 * is recorded; 401 means FBR does not accept the token there. */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { testFbrToken } from "@/lib/fbr";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function fakeFbr(status: number) {
  const calls: { url: string; auth: string | null }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization") });
    return new Response(JSON.stringify({ validationResponse: { statusCode: "01", error: "Invalid invoice" } }), { status });
  }) as typeof fetch;
  return calls;
}

test("an accepted token: validate endpoint of the environment, with the token", async () => {
  const calls = fakeFbr(200);
  const r = await testFbrToken("  abc123 ", "sandbox");
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb");
  assert.equal(calls[0].auth, "Bearer abc123");
  await testFbrToken("prod", "production");
  assert.equal(calls[1].url, "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata");
});

test("a rejected token, a server error, no token, no connection", async () => {
  fakeFbr(401);
  assert.match((await testFbrToken("bad", "production")).message, /rejected this token for production/);
  fakeFbr(503);
  assert.equal((await testFbrToken("x", "sandbox")).ok, false);
  assert.match((await testFbrToken(" ", "sandbox")).message, /Enter the sandbox token/);
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  assert.match((await testFbrToken("x", "sandbox")).message, /Could not reach FBR/);
});
