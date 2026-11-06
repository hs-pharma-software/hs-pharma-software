/** Website hosts: which business a request's host belongs to, and custom
 * domains connected through Vercel.
 *
 * A host selects a business only if it is listed: a free subdomain
 * (<name>.mavin.pk, from web_sites) or a custom domain in web_domains whose
 * status is active. Nothing else in the request (forwarded hosts, headers,
 * paths) picks the business.
 *
 * Connecting a domain: Pending verification (our TXT record proves the
 * business controls the domain) -> DNS pending (the domain is added to the
 * Vercel project; it must verify and point to Vercel) -> SSL pending (a real
 * HTTPS request must succeed) -> Active. Errors are kept with the domain. */
import { randomBytes, randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { HttpError } from "../db";
import type { Sql } from "../subSupers";
import { audit, iso, json, loadSite, requireSite } from "./core";
import { RESERVED_SUBDOMAINS } from "./sites";
import { vercelConfig, type VercelConfig } from "../seo/vercel";
import { defaultHttp, type Http } from "../seo/google";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** The platform domain whose subdomains are free business addresses. */
export const PLATFORM_DOMAIN = (process.env.WEB_PLATFORM_DOMAIN || "mavin.pk").toLowerCase();

export type Target = "website" | "store" | "portal";
export interface Resolved { tenantId: string; via: "subdomain" | "domain"; target: Target | "shared"; host: string }

export function cleanHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9.-]{3,253}$/.test(h) && !h.includes("..") ? h : null;
}

/** The business a host belongs to, or null (unknown hosts get nothing). */
export async function resolveHost(sql: Sql, rawHost: string | null | undefined): Promise<Resolved | null> {
  const host = cleanHost(rawHost);
  if (!host) return null;
  const suffix = `.${PLATFORM_DOMAIN}`;
  if (host.endsWith(suffix)) {
    const sub = host.slice(0, -suffix.length);
    if (!sub || sub.includes(".") || RESERVED_SUBDOMAINS.has(sub)) return null;
    const r = (await sql.execute(`SELECT tenant_id FROM web_sites WHERE subdomain = ?`, [sub])).rows[0];
    return r ? { tenantId: String(r.tenant_id), via: "subdomain", target: "shared", host } : null;
  }
  const d = (await sql.execute(`SELECT tenant_id, target FROM web_domains WHERE host = ? AND status = 'active'`, [host])).rows[0];
  return d ? { tenantId: String(d.tenant_id), via: "domain", target: String(d.target) as Target, host } : null;
}

/** The address search engines should use for a business's website or store. */
export async function canonicalBase(sql: Sql, tenantId: string, target: "website" | "store"): Promise<string | null> {
  const d = (await sql.execute(`SELECT host FROM web_domains WHERE tenant_id = ? AND target = ? AND status = 'active' ORDER BY is_primary DESC, activated_at LIMIT 1`, [tenantId, target])).rows[0];
  if (d) return `https://${d.host}`;
  const s = (await sql.execute(`SELECT subdomain FROM web_sites WHERE tenant_id = ?`, [tenantId])).rows[0];
  return s?.subdomain ? `https://${s.subdomain}.${PLATFORM_DOMAIN}${target === "store" ? "/shop" : ""}` : null;
}

// ── Custom domains ────────────────────────────────────────────────────────

export function normalizeDomain(raw: unknown): string {
  let s = String(raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  s = cleanHost(s) ?? "";
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) throw new HttpError(400, "Enter a domain like www.yourshop.pk (no http://, no paths).");
  if (s === PLATFORM_DOMAIN || s.endsWith(`.${PLATFORM_DOMAIN}`)) throw new HttpError(400, `${PLATFORM_DOMAIN} addresses are set under Free address, not here.`);
  if (/\.vercel\.app$|^localhost/.test(s)) throw new HttpError(400, "Use a domain you own.");
  return s;
}

