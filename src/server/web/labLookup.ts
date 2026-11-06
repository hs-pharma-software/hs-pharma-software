/** "Get your report" on a diagnostic lab's website: the patient enters the
 * number on their receipt (bill number), lab visit number or test order
 * number, and the mobile number registered with the lab. Both must match the
 * same visit; a number alone is not enough (numbers are sequential, so anyone
 * could try them). The answer is the visit's private report link, the same
 * one as the QR code on the receipt. Wrong number and wrong mobile get the
 * same message, and attempts are limited. */
import { randomBytes } from "node:crypto";
import { HttpError } from "../db";
import type { Sql } from "../subSupers";
import { rateLimited } from "./core";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const NO_MATCH = "No report matches this number and mobile number. Check both against your receipt, or use the QR code printed on it.";
/** The last 10 digits: 0300-1234567, +92 300 1234567 and 923001234567 all match. */
export const phoneKey = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);

export async function findLabReport(sql: Sql, tenantId: string, rawNumber: unknown, rawPhone: unknown, ip: string | null): Promise<{ url: string }> {
  const number = String(rawNumber ?? "").trim().replace(/^#/, "").replace(/\s+/g, "");
  const phone = phoneKey(rawPhone);
  if (!number || number.length > 30 || !/^[\w-]+$/.test(number)) throw new HttpError(400, "Enter the receipt or order number from your receipt.");
  if (phone.length < 10) throw new HttpError(400, "Enter the mobile number you gave at the lab.");
  if (rateLimited(`labreport:${tenantId}:${ip ?? "?"}`, 10, 15 * 60_000)) throw new HttpError(429, "Too many tries. Wait 15 minutes, or use the QR code on your receipt.");

  // Visits this number could belong to: bill number, visit number or test order number.
  const candidates = (await sql.execute(
    `SELECT DISTINCT v.id, v.public_token, v.created_at, p.phone FROM lab_visits v JOIN clinic_patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
     WHERE v.tenant_id = ? AND v.deleted_at IS NULL AND (
       CAST(v.visit_no AS TEXT) = ?
       OR v.id IN (SELECT o.lab_visit_id FROM clinic_orders o WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND CAST(o.order_no AS TEXT) = ?)
       OR v.id IN (SELECT o.lab_visit_id FROM clinic_orders o JOIN invoices i ON i.id = o.invoice_id AND i.tenant_id = o.tenant_id
                   WHERE o.tenant_id = ? AND o.deleted_at IS NULL AND i.deleted_at IS NULL AND CAST(i.invoice_no AS TEXT) = ?))
     ORDER BY v.created_at DESC LIMIT 20`,
    [tenantId, number, tenantId, number, tenantId, number],
  )).rows;
  const visit = candidates.find((v) => phoneKey(v.phone).length === 10 && phoneKey(v.phone) === phone);
  if (!visit) throw new HttpError(404, NO_MATCH);
  let token = visit.public_token ? String(visit.public_token) : "";
  if (!token) {
    token = randomBytes(24).toString("hex");
    // Another request may have set one meanwhile: keep whichever was first.
    await sql.execute(`UPDATE lab_visits SET public_token = ? WHERE id = ? AND public_token IS NULL`, [token, visit.id]);
    token = String((await sql.execute(`SELECT public_token FROM lab_visits WHERE id = ?`, [visit.id])).rows[0]?.public_token ?? token);
  }
  return { url: `/lab-report?t=${token}` };
}
