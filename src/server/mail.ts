/** Super Admin > Mail: mailboxes on mavin.pk (info@, security@, and any the
 * Super Admin adds), received and sent through Resend.
 *
 * Receiving: Resend accepts mail for the domain (MX record) and calls our
 * webhook with an `email.received` event (metadata only). The webhook is
 * verified with its Svix signature, then the full message is fetched from
 * Resend's API and stored, once per mailbox (unique provider id). "Check for
 * new mail" does the same from Resend's list, so nothing depends on the
 * webhook alone. Mail for addresses that are not a mailbox here is ignored.
 * Sending: Resend's send API, from the mailbox's address.
 * The API key and webhook secret stay on the server. */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpError } from "./db";
import type { Sql } from "./subSupers";
import { defaultHttp, type Http } from "./seo/google";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const MAIL_DOMAIN = (process.env.MAIL_DOMAIN || "mavin.pk").toLowerCase();
const API = "https://api.resend.com";
const MAX_HTML = 500_000;
const MAX_TEXT = 200_000;

export interface MailDeps { http?: Http; apiKey?: string | null; now?: Date }
const key = (d: MailDeps) => (d.apiKey === undefined ? process.env.RESEND_API_KEY?.trim() || null : d.apiKey);
const iso = (d = new Date()) => d.toISOString();
const json = <T>(s: unknown, fb: T): T => { try { return s ? (JSON.parse(String(s)) as T) : fb; } catch { return fb; } };

/** "Name <a@b.pk>" or "a@b.pk" -> "a@b.pk" (lower case). */
export const addressOf = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();

// ── Webhook signature (Svix, as Resend documents) ─────────────────────────

/** Verifies `svix-signature` over `${id}.${timestamp}.${rawBody}` with the
 * whsec_ secret; rejects timestamps more than 5 minutes off. */
export function verifyWebhook(rawBody: string, h: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const keyBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(createHmac("sha256", keyBytes).update(`${h.id}.${h.timestamp}.${rawBody}`).digest("base64"));
  return h.signature.split(" ").some((part) => {
    const sig = Buffer.from(part.replace(/^v1,/, ""));
    return sig.length === expected.length && timingSafeEqual(sig, expected);
  });
}

// ── Mailboxes ─────────────────────────────────────────────────────────────

export interface Mailbox { id: string; address: string; name: string; unread: number }

export async function listMailboxes(sql: Sql): Promise<Mailbox[]> {
  return (await sql.execute(
    `SELECT b.id, b.address, b.display_name, (SELECT COUNT(*) FROM mail_messages m WHERE m.mailbox_id = b.id AND m.direction = 'in' AND m.read_at IS NULL AND m.archived_at IS NULL) AS unread
     FROM mail_mailboxes b WHERE b.deleted_at IS NULL ORDER BY b.created_at, b.address`,
  )).rows.map((r) => ({ id: String(r.id), address: String(r.address), name: String(r.display_name ?? ""), unread: Number(r.unread) || 0 }));
}

export async function createMailbox(sql: Sql, localPart: unknown, name: unknown) {
  const local = String(localPart ?? "").trim().toLowerCase().replace(new RegExp(`@${MAIL_DOMAIN.replace(/\./g, "\\.")}$`), "");
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/.test(local)) throw new HttpError(400, `Enter the part before @${MAIL_DOMAIN}: letters, digits, dots, dashes.`);
  const address = `${local}@${MAIL_DOMAIN}`;
  const display = String(name ?? "").trim().slice(0, 60) || "MAVIN.pk";
  const existing = (await sql.execute(`SELECT id, deleted_at FROM mail_mailboxes WHERE address = ?`, [address])).rows[0];
  if (existing && !existing.deleted_at) throw new HttpError(409, `${address} already exists.`);
  if (existing) await sql.execute(`UPDATE mail_mailboxes SET deleted_at = NULL, display_name = ? WHERE id = ?`, [display, existing.id]);
  else await sql.execute(`INSERT INTO mail_mailboxes (id, address, display_name, created_at) VALUES (?, ?, ?, ?)`, [randomUUID(), address, display, iso()]);
  return { address };
}

