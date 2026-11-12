/** Super Admin › Offline Tenants: licenses for the standalone desktop
 * editions (Mavin Pharmacy Offline).
 *
 * The pharmacy sends its request code (MAVIN-REQUEST-1..., from its Settings);
 * the Super Admin enters the tenant's details and the expiry; MAVIN signs a
 * license bound to that installation with OFFLINE_LICENSE_PRIVATE_KEY (Ed25519,
 * server only) and records it. The pharmacy imports the license offline.
 *
 * The key is checked against the public key bundled in the app, so the server
 * never issues a license the app would refuse. */
import { createPrivateKey, createPublicKey, randomUUID, sign, type KeyObject } from "node:crypto";
import { HttpError } from "@/server/db";
import type { Sql } from "@/server/subSupers";
import type { Caller } from "@/server/sqlPolicy";

/** The public key bundled in Mavin Pharmacy Offline (desktop-standalone/resources/license-public.pem). */
export const APP_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANUsHtoxg9P21CXGh69aylRy2J+mCkTXljeaca68hClo=
-----END PUBLIC KEY-----
`;

/** Categories with a desktop edition today (others are listed as not available yet). */
export const OFFLINE_CATEGORIES: { id: string; label: string; available: boolean }[] = [
  { id: "retail_pharmacy", label: "Retail Pharmacy", available: true },
  { id: "medical_store", label: "Medical Store", available: true },
  { id: "hospital_pharmacy", label: "Hospital Pharmacy", available: true },
  { id: "general_store", label: "General Store", available: false },
  { id: "restaurant", label: "Restaurant", available: false },
  { id: "clinic", label: "Clinic", available: false },
  { id: "lab", label: "Laboratory", available: false },
];

export interface RequestInfo { installationId: string; pharmacy: string | null; appVersion: string | null; at: string | null }

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const iso = (d: Date) => d.toISOString();

function superAdmin(c: Caller) {
  if (c.role !== "super_admin" || c.platformRole === "distributor") throw new HttpError(403, "Super Admin only.");
}

/** Reads a pharmacy's request code (no secret in it). */
export function parseRequestCode(code: unknown): RequestInfo {
  const t = String(code ?? "").replace(/\s+/g, "");
  const m = /^MAVIN-REQUEST-1\.([A-Za-z0-9_-]+)$/.exec(t);
  if (!m) throw new HttpError(400, "The request code must start with MAVIN-REQUEST-1. Copy it again from the pharmacy's Settings › Mavin Pharmacy Offline › Show request code.");
  let j: Record<string, unknown>;
  try { j = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); } catch { throw new HttpError(400, "The request code is damaged. Copy it again."); }
  const id = String(j.installationId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(400, "The request code has no valid installation id.");
  return { installationId: id.toLowerCase(), pharmacy: typeof j.pharmacy === "string" ? j.pharmacy.slice(0, 120) : null, appVersion: typeof j.appVersion === "string" ? j.appVersion.slice(0, 20) : null, at: typeof j.at === "string" ? j.at : null };
}

/** The signing key from the server's settings, checked against the app's public key. */
export function signingKey(env: Record<string, string | undefined> = process.env, appPublicPem = APP_PUBLIC_KEY_PEM): KeyObject {
  const raw = (env.OFFLINE_LICENSE_PRIVATE_KEY ?? "").trim();
  if (!raw) throw new HttpError(503, "License signing is not set up on the server (OFFLINE_LICENSE_PRIVATE_KEY).");
  const pem = raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
  let key: KeyObject;
  try { key = createPrivateKey(pem); } catch { throw new HttpError(503, "OFFLINE_LICENSE_PRIVATE_KEY is not a valid private key."); }
  const pub = createPublicKey(key).export({ type: "spki", format: "pem" }).toString().trim();
  if (pub !== appPublicPem.trim()) throw new HttpError(503, "OFFLINE_LICENSE_PRIVATE_KEY does not match the key built into Mavin Pharmacy Offline: licenses would be refused.");
  return key;
}

/** MAVIN-LICENSE-1.<payload>.<signature> (desktop-standalone/src/core/license.ts reads it). */
export function signLicense(key: KeyObject, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload));
  return `MAVIN-LICENSE-1.${body.toString("base64url")}.${sign(null, body, key).toString("base64url")}`;
}

/** End of that day, Pakistan time. */
const endOfDayPk = (ymd: string) => new Date(`${ymd}T23:59:59.000+05:00`);

export async function list(sql: Sql, caller: Caller) {
  superAdmin(caller);
  const tenants = (await sql.execute(
    `SELECT t.*, (SELECT COUNT(*) FROM offline_licenses l WHERE l.offline_tenant_id = t.id) AS licenses,
            (SELECT MAX(l.expires_at) FROM offline_licenses l WHERE l.offline_tenant_id = t.id) AS expires_at,
            (SELECT MAX(l.issued_at) FROM offline_licenses l WHERE l.offline_tenant_id = t.id) AS last_issued_at
     FROM offline_tenants t ORDER BY t.updated_at DESC LIMIT 500`,
  )).rows;
  return { categories: OFFLINE_CATEGORIES, tenants, signingReady: (() => { try { signingKey(); return true; } catch { return false; } })() };
}

export async function history(sql: Sql, caller: Caller, input: { tenantId?: unknown }) {
  superAdmin(caller);
  return (await sql.execute(
    `SELECT id, license_id, kind, licensee, issued_at, expires_at, issued_by, license_text FROM offline_licenses WHERE offline_tenant_id = ? ORDER BY issued_at DESC`,
    [str(input.tenantId, 80)],
  )).rows;
}

/** Reads the request code (to show the installation before issuing). */
export function preview(caller: Caller, input: { requestCode?: unknown }) {
  superAdmin(caller);
  return parseRequestCode(input.requestCode);
}

/** Issues an activation (first license of the installation) or a renewal, and records it. */
export async function issue(
  sql: Sql, caller: Caller,
  input: { requestCode?: unknown; tenantId?: unknown; category?: unknown; name?: unknown; ownerName?: unknown; phone?: unknown; email?: unknown; city?: unknown; address?: unknown; notes?: unknown; expires?: unknown },
  deps: { now?: () => Date; env?: Record<string, string | undefined>; appPublicPem?: string } = {},
) {
  superAdmin(caller);
  const now = (deps.now ?? (() => new Date()))();
  // A renewal of a known tenant needs no new request code: its installation is on record.
  let req: RequestInfo;
  if (!str(input.requestCode, 4000) && str(input.tenantId, 80)) {
    const known = (await sql.execute(`SELECT installation_id FROM offline_tenants WHERE id = ?`, [str(input.tenantId, 80)])).rows[0];
    if (!known) throw new HttpError(404, "Offline tenant not found.");
    req = { installationId: String(known.installation_id), pharmacy: null, appVersion: null, at: null };
  } else {
    req = parseRequestCode(input.requestCode);
  }
  const category = OFFLINE_CATEGORIES.find((c) => c.id === input.category);
  if (!category) throw new HttpError(400, "Choose the tenant's category.");
  if (!category.available) throw new HttpError(400, `There is no offline edition for ${category.label} yet.`);
  const name = str(input.name, 120);
  if (name.length < 2) throw new HttpError(400, "Enter the tenant's (pharmacy's) name.");
  const expires = str(input.expires, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || !Number.isFinite(endOfDayPk(expires).getTime())) throw new HttpError(400, "Choose the expiry date.");
  const expiresAt = endOfDayPk(expires);
  if (expiresAt.getTime() <= now.getTime()) throw new HttpError(400, "The expiry date must be in the future.");
  if (expiresAt.getTime() > now.getTime() + 5 * 366 * 86_400_000) throw new HttpError(400, "A license can run at most 5 years.");
  const key = signingKey(deps.env, deps.appPublicPem);
  const phone = str(input.phone, 30) || null;
  const email = str(input.email, 120) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "The email address is not valid.");

  const t = iso(now);
  const existing = (await sql.execute(`SELECT id FROM offline_tenants WHERE installation_id = ?`, [req.installationId])).rows[0];
  const tenantId = existing ? String(existing.id) : randomUUID();
  const earlier = existing ? Number((await sql.execute(`SELECT COUNT(*) AS n FROM offline_licenses WHERE offline_tenant_id = ?`, [tenantId])).rows[0].n) : 0;
  const kind = earlier ? "renewal" : "activation";
  const payload = { v: 1, licenseId: randomUUID(), installationId: req.installationId, licensee: name, kind, issuedAt: t, expiresAt: iso(expiresAt) };
  const licenseText = signLicense(key, payload);
  const details = [category.id, name, str(input.ownerName, 120) || null, phone, email, str(input.city, 60) || null, str(input.address, 200) || null, str(input.notes, 500) || null, req.appVersion];
  await sql.batch([
    existing
      ? { sql: `UPDATE offline_tenants SET category = ?, name = ?, owner_name = ?, phone = ?, email = ?, city = ?, address = ?, notes = ?, app_version = COALESCE(?, app_version), updated_at = ? WHERE id = ?`, args: [...details, t, tenantId] }
      : { sql: `INSERT INTO offline_tenants (id, installation_id, category, name, owner_name, phone, email, city, address, notes, app_version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [tenantId, req.installationId, ...details, caller.userId, t, t] },
    { sql: `INSERT INTO offline_licenses (id, offline_tenant_id, installation_id, license_id, kind, licensee, issued_at, expires_at, license_text, request_code, issued_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), tenantId, req.installationId, payload.licenseId, kind, name, t, payload.expiresAt, licenseText, String(input.requestCode ?? "").replace(/\s+/g, "").slice(0, 2000), caller.userId, t] },
  ]);
  const fileName = `${name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pharmacy"}-${expires}.lic`;
  return { licenseText, fileName, kind, licenseId: payload.licenseId, expiresAt: payload.expiresAt, installationId: req.installationId, tenantId };
}
