/** Website & Online Store, shared server pieces: who may manage a business's
 * website, the site row and its entitlements, the audit log, and small
 * helpers. Every function takes the database (Sql) so tests use the real
 * schema. All website tables are closed to the browser's SQL route
 * (sqlPolicy); they are reached only through /api/web. */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpError } from "../db";
import type { Caller } from "../sqlPolicy";
import type { Sql } from "../subSupers";
import { cleanSettings, defaultStoreSettings, type SiteSettings, type StoreSettings } from "../../lib/web/sections";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const iso = (d = new Date()) => d.toISOString();
export const json = <T>(s: unknown, fallback: T): T => { try { return s ? (JSON.parse(String(s)) as T) : fallback; } catch { return fallback; } };

/** Defaults when neither the business nor its plan sets a limit. */
export const DEFAULT_LIMITS = { pages: 20, storageMb: 200, customDomains: 3 };

export interface Site {
  tenantId: string;
  websiteEnabled: boolean;
  storeEnabled: boolean;
  publicSuspended: boolean;
  builderAllowed: boolean;
  customDomainAllowed: boolean;
  template: string | null;
  subdomain: string | null;
  status: "draft" | "published";
  publishedAt: string | null;
  settings: SiteSettings | null;
  draftSettings: SiteSettings | null;
  storeSettings: StoreSettings;
  limits: { pages: number; storageMb: number; customDomains: number };
  storageBytes: number;
  provisionedAt: string | null;
  tenantName: string;
  businessType: string | null;
  tenantActive: boolean;
}

export async function loadSite(sql: Sql, tenantId: string): Promise<Site | null> {
  const r = (await sql.execute(
    `SELECT w.*, t.name AS tenant_name, t.business_type, t.subscription_status, t.phone AS t_phone, t.email AS t_email, t.address AS t_address,
            p.web_max_pages, p.web_max_storage_mb, p.web_max_custom_domains
     FROM web_sites w JOIN tenants t ON t.id = w.tenant_id LEFT JOIN subscription_plans p ON p.id = t.subscription_plan_id WHERE w.tenant_id = ?`,
    [tenantId],
  )).rows[0];
  if (!r) return null;
  const lim = (own: unknown, plan: unknown, def: number) => (own != null ? Number(own) : plan != null ? Number(plan) : def);
  return {
    tenantId, websiteEnabled: Number(r.website_enabled) === 1, storeEnabled: Number(r.store_enabled) === 1, publicSuspended: Number(r.public_suspended) === 1,
    builderAllowed: Number(r.builder_allowed) === 1, customDomainAllowed: Number(r.custom_domain_allowed) === 1,
    template: (r.template as string | null) ?? null, subdomain: (r.subdomain as string | null) ?? null,
    status: r.status === "published" ? "published" : "draft", publishedAt: (r.published_at as string | null) ?? null,
    settings: r.settings ? cleanSettingsSafe(r.settings, String(r.tenant_name)) : null,
    draftSettings: r.draft_settings ? cleanSettingsSafe(r.draft_settings, String(r.tenant_name)) : null,
    storeSettings: { ...defaultStoreSettings(), ...json<Partial<StoreSettings>>(r.store_settings, {}) },
    limits: {
      pages: lim(r.max_pages, r.web_max_pages, DEFAULT_LIMITS.pages),
      storageMb: lim(r.max_storage_mb, r.web_max_storage_mb, DEFAULT_LIMITS.storageMb),
      customDomains: lim(r.max_custom_domains, r.web_max_custom_domains, DEFAULT_LIMITS.customDomains),
    },
    storageBytes: Number(r.storage_bytes) || 0, provisionedAt: (r.provisioned_at as string | null) ?? null,
    tenantName: String(r.tenant_name), businessType: (r.business_type as string | null) ?? null,
    tenantActive: String(r.subscription_status ?? "active") !== "suspended",
  };
}

/** Stored settings were validated on save; a later schema change must not break the public page. */
function cleanSettingsSafe(raw: unknown, name: string): SiteSettings {
  try { return cleanSettings(json(raw, {}), name); } catch { return cleanSettings({}, name); }
}

export async function requireSite(sql: Sql, tenantId: string): Promise<Site> {
  const s = await loadSite(sql, tenantId);
  if (!s || (!s.websiteEnabled && !s.storeEnabled)) throw new HttpError(403, "The website is not switched on for this business. Ask the administrator.");
  return s;
}

/** The business whose website the caller manages: an owner or a staff login with
 * Settings access manages their own; the Super Admin any (by `tenantId`). */
export function managedTenant(caller: Caller, tenantId?: unknown): string {
  if (caller.platformRole === "distributor") throw new HttpError(403, "Not available for this login.");
  if (caller.role === "super_admin") {
    if (typeof tenantId !== "string" || !tenantId) throw new HttpError(400, "Choose a business.");
    return tenantId;
  }
  if (!caller.tenantId) throw new HttpError(403, "No business attached to this login.");
  if (typeof tenantId === "string" && tenantId && tenantId !== caller.tenantId) throw new HttpError(403, "You can manage your own business's website only.");
  if (caller.role === "staff" && Array.isArray(caller.permissions) && !caller.permissions.includes("settings") && !caller.permissions.includes("web_orders")) {
    throw new HttpError(403, "Your login has no access to the website. Ask the owner.");
  }
  return caller.tenantId;
}

/** Website editing (not orders): a staff login needs the Settings section. */
export function assertCanEdit(caller: Caller) {
  if (caller.role === "staff" && Array.isArray(caller.permissions) && !caller.permissions.includes("settings")) throw new HttpError(403, "Only the owner or staff with Settings access edit the website.");
}
/** Changes only the owner (or the Super Admin) makes: address, domains, publishing rights. */
export function assertOwner(caller: Caller) {
  if (caller.role === "staff") throw new HttpError(403, "Only the owner can do this.");
}

export const actorOf = (c: Caller) => `${c.role}:${c.userId}`;

export async function audit(sql: Sql, tenantId: string, actor: string, action: string, detail?: unknown) {
  await sql.execute(`INSERT INTO web_audit (id, tenant_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    randomUUID(), tenantId, actor, action, detail === undefined ? null : JSON.stringify(detail).slice(0, 4000), iso(),
  ]);
}

// ── Signed preview links ──────────────────────────────────────────────────

const secret = () => {
  const s = process.env.SESSION_SECRET ?? "";
  if (s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new HttpError(500, "SESSION_SECRET is missing on the server.");
  return "development-only-preview-secret-not-for-production";
};
const mac = (body: string) => createHmac("sha256", `web-preview:${secret()}`).update(body).digest("base64url");

/** A preview link token for a business's draft, valid for an hour. */
export function previewToken(tenantId: string, now = Date.now()): string {
  const body = `${tenantId}.${now + 3600_000}`;
  return `${Buffer.from(body).toString("base64url")}.${mac(body)}`;
}
export function readPreviewToken(token: string | null | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [b, m] = token.split(".");
  if (!b || !m) return null;
  let body = "";
  try { body = Buffer.from(b, "base64url").toString("utf8"); } catch { return null; }
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(m);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [tenantId, exp] = body.split(".");
  return Number(exp) > now ? tenantId : null;
}

/** In-memory rate limit for public forms (per instance; the order path also checks the database). */
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return list.length > max;
}
export const resetWebRateLimits = () => hits.clear();
