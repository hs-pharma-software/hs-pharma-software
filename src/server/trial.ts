/** Free trial (demo account) confirmation: the owner of a business on a trial
 * confirms the subscription; the business becomes active on its plan for one
 * full plan term from now, and the Super Admin is told (Queries inbox). Only
 * the owner can confirm, and only a trial can be confirmed. */
import { randomUUID } from "node:crypto";
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import { TRIAL_STATUS } from "../lib/subscription";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export async function confirmTrial(sql: Sql, caller: Caller, now = new Date()): Promise<{ expiresAt: string; plan: string }> {
  if (caller.role !== "owner" || !caller.tenantId) throw new HttpError(403, "Only the business owner can confirm the subscription.");
  const t = (await sql.execute(
    `SELECT t.id, t.name, t.owner_name, t.phone, t.email, t.business_type, t.subscription_status, p.name AS plan_name, p.duration_days, p.price
     FROM tenants t LEFT JOIN subscription_plans p ON p.id = t.subscription_plan_id WHERE t.id = ?`,
    [caller.tenantId],
  )).rows[0];
  if (!t) throw new HttpError(404, "Business not found.");
  if (t.subscription_status !== TRIAL_STATUS) throw new HttpError(409, "This business is not on a trial.");
  const days = Number(t.duration_days) || 30;
  const started = now.toISOString();
  const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
  // Only a trial is confirmed (two clicks at once confirm it once).
  const r = await sql.execute(
    `UPDATE tenants SET subscription_status = 'active', subscription_started_at = ?, subscription_expires_at = ?, updated_at = ? WHERE id = ? AND subscription_status = ?`,
    [started, expiresAt, started, caller.tenantId, TRIAL_STATUS],
  );
  if (!r.rowsAffected) throw new HttpError(409, "The subscription was already confirmed.");
  const plan = String(t.plan_name ?? "its plan");
  await sql.execute(
    `INSERT INTO site_queries (id, submission_key, kind, name, business_name, business_type, phone, email, message, topic, status, created_at)
     VALUES (?, ?, 'contact', ?, ?, ?, ?, ?, ?, 'trial-confirmed', 'unread', ?)`,
    [randomUUID(), `trial-${caller.tenantId}-${started}`, String(t.owner_name || t.name), String(t.name), (t.business_type as string | null) ?? null, (t.phone as string | null) ?? null, (t.email as string | null) ?? null,
      `Trial confirmed: ${t.name} continues on ${plan} (Rs ${Number(t.price) || 0} per ${days} days) until ${expiresAt.slice(0, 10)}. Collect the payment.`, started],
  ).catch(() => undefined); // the confirmation stands even if the notice cannot be written
  return { expiresAt, plan };
}
