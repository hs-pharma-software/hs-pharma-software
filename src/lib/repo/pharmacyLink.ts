/** Clinic / hospital <-> hospital pharmacy link by token (lib/businessLink.ts):
 * the clinic's side (make a token, see the link) and the pharmacy's side
 * (redeem a token, see the linked clinics). */
import { dbExecute, dbSelect } from "../db";
import { requireCurrentTenantId } from "./base";
import { newId, nowIso } from "../id";
import { recordOutbox } from "../sync/outbox";
import { useAuthStore } from "../../store/authStore";
import { SERVER_DB, serverJson } from "../serverMode";
import { isTauriShell } from "../platform";
import { isMissingSchemaError } from "../dbErrors";
import { LINK_TOKEN_HOURS, hashLinkToken, newLinkToken, redeemLinkToken, type LinkDb } from "../businessLink";
import type { ClinicPharmacyLink } from "../types-clinic";

const NEEDS_V66 = "Linking by token needs the latest database update (v66). Ask the administrator to run it.";

async function v66<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingSchemaError(e)) throw new Error(NEEDS_V66);
    throw e;
  }
}

export interface LinkStatus {
  link: (ClinicPharmacyLink & { pharmacy_name: string | null }) | null;
  /** The newest token still waiting for the pharmacy (its value is not kept). */
  pending: { created_at: string; expires_at: string } | null;
}

/** The clinic's / hospital's side: its pharmacy link and any waiting token. */
export async function getLinkStatus(): Promise<LinkStatus> {
  const tenantId = requireCurrentTenantId();
  const link = (await dbSelect<ClinicPharmacyLink & { pharmacy_name: string | null }>(
    `SELECT l.*, t.name AS pharmacy_name FROM clinic_pharmacy_link l LEFT JOIN tenants t ON t.id = l.pharmacy_tenant_id
     WHERE l.clinic_tenant_id = ? AND l.is_active = 1 LIMIT 1`,
    [tenantId]
  ))[0] ?? null;
  let pending: LinkStatus["pending"] = null;
  try {
    pending = (await dbSelect<{ created_at: string; expires_at: string }>(
      `SELECT created_at, expires_at FROM business_link_tokens
       WHERE tenant_id = ? AND status = 'pending' AND deleted_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
      [tenantId, nowIso()]
    ))[0] ?? null;
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e;
  }
  return { link, pending };
}

/** Makes a new one-time token for the pharmacy to enter (earlier waiting
 * tokens stop working). Shown once: only its hash is stored. */
export async function createLinkToken(): Promise<{ token: string; expiresAt: string }> {
  const tenantId = requireCurrentTenantId();
  const { link } = await getLinkStatus();
  if (link?.verified_at) throw new Error("The pharmacy link is verified and fixed. Only the administrator can change it.");
  const token = newLinkToken();
  const ts = nowIso();
  const expiresAt = new Date(Date.now() + LINK_TOKEN_HOURS * 3600_000).toISOString();
  return v66(async () => {
    const waiting = await dbSelect<{ id: string }>(
      `SELECT id FROM business_link_tokens WHERE tenant_id = ? AND status = 'pending' AND deleted_at IS NULL`, [tenantId]
    );
    for (const w of waiting) {
      await dbExecute(`UPDATE business_link_tokens SET status = 'revoked', updated_at = ? WHERE id = ? AND tenant_id = ?`, [ts, w.id, tenantId]);
      await recordOutbox("business_link_tokens", w.id, "update", { id: w.id, tenant_id: tenantId, status: "revoked", updated_at: ts });
    }
    const row = {
      id: newId(), tenant_id: tenantId, token_hash: await hashLinkToken(token), status: "pending", expires_at: expiresAt,
      pharmacy_tenant_id: null, verified_at: null, created_by: useAuthStore.getState().currentUser?.id ?? null,
      created_at: ts, updated_at: ts, deleted_at: null,
    };
    await dbExecute(
      `INSERT INTO business_link_tokens (id, tenant_id, token_hash, status, expires_at, pharmacy_tenant_id, verified_at, created_by, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.tenant_id, row.token_hash, row.status, row.expires_at, row.pharmacy_tenant_id, row.verified_at, row.created_by, row.created_at, row.updated_at, row.deleted_at]
    );
    await recordOutbox("business_link_tokens", row.id, "insert", row);
    return { token, expiresAt };
  });
}

const localDb: LinkDb = {
  select: <T,>(sql: string, args: unknown[]) => dbSelect<T>(sql, args),
  execute: async (sql: string, args: unknown[]) => { await dbExecute(sql, args); },
};

/** The pharmacy's side: enters the clinic's / hospital's token. */
export async function verifyLinkToken(token: string): Promise<{ clinicName: string }> {
  const { currentUser } = useAuthStore.getState();
  const tenantId = requireCurrentTenantId();
  if (currentUser?.role !== "owner") throw new Error("Only the pharmacy's owner login can link a clinic or hospital.");
  if (SERVER_DB) return serverJson<{ clinicName: string }>("/api/link/verify", { token });
  const r = await v66(() => redeemLinkToken(localDb, { token, pharmacyTenantId: tenantId, userId: currentUser.id })).catch((e: unknown) => {
    // The desktop app holds only this business's rows: the clinic's token is on the server.
    if (isTauriShell() && e instanceof Error && /not valid/.test(e.message)) {
      throw new Error(`${e.message} If the clinic made it just now, verify it on the web version.`);
    }
    throw e;
  });
  const link = (await dbSelect<Record<string, unknown>>(`SELECT * FROM clinic_pharmacy_link WHERE clinic_tenant_id = ?`, [r.clinicTenantId]))[0];
  if (link) await recordOutbox("clinic_pharmacy_link", String(link.id), "insert", link);
  return { clinicName: r.clinicName };
}

/** The clinics / hospitals linked to this pharmacy. */
export async function listLinkedClinics(): Promise<ClinicPharmacyLink[]> {
  const tenantId = requireCurrentTenantId();
  try {
    return await dbSelect<ClinicPharmacyLink>(
      `SELECT * FROM clinic_pharmacy_link WHERE pharmacy_tenant_id = ? AND is_active = 1 ORDER BY verified_at DESC, created_at DESC`,
      [tenantId]
    );
  } catch (e) {
    if (isMissingSchemaError(e)) return [];
    throw e;
  }
}

/** Super Admin: undoes a business's pharmacy link so a new token can be used. */
export async function unlinkPharmacy(clinicTenantId: string): Promise<void> {
  const ts = nowIso();
  await dbExecute(`UPDATE clinic_pharmacy_link SET is_active = 0, updated_at = ? WHERE clinic_tenant_id = ?`, [ts, clinicTenantId]);
}

/** Super Admin: a business's current pharmacy link (or null). */
export async function linkOfTenant(clinicTenantId: string): Promise<(ClinicPharmacyLink & { pharmacy_name: string | null }) | null> {
  return (await dbSelect<ClinicPharmacyLink & { pharmacy_name: string | null }>(
    `SELECT l.*, t.name AS pharmacy_name FROM clinic_pharmacy_link l LEFT JOIN tenants t ON t.id = l.pharmacy_tenant_id
     WHERE l.clinic_tenant_id = ? AND l.is_active = 1 LIMIT 1`,
    [clinicTenantId]
  ))[0] ?? null;
}
