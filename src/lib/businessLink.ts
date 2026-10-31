/** Linking a clinic or hospital to a hospital pharmacy by token.
 *
 * The clinic makes a one-time token (Settings > Linked Pharmacy); only its
 * SHA-256 hash is stored. The pharmacy enters the token in its General
 * Settings; redeeming it records the link with the pharmacy's consent. A
 * verified link is fixed: neither side can change it, only the Super Admin.
 *
 * Shared by the web server (/api/link/verify, where the pharmacy cannot see
 * the clinic's rows) and the desktop app, through a small database interface. */

export interface LinkDb {
  select<T>(sql: string, args: unknown[]): Promise<T[]>;
  execute(sql: string, args: unknown[]): Promise<void>;
}

/** Hours a token stays valid. */
export const LINK_TOKEN_HOURS = 24;

// No 0/O, 1/I/L: the token is read out and typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A new token, e.g. HSL-7KQ2-M9XD-4TPA-W3RN (80 bits of randomness). */
export function newLinkToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `HSL-${[0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-")}`;
}

/** Spaces, dashes and case do not matter when the token is typed. */
export function normalizeLinkToken(token: string): string {
  return token.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^HSL/, "");
}

export async function hashLinkToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeLinkToken(token));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class LinkError extends Error {}

/** Redeems a token for a hospital pharmacy: checks it, records the verified
 * link and marks the token used. Returns the linked clinic / hospital. */
export async function redeemLinkToken(
  db: LinkDb,
  p: { token: string; pharmacyTenantId: string; userId: string; now?: Date }
): Promise<{ clinicTenantId: string; clinicName: string }> {
  const now = (p.now ?? new Date()).toISOString();
  if (normalizeLinkToken(p.token).length !== 16) throw new LinkError("Enter the full token, e.g. HSL-7KQ2-M9XD-4TPA-W3RN.");
  const pharmacy = (await db.select<{ business_type: string | null }>(
    `SELECT business_type FROM tenants WHERE id = ? AND deleted_at IS NULL`, [p.pharmacyTenantId]
  ))[0];
  if (pharmacy?.business_type !== "hospital_pharmacy") throw new LinkError("Only a hospital pharmacy can be linked to a clinic or hospital.");

  const hash = await hashLinkToken(p.token);
  const t = (await db.select<{ id: string; tenant_id: string; status: string; expires_at: string }>(
    `SELECT id, tenant_id, status, expires_at FROM business_link_tokens WHERE token_hash = ? AND deleted_at IS NULL`, [hash]
  ))[0];
  if (!t || t.status === "revoked") throw new LinkError("This token is not valid. Ask the clinic or hospital for a new one.");
  if (t.status === "verified") throw new LinkError("This token has already been used.");
  if (t.expires_at < now) throw new LinkError("This token has expired. Ask the clinic or hospital for a new one.");
  if (t.tenant_id === p.pharmacyTenantId) throw new LinkError("A business cannot link to itself.");

  const clinic = (await db.select<{ name: string }>(`SELECT name FROM tenants WHERE id = ? AND deleted_at IS NULL`, [t.tenant_id]))[0];
  if (!clinic) throw new LinkError("The clinic or hospital that made this token no longer exists.");

  const existing = (await db.select<{ pharmacy_tenant_id: string; verified_at: string | null }>(
    `SELECT pharmacy_tenant_id, verified_at FROM clinic_pharmacy_link WHERE clinic_tenant_id = ? AND is_active = 1`, [t.tenant_id]
  ))[0];
  if (existing?.verified_at) {
    throw new LinkError(existing.pharmacy_tenant_id === p.pharmacyTenantId
      ? `${clinic.name} is already linked to this pharmacy.`
      : `${clinic.name} is already linked to another pharmacy. Only the administrator can change it.`);
  }

  await db.execute(
    `INSERT INTO clinic_pharmacy_link (id, clinic_tenant_id, pharmacy_tenant_id, is_active, verified_at, verified_by, clinic_name, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(clinic_tenant_id) DO UPDATE SET pharmacy_tenant_id = excluded.pharmacy_tenant_id, is_active = 1,
       verified_at = excluded.verified_at, verified_by = excluded.verified_by, clinic_name = excluded.clinic_name, updated_at = excluded.updated_at`,
    [globalThis.crypto.randomUUID(), t.tenant_id, p.pharmacyTenantId, now, p.userId, clinic.name, now, now]
  );
  await db.execute(
    `UPDATE business_link_tokens SET status = 'verified', pharmacy_tenant_id = ?, verified_at = ?, updated_at = ? WHERE id = ?`,
    [p.pharmacyTenantId, now, now, t.id]
  );
  return { clinicTenantId: t.tenant_id, clinicName: clinic.name };
}