export const verifyRecordName = (host: string) => `_mavin-verify.${host}`;

export interface DomainView { id: string; host: string; target: Target; isPrimary: boolean; status: string; error: string | null; lastCheckedAt: string | null; records: { type: string; name: string; value: string; why: string }[] }

const view = (r: Record<string, unknown>): DomainView => {
  const v = json<{ token?: string; records?: DomainView["records"] }>(r.verification, {});
  return {
    id: String(r.id), host: String(r.host), target: String(r.target) as Target, isPrimary: Number(r.is_primary) === 1, status: String(r.status),
    error: (r.error as string | null) ?? null, lastCheckedAt: (r.last_checked_at as string | null) ?? null,
    records: [{ type: "TXT", name: verifyRecordName(String(r.host)), value: `mavin-verify=${v.token ?? ""}`, why: "Proves your business controls this domain." }, ...(v.records ?? [])],
  };
};

export async function listDomains(sql: Sql, tenantId: string): Promise<DomainView[]> {
  return (await sql.execute(`SELECT * FROM web_domains WHERE tenant_id = ? ORDER BY target, created_at`, [tenantId])).rows.map(view);
}

export async function addDomain(sql: Sql, actor: string, tenantId: string, rawHost: unknown, target: unknown) {
  const site = await requireSite(sql, tenantId);
  if (!site.customDomainAllowed) throw new HttpError(403, "Custom domains are not included for this business. Ask the administrator.");
  if (!["website", "store", "portal"].includes(String(target))) throw new HttpError(400, "Choose what the domain opens: website, store or portal.");
  if (target === "store" && !site.storeEnabled) throw new HttpError(400, "The online store is not switched on.");
  const host = normalizeDomain(rawHost);
  const count = Number((await sql.execute(`SELECT COUNT(*) AS n FROM web_domains WHERE tenant_id = ?`, [tenantId])).rows[0]?.n ?? 0);
  if (count >= site.limits.customDomains) throw new HttpError(403, `Your plan allows up to ${site.limits.customDomains} custom domains.`);
  const token = randomBytes(16).toString("hex");
  const first = !(await sql.execute(`SELECT 1 FROM web_domains WHERE tenant_id = ? AND target = ?`, [tenantId, target])).rows.length;
  try {
    await sql.execute(
      `INSERT INTO web_domains (id, tenant_id, host, target, is_primary, status, verification, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending_verification', ?, ?, ?)`,
      [randomUUID(), tenantId, host, target, first ? 1 : 0, JSON.stringify({ token }), iso(), iso()],
    );
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, "This domain is already connected to a business. If it is yours, remove it there first or contact support.");
    throw e;
  }
  await audit(sql, tenantId, actor, "domain_added", { host, target });
  return (await listDomains(sql, tenantId)).find((d) => d.host === host)!;
}

export interface DomainDeps { txt?: (name: string) => Promise<string[][]>; vercel?: VercelConfig | null; http?: Http; https?: (host: string) => Promise<boolean> }

const vercelUrl = (cfg: VercelConfig, path: string) => `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}${cfg.teamId ? `teamId=${encodeURIComponent(cfg.teamId)}` : ""}`;
async function vercel<T>(http: Http, cfg: VercelConfig, method: "GET" | "POST", path: string, body?: unknown, ok = [200]): Promise<{ status: number; json: T }> {
  const r = await http(vercelUrl(cfg, path), { method, headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!ok.includes(r.status)) {
    const e = (r.json as { error?: { code?: string; message?: string } }).error;
    throw new Error(`Vercel answered ${r.status}${e?.code ? ` (${e.code})` : ""}: ${e?.message ?? "no details"}`);
  }
  return { status: r.status, json: r.json as T };
}

const httpsWorks = async (host: string) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try { const r = await fetch(`https://${host}/`, { method: "HEAD", redirect: "manual", signal: ctrl.signal }); return r.status > 0; } catch { return false; } finally { clearTimeout(timer); }
};