/** Removes a mailbox from the list (its messages are kept); info@ and security@ stay. */
export async function removeMailbox(sql: Sql, id: string) {
  if (id === "mailbox-info" || id === "mailbox-security") throw new HttpError(400, "info@ and security@ are used on the website and cannot be removed.");
  const r = await sql.execute(`UPDATE mail_mailboxes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, [iso(), id]);
  if (!r.rowsAffected) throw new HttpError(404, "Mailbox not found.");
}

// ── Receiving ─────────────────────────────────────────────────────────────

interface Received {
  id: string; from: string; to?: string[]; cc?: string[]; received_for?: string[]; subject?: string; html?: string | null; text?: string | null;
  message_id?: string; created_at?: string; headers?: Record<string, string>;
  attachments?: { id: string; filename: string; content_type: string; size?: number }[];
}

async function resend<T>(d: MailDeps, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const k = key(d);
  if (!k) throw new HttpError(503, "Mail is not connected: set RESEND_API_KEY on the server.");
  const r = await (d.http ?? defaultHttp)(`${API}${path}`, { method, headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status < 200 || r.status >= 300) {
    const m = (r.json as { message?: string; name?: string })?.message ?? "no details";
    throw new HttpError(502, `The mail service answered ${r.status}: ${m}`);
  }
  return r.json as T;
}

/** Stores one received email for every mailbox it was addressed to. Returns how many were stored. */
export async function storeReceived(sql: Sql, emailId: string, d: MailDeps = {}, meta?: Partial<Received>): Promise<number> {
  const boxes = await listMailboxes(sql);
  const recipients = new Set([...(meta?.to ?? []), ...(meta?.cc ?? []), ...(meta?.received_for ?? [])].map(addressOf));
  // Metadata may be missing (list API); then the full message tells.
  let full: Received | null = null;
  const targetsFrom = (set: Set<string>) => boxes.filter((b) => set.has(b.address));
  let targets = targetsFrom(recipients);
  if (!targets.length || !meta) {
    full = await resend<Received>(d, "GET", `/emails/receiving/${encodeURIComponent(emailId)}`);
    targets = targetsFrom(new Set([...(full.to ?? []), ...(full.cc ?? []), ...(full.received_for ?? [])].map(addressOf)));
  }
  if (!targets.length) return 0;
  const fresh: typeof targets = [];
  for (const b of targets) {
    if (!(await sql.execute(`SELECT 1 FROM mail_messages WHERE mailbox_id = ? AND provider_id = ?`, [b.id, emailId])).rows.length) fresh.push(b);
  }
  if (!fresh.length) return 0;
  full ??= await resend<Received>(d, "GET", `/emails/receiving/${encodeURIComponent(emailId)}`);
  const inReplyTo = full.headers?.["in-reply-to"] ?? full.headers?.["In-Reply-To"] ?? null;
  const t = full.created_at ?? iso(d.now);
  let stored = 0;
  for (const b of fresh) {
    try {
      await sql.execute(
        `INSERT INTO mail_messages (id, mailbox_id, direction, provider_id, message_id, in_reply_to, from_addr, to_addrs, cc_addrs, subject, text_body, html_body, attachments, created_at)
         VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), b.id, emailId, full.message_id ?? null, inReplyTo, String(full.from ?? "").slice(0, 300), JSON.stringify(full.to ?? []), JSON.stringify(full.cc ?? []),
          String(full.subject ?? "(no subject)").slice(0, 500), full.text ? full.text.slice(0, MAX_TEXT) : null, full.html ? full.html.slice(0, MAX_HTML) : null,
          JSON.stringify((full.attachments ?? []).map((a) => ({ id: a.id, filename: a.filename, type: a.content_type, size: a.size ?? null }))), t],
      );
      stored++;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e; // arrived twice at once: already stored
    }
  }
  return stored;
}

/** The webhook: an `email.received` event (already verified). */
export async function handleWebhook(sql: Sql, event: unknown, d: MailDeps = {}): Promise<{ stored: number }> {
  const e = (event ?? {}) as { type?: string; data?: Received & { email_id?: string } };
  if (e.type !== "email.received" || !e.data?.email_id) return { stored: 0 };
  return { stored: await storeReceived(sql, e.data.email_id, d, e.data) };
}

/** "Check for new mail": the most recent received emails from Resend. */
export async function syncInbox(sql: Sql, d: MailDeps = {}): Promise<{ checked: number; stored: number }> {
  const list = await resend<{ data?: Received[] }>(d, "GET", `/emails/receiving?limit=100`);
  let stored = 0;
  const items = list.data ?? [];
  for (const m of items) stored += await storeReceived(sql, m.id, d, { to: m.to, cc: m.cc, received_for: m.received_for });
  return { checked: items.length, stored };
}

// ── Reading and sending ───────────────────────────────────────────────────

export interface MessageRow { id: string; direction: "in" | "out"; from: string; to: string[]; subject: string; preview: string; read: boolean; archived: boolean; attachments: number; createdAt: string }

export async function listMessages(sql: Sql, mailboxId: string, f: { folder?: unknown; q?: unknown; offset?: unknown }): Promise<MessageRow[]> {
  const folder = f.folder === "sent" ? "sent" : f.folder === "archived" ? "archived" : "inbox";
  const where = [`mailbox_id = ?`, folder === "sent" ? `direction = 'out'` : `direction = 'in'`, folder === "archived" ? `archived_at IS NOT NULL` : folder === "inbox" ? `archived_at IS NULL` : `1 = 1`];
  const args: unknown[] = [mailboxId];
  const q = typeof f.q === "string" ? f.q.trim().slice(0, 80) : "";
  if (q) { where.push(`(subject LIKE ? OR from_addr LIKE ? OR to_addrs LIKE ? OR text_body LIKE ?)`); const like = `%${q}%`; args.push(like, like, like, like); }
  const rows = (await sql.execute(
    `SELECT id, direction, from_addr, to_addrs, subject, substr(COALESCE(text_body, ''), 1, 160) AS preview, read_at, archived_at, attachments, created_at
     FROM mail_messages WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 100 OFFSET ?`,
    [...args, Math.max(0, Number(f.offset) || 0)],
  )).rows;
  return rows.map((r) => ({
    id: String(r.id), direction: r.direction === "out" ? "out" : "in", from: String(r.from_addr), to: json<string[]>(r.to_addrs, []), subject: String(r.subject ?? ""),
    preview: String(r.preview ?? "").replace(/\s+/g, " ").trim(), read: Boolean(r.read_at) || r.direction === "out", archived: Boolean(r.archived_at),
    attachments: json<unknown[]>(r.attachments, []).length, createdAt: String(r.created_at),
  }));
}

