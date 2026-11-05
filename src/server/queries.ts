/** Super Admin > Queries: Contact Us and Book a Demo submissions from the
 * public website. Saved once per submission (a double-click or retry sends the
 * same key), listed newest first, and marked read only when the platform owner
 * opens one. Only the Super Admin can read them. Contents are never logged. */
import { randomUUID } from "node:crypto";
import { HttpError } from "./db";
import type { Lead } from "./leads";
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** Saves a checked submission. A repeat of the same submission saves nothing new. */
export async function saveQuery(sql: Sql, lead: Lead, now = new Date().toISOString()): Promise<{ duplicate: boolean }> {
  const r = await sql.execute(
    `INSERT INTO site_queries (id, submission_key, kind, name, business_name, business_type, branches, phone, email, message, topic, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?)
     ON CONFLICT(submission_key) DO NOTHING`,
    [randomUUID(), lead.submissionKey, lead.kind, lead.name, lead.business || null, lead.businessType || null, lead.branches || null,
      lead.phone || null, lead.email || null, lead.workflow || null, lead.topic || null, now],
  );
  return { duplicate: r.rowsAffected === 0 };
}

/** Only the platform owner (Super Admin); never a Sub Super or a business login. */
export function requireQueryReader(caller: { role: string; platformRole?: string | null }): void {
  if (caller.role !== "super_admin" || caller.platformRole) throw new HttpError(403, "Only the platform owner can read website queries.");
}

const COLUMNS = `id, kind, name, business_name, business_type, branches, phone, email, message, topic, status, read_at, created_at`;

export async function unreadCount(sql: Sql, caller: { role: string; platformRole?: string | null }): Promise<number> {
  requireQueryReader(caller);
  return Number((await sql.execute(`SELECT COUNT(*) AS n FROM site_queries WHERE status = 'unread'`)).rows[0]?.n ?? 0);
}

/** Newest first, optionally only unread, searched by name, business, email, phone or topic. */
export async function listQueries(sql: Sql, caller: { role: string; platformRole?: string | null }, f: { filter?: unknown; q?: unknown } = {}) {
  requireQueryReader(caller);
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.filter === "unread") where.push(`status = 'unread'`);
  const q = typeof f.q === "string" ? f.q.trim().slice(0, 80) : "";
  if (q) {
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(${["name", "business_name", "email", "phone", "topic"].map((c) => `lower(COALESCE(${c}, '')) LIKE ? ESCAPE '\\'`).join(" OR ")})`);
    args.push(like, like, like, like, like);
  }
  const rows = (await sql.execute(
    `SELECT ${COLUMNS} FROM site_queries${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT 500`, args,
  )).rows;
  return { rows, unread: await unreadCount(sql, caller) };
}

/** Opens one query: marks it read the first time only, and returns it with the new unread count. */
export async function openQuery(sql: Sql, caller: { role: string; platformRole?: string | null; userId: string }, id: string) {
  requireQueryReader(caller);
  const row = (await sql.execute(`SELECT ${COLUMNS} FROM site_queries WHERE id = ?`, [id])).rows[0];
  if (!row) throw new HttpError(404, "Query not found.");
  if (row.status === "unread") {
    const t = new Date().toISOString();
    await sql.execute(`UPDATE site_queries SET status = 'read', read_at = ?, read_by = ? WHERE id = ? AND status = 'unread'`, [t, caller.userId, id]);
  }
  const fresh = (await sql.execute(`SELECT ${COLUMNS} FROM site_queries WHERE id = ?`, [id])).rows[0];
  return { query: fresh, unread: await unreadCount(sql, caller) };
}