/** Checks a domain and moves it as far along as the facts allow. Never marks it
 * active on a DNS record alone: ownership, Vercel's verification and a real
 * HTTPS answer are all required. */
export async function checkDomain(sql: Sql, actor: string, tenantId: string, id: string, deps: DomainDeps = {}): Promise<DomainView> {
  const r = (await sql.execute(`SELECT * FROM web_domains WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!r) throw new HttpError(404, "Domain not found.");
  const host = String(r.host);
  const v = json<{ token?: string; records?: DomainView["records"]; addedToVercel?: boolean }>(r.verification, {});
  const save = async (status: string, error: string | null, extra: Partial<typeof v> = {}) => {
    const next = { ...v, ...extra };
    await sql.execute(
      `UPDATE web_domains SET status = ?, error = ?, verification = ?, last_checked_at = ?, activated_at = CASE WHEN ? = 'active' AND activated_at IS NULL THEN ? ELSE activated_at END, updated_at = ? WHERE id = ?`,
      [status, error, JSON.stringify(next), iso(), status, iso(), iso(), id],
    );
    if (status !== String(r.status)) await audit(sql, tenantId, actor, "domain_status", { host, from: r.status, to: status, error });
    return (await listDomains(sql, tenantId)).find((d) => d.id === id)!;
  };

  // 1. Ownership: our TXT record.
  const txt = deps.txt ?? ((name: string) => resolveTxt(name));
  let owned = false;
  try { owned = (await txt(verifyRecordName(host))).some((parts) => parts.join("") === `mavin-verify=${v.token}`); } catch { owned = false; }
  if (!owned) return save("pending_verification", `Add the TXT record ${verifyRecordName(host)} with the value shown, then check again (DNS can take up to an hour).`);

  // 2. Hosting: the domain must be on the Vercel project and point to it.
  const cfg = deps.vercel === undefined ? vercelConfig() : deps.vercel;
  if (!cfg) return save("dns_pending", "Ownership confirmed. The platform's Vercel connection (VERCEL_API_TOKEN, VERCEL_PROJECT_ID) is not set up, so the domain cannot be attached yet. Ask the administrator.");
  const http = deps.http ?? defaultHttp;
  const project = encodeURIComponent(cfg.projectId);
  try {
    if (!v.addedToVercel) {
      const add = await vercel<{ verified?: boolean }>(http, cfg, "POST", `/v10/projects/${project}/domains`, { name: host }, [200, 409]);
      if (add.status === 409) {
        // Already on a project: it must be ours (the GET below fails otherwise).
        await vercel(http, cfg, "GET", `/v9/projects/${project}/domains/${encodeURIComponent(host)}`);
      }
      v.addedToVercel = true;
    }
    let d = (await vercel<{ verified?: boolean; verification?: { type: string; domain: string; value: string; reason?: string }[] }>(http, cfg, "GET", `/v9/projects/${project}/domains/${encodeURIComponent(host)}`)).json;
    if (!d.verified) {
      const again = (await vercel<typeof d>(http, cfg, "POST", `/v9/projects/${project}/domains/${encodeURIComponent(host)}/verify`, undefined, [200, 400])).json;
      // A failed verification may answer without the records: keep the ones already known.
      d = { verified: Boolean(again?.verified), verification: again?.verification ?? d.verification };
    }
    const conf = (await vercel<{ misconfigured?: boolean; recommendedIPv4?: { rank: number; value: string[] }[]; recommendedCNAME?: { rank: number; value: string }[] }>(http, cfg, "GET", `/v6/domains/${encodeURIComponent(host)}/config`)).json;
    // DNS records exactly as Vercel recommends for this domain.
    const apex = host.split(".").length === 2 || /\.(com|org|net|edu|gov)\.pk$/.test(host) && host.split(".").length === 3;
    const records: DomainView["records"] = [];
    const cname = [...(conf.recommendedCNAME ?? [])].sort((a, b) => a.rank - b.rank)[0]?.value;
    const ipv4 = [...(conf.recommendedIPv4 ?? [])].sort((a, b) => a.rank - b.rank)[0]?.value ?? [];
    if (!apex && cname) records.push({ type: "CNAME", name: host, value: cname.replace(/\.$/, ""), why: "Points the domain to MAVIN.pk hosting." });
    else for (const ip of ipv4) records.push({ type: "A", name: host, value: ip, why: "Points the domain to MAVIN.pk hosting." });
    for (const x of d.verification ?? []) records.push({ type: x.type, name: x.domain, value: x.value, why: "Requested by the hosting provider to verify the domain." });
    if (!d.verified || conf.misconfigured) return save("dns_pending", "Ownership confirmed. Add the DNS records shown (they come from the hosting provider), then check again.", { records, addedToVercel: true });
    // 3. Certificate: only a working HTTPS answer counts.
    const ok = await (deps.https ?? httpsWorks)(host);
    if (!ok) return save("ssl_pending", "DNS is correct. The HTTPS certificate is being issued; check again in a few minutes.", { records, addedToVercel: true });
    return save("active", null, { records, addedToVercel: true });
  } catch (e) {
    return save("error", e instanceof Error ? e.message.slice(0, 400) : String(e), { addedToVercel: v.addedToVercel });
  }
}

export async function setPrimary(sql: Sql, actor: string, tenantId: string, id: string) {
  const r = (await sql.execute(`SELECT host, target FROM web_domains WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!r) throw new HttpError(404, "Domain not found.");
  await sql.batch([
    { sql: `UPDATE web_domains SET is_primary = 0 WHERE tenant_id = ? AND target = ?`, args: [tenantId, r.target] },
    { sql: `UPDATE web_domains SET is_primary = 1, updated_at = ? WHERE id = ? AND tenant_id = ?`, args: [iso(), id, tenantId] },
  ]);
  await audit(sql, tenantId, actor, "domain_primary", { host: r.host });
}

/** Disconnects a domain: it stops resolving at once, and is removed from the Vercel project. */
export async function removeDomain(sql: Sql, actor: string, tenantId: string, id: string, deps: DomainDeps = {}) {
  const r = (await sql.execute(`SELECT host, verification FROM web_domains WHERE id = ? AND tenant_id = ?`, [id, tenantId])).rows[0];
  if (!r) throw new HttpError(404, "Domain not found.");
  await sql.execute(`DELETE FROM web_domains WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  const cfg = deps.vercel === undefined ? vercelConfig() : deps.vercel;
  let note: string | null = null;
  if (cfg && json<{ addedToVercel?: boolean }>(r.verification, {}).addedToVercel) {
    try {
      const res = await (deps.http ?? defaultHttp)(vercelUrl(cfg, `/v9/projects/${encodeURIComponent(cfg.projectId)}/domains/${encodeURIComponent(String(r.host))}`), { method: "DELETE", headers: { Authorization: `Bearer ${cfg.token}` } });
      if (res.status !== 200 && res.status !== 404) note = `Removed here; the hosting provider answered ${res.status}, so remove ${r.host} from the Vercel project by hand.`;
    } catch { note = `Removed here; remove ${r.host} from the Vercel project by hand.`; }
  }
  await audit(sql, tenantId, actor, "domain_removed", { host: r.host, note });
  return { note };
}

/** For login on a portal domain: the business it belongs to (null elsewhere). */
export async function portalTenantFor(sql: Sql, rawHost: string | null): Promise<string | null> {
  const host = cleanHost(rawHost);
  if (!host) return null;
  try {
    const r = (await sql.execute(`SELECT tenant_id FROM web_domains WHERE host = ? AND target = 'portal' AND status = 'active'`, [host])).rows[0];
    return r ? String(r.tenant_id) : null;
  } catch {
    return null; // before migration v76
  }
}

export { loadSite };
