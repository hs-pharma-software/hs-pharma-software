/** Super Admin mail (fake Resend, no network), grace periods and enquiry
 * retention. Webhooks need a valid signature; mail is stored once per
 * mailbox and only for our own addresses; sending goes from the mailbox. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { fullSchemaDb } from "../catalog/fullDb.ts";
import { sqliteSql } from "./sqliteSql.ts";
import { addressOf, createMailbox, getMessage, handleWebhook, listMailboxes, listMessages, removeMailbox, sendMail, setFlags, syncInbox, verifyWebhook } from "@/server/mail";
import { subscriptionPhase } from "@/lib/subscription";
import { runJob } from "@/server/seo/engine";
import { SEO_JOBS } from "@/server/seo/jobs";
import { analyzeSql, authorize, type Caller } from "@/server/sqlPolicy";
import type { Http } from "@/server/seo/google";
import type { Sql } from "@/server/subSupers";

let db: DatabaseSync;
let sql: Sql;
const one = (q: string, ...a: unknown[]) => db.prepare(q).get(...(a as never[])) as Record<string, unknown>;

beforeEach(() => {
  db = fullSchemaDb();
  sql = sqliteSql(db);
});

const SECRET = `whsec_${Buffer.from("test-webhook-secret-bytes-123456").toString("base64")}`;
const sign = (id: string, ts: string, body: string) => `v1,${createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;

function fakeResend() {
  const sent: Record<string, unknown>[] = [];
  const store: Record<string, unknown> = {
    e1: { id: "e1", from: "Ali <ali@example.com>", to: ["info@mavin.pk"], cc: [], subject: "Price list?", text: "Please send prices.", html: "<p>Please send prices.</p><script>x()</script>", message_id: "<m1@example.com>", created_at: "2026-11-07T08:00:00.000Z", attachments: [{ id: "a1", filename: "list.pdf", content_type: "application/pdf", size: 2048 }] },
    e2: { id: "e2", from: "researcher@example.org", to: ["security@mavin.pk", "info@mavin.pk"], subject: "Report", text: "Found an issue.", created_at: "2026-11-07T09:00:00.000Z" },
    e3: { id: "e3", from: "spam@example.net", to: ["nobody@mavin.pk"], subject: "Hi", text: "x", created_at: "2026-11-07T10:00:00.000Z" },
  };
  const http: Http = async (url, init) => {
    assert.equal(init.headers?.Authorization, "Bearer re_test");
    const path = url.replace("https://api.resend.com", "");
    if (init.method === "GET" && path.startsWith("/emails/receiving?")) return { status: 200, json: { object: "list", has_more: false, data: Object.values(store).map((m) => ({ ...(m as object), html: undefined, text: undefined })) } };
    const m = /^\/emails\/receiving\/(.+)$/.exec(path);
    if (init.method === "GET" && m) return store[m[1]] ? { status: 200, json: store[m[1]] } : { status: 404, json: { message: "Not found" } };
    if (init.method === "POST" && path === "/emails") { sent.push(JSON.parse(init.body ?? "{}")); return { status: 200, json: { id: `sent-${sent.length}` } }; }
    return { status: 404, json: {} };
  };
  return { http, sent };
}
const deps = (f: ReturnType<typeof fakeResend>) => ({ http: f.http, apiKey: "re_test" });

test("webhook signatures: valid accepted; tampered, wrong secret, or old rejected", () => {
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign("msg_1", ts, body);
  assert.ok(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, SECRET));
  assert.ok(verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: `v1,bogus ${sig}` }, SECRET), "any of several signatures");
  assert.ok(!verifyWebhook(body + " ", { id: "msg_1", timestamp: ts, signature: sig }, SECRET));
  assert.ok(!verifyWebhook(body, { id: "msg_2", timestamp: ts, signature: sig }, SECRET));
  assert.ok(!verifyWebhook(body, { id: "msg_1", timestamp: ts, signature: sig }, `whsec_${Buffer.from("other").toString("base64")}`));
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  assert.ok(!verifyWebhook(body, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, SECRET));
  assert.ok(!verifyWebhook(body, { id: null, timestamp: ts, signature: sig }, SECRET));
});

test("received mail is stored once per mailbox, only for our addresses", async () => {
  const f = fakeResend();
  assert.deepEqual((await listMailboxes(sql)).map((b) => b.address), ["info@mavin.pk", "security@mavin.pk"]);
  assert.deepEqual(await handleWebhook(sql, { type: "email.received", data: { email_id: "e1", to: ["info@mavin.pk"], from: "ali@example.com" } }, deps(f)), { stored: 1 });
  assert.deepEqual(await handleWebhook(sql, { type: "email.received", data: { email_id: "e1", to: ["info@mavin.pk"] } }, deps(f)), { stored: 0 }, "a retried webhook");
  assert.deepEqual(await handleWebhook(sql, { type: "email.received", data: { email_id: "e3", to: ["nobody@mavin.pk"] } }, deps(f)), { stored: 0 }, "not one of our mailboxes");
  assert.deepEqual(await handleWebhook(sql, { type: "email.sent", data: { email_id: "e2" } }, deps(f)), { stored: 0 });
  const r = await syncInbox(sql, deps(f));
  assert.deepEqual(r, { checked: 3, stored: 2 }, "e2 for both info@ and security@");
  const info = await listMessages(sql, "mailbox-info", {});
  assert.deepEqual(info.map((m) => m.subject).sort(), ["Price list?", "Report"]);
  assert.equal(info.find((m) => m.subject === "Price list?")!.attachments, 1);
  assert.equal((await listMailboxes(sql)).find((b) => b.address === "info@mavin.pk")!.unread, 2);
  const full = await getMessage(sql, info.find((m) => m.subject === "Price list?")!.id);
  assert.match(full.html!, /<script>/, "kept as received; the page shows it sandboxed with scripts off");
  assert.equal((await listMailboxes(sql)).find((b) => b.address === "info@mavin.pk")!.unread, 1, "opening marks it read");
  await setFlags(sql, full.id, { archived: true });
  assert.equal((await listMessages(sql, "mailbox-info", { folder: "archived" })).length, 1);
  assert.equal((await listMessages(sql, "mailbox-info", { q: "issue" }))[0].subject, "Report");
  assert.equal(addressOf("Ali <ALI@Example.com>"), "ali@example.com");
});

test("sending from a mailbox, replies threaded; addresses validated; not connected says so", async () => {
  const f = fakeResend();
  await syncInbox(sql, deps(f));
  const orig = (await listMessages(sql, "mailbox-info", {})).find((m) => m.subject === "Price list?")!;
  await sendMail(sql, "admin:1", { mailboxId: "mailbox-info", to: "ali@example.com", subject: "Re: Price list?", body: "Attached <b>soon</b>.", replyTo: orig.id }, deps(f));
  const s = f.sent[0];
  assert.equal(s.from, "MAVIN.pk <info@mavin.pk>");
  assert.deepEqual(s.to, ["ali@example.com"]);
  assert.deepEqual(s.headers, { "In-Reply-To": "<m1@example.com>", References: "<m1@example.com>" });
  assert.match(String(s.html), /Attached &lt;b&gt;soon&lt;\/b&gt;/, "plain text is escaped in the HTML part");
  assert.equal((await listMessages(sql, "mailbox-info", { folder: "sent" }))[0].subject, "Re: Price list?");
  await assert.rejects(sendMail(sql, "a", { mailboxId: "mailbox-info", to: "not an address", subject: "x", body: "y" }, deps(f)), /not a valid email/);
  await assert.rejects(sendMail(sql, "a", { mailboxId: "mailbox-info", to: "a@b.pk", subject: "", body: "y" }, deps(f)), /subject/);
  await assert.rejects(sendMail(sql, "a", { mailboxId: "mailbox-info", to: "a@b.pk", subject: "x", body: "y" }, { http: f.http, apiKey: null }), /RESEND_API_KEY/);
});

test("mailboxes: create on mavin.pk only, no duplicates; info@ and security@ stay", async () => {
  assert.deepEqual(await createMailbox(sql, "Sales", "MAVIN.pk Sales"), { address: "sales@mavin.pk" });
  await assert.rejects(createMailbox(sql, "sales", ""), /already exists/);
  await assert.rejects(createMailbox(sql, "bad name!", ""), /letters, digits/);
  assert.deepEqual(await createMailbox(sql, "support@mavin.pk", ""), { address: "support@mavin.pk" });
  await assert.rejects(removeMailbox(sql, "mailbox-info"), /cannot be removed/);
  const sales = (await listMailboxes(sql)).find((b) => b.address === "sales@mavin.pk")!;
  await removeMailbox(sql, sales.id);
  assert.ok(!(await listMailboxes(sql)).some((b) => b.address === "sales@mavin.pk"));
});

test("mail and plan add-on tables: mail never reachable from the browser's SQL route", () => {
  const admin: Caller = { userId: "a", role: "super_admin", tenantId: null };
  const tables = new Set(["mail_messages", "mail_mailboxes", "plan_addons"]);
  assert.equal(authorize(analyzeSql("SELECT * FROM mail_messages"), admin, tables).ok, false);
  assert.equal(authorize(analyzeSql("SELECT * FROM plan_addons"), admin, tables).ok, true);
});

test("grace period: active, then grace with days left, then ended", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  assert.deepEqual(subscriptionPhase(null, 7, now), { phase: "none" });
  assert.deepEqual(subscriptionPhase("2026-12-01T00:00:00Z", 7, now), { phase: "active" });
  assert.deepEqual(subscriptionPhase("2026-11-05T00:00:00Z", 7, now), { phase: "grace", endedOn: "2026-11-05", graceUntil: "2026-11-12", daysLeft: 5 });
  assert.deepEqual(subscriptionPhase("2026-10-01T00:00:00Z", 7, now), { phase: "ended", endedOn: "2026-10-01", graceUntil: "2026-10-08" });
  assert.equal(subscriptionPhase("2026-11-05T00:00:00Z", 0, now).phase, "ended", "no grace");
});

test("enquiries older than 12 months are deleted monthly", async () => {
  const add = (created: string) => db.prepare(`INSERT INTO site_queries (id, submission_key, kind, name, created_at) VALUES (?, ?, 'contact', 'X', ?)`).run(randomUUID(), randomUUID(), created);
  add("2025-10-01T00:00:00.000Z");
  add("2026-10-01T00:00:00.000Z");
  const r = await runJob(sql, SEO_JOBS, "data_retention", "manual", "admin:1", { sleep: async () => {}, now: new Date("2026-11-07T00:00:00Z") });
  assert.equal(r.status, "succeeded");
  assert.equal(one(`SELECT COUNT(*) AS n FROM site_queries`).n, 1);
});