export async function getMessage(sql: Sql, id: string) {
  const r = (await sql.execute(`SELECT * FROM mail_messages WHERE id = ?`, [id])).rows[0];
  if (!r) throw new HttpError(404, "Message not found.");
  if (r.direction === "in" && !r.read_at) await sql.execute(`UPDATE mail_messages SET read_at = ? WHERE id = ?`, [iso(), id]);
  return {
    id: String(r.id), mailboxId: String(r.mailbox_id), direction: String(r.direction), from: String(r.from_addr), to: json<string[]>(r.to_addrs, []), cc: json<string[]>(r.cc_addrs, []),
    subject: String(r.subject ?? ""), text: (r.text_body as string | null) ?? null, html: (r.html_body as string | null) ?? null, messageId: (r.message_id as string | null) ?? null,
    attachments: json<{ filename: string; type: string; size: number | null }[]>(r.attachments, []), createdAt: String(r.created_at), sentBy: (r.sent_by as string | null) ?? null,
    archived: Boolean(r.archived_at),
  };
}

export async function setFlags(sql: Sql, id: string, f: { read?: unknown; archived?: unknown }) {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (f.read !== undefined) { sets.push(`read_at = ?`); args.push(f.read ? iso() : null); }
  if (f.archived !== undefined) { sets.push(`archived_at = ?`); args.push(f.archived ? iso() : null); }
  if (!sets.length) return;
  const r = await sql.execute(`UPDATE mail_messages SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
  if (!r.rowsAffected) throw new HttpError(404, "Message not found.");
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
const addresses = (v: unknown, label: string, required: boolean) => {
  const list = String(v ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (required && !list.length) throw new HttpError(400, `Enter at least one ${label} address.`);
  if (list.length > 20) throw new HttpError(400, `At most 20 ${label} addresses.`);
  for (const a of list) if (!EMAIL.test(a)) throw new HttpError(400, `"${a}" is not a valid email address.`);
  return list;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends from a mailbox (plain text, shown as simple HTML too). `replyTo` is the message being answered. */
export async function sendMail(sql: Sql, actor: string, p: { mailboxId?: unknown; to?: unknown; cc?: unknown; subject?: unknown; body?: unknown; replyTo?: unknown }, d: MailDeps = {}) {
  const box = (await sql.execute(`SELECT id, address, display_name FROM mail_mailboxes WHERE id = ? AND deleted_at IS NULL`, [String(p.mailboxId ?? "")])).rows[0];
  if (!box) throw new HttpError(404, "Choose a mailbox to send from.");
  const to = addresses(p.to, "recipient", true);
  const cc = addresses(p.cc, "Cc", false);
  const subject = String(p.subject ?? "").trim().slice(0, 300);
  const body = String(p.body ?? "").replace(/\r\n/g, "\n").slice(0, 100_000);
  if (!subject) throw new HttpError(400, "Write a subject.");
  if (!body.trim()) throw new HttpError(400, "Write a message.");
  let headers: Record<string, string> | undefined;
  let inReplyTo: string | null = null;
  if (typeof p.replyTo === "string" && p.replyTo) {
    const orig = (await sql.execute(`SELECT message_id FROM mail_messages WHERE id = ?`, [p.replyTo])).rows[0];
    if (orig?.message_id) { inReplyTo = String(orig.message_id); headers = { "In-Reply-To": inReplyTo, References: inReplyTo }; }
  }
  const from = `${String(box.display_name || "MAVIN.pk").replace(/[<>"]/g, "")} <${box.address}>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;white-space:pre-wrap">${esc(body)}</div>`;
  const sent = await resend<{ id?: string }>(d, "POST", "/emails", { from, to, ...(cc.length ? { cc } : {}), subject, text: body, html, reply_to: String(box.address), ...(headers ? { headers } : {}) });
  await sql.execute(
    `INSERT INTO mail_messages (id, mailbox_id, direction, provider_id, in_reply_to, from_addr, to_addrs, cc_addrs, subject, text_body, html_body, attachments, read_at, sent_by, created_at)
     VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?)`,
    [randomUUID(), box.id, sent.id ?? null, inReplyTo, from, JSON.stringify(to), JSON.stringify(cc), subject, body, iso(d.now), actor, iso(d.now)],
  );
  return { id: sent.id ?? null };
}
