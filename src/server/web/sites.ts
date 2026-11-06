/** Website & Online Store: switching it on (Super Admin), the draft created
 * from the business's own details, settings, pages, publishing with
 * revisions and rollback, and the free subdomain.
 *
 * Enabling is idempotent: the site row is upserted and the starting draft is
 * created only by the request that first marks the site provisioned, so
 * repeated clicks never duplicate pages. Drafts never change the live site
 * until Publish copies them. */
import { randomUUID } from "node:crypto";
import { HttpError } from "../db";
import type { Sql } from "../subSupers";
import { audit, iso, json, loadSite, requireSite, type Site } from "./core";
import {
  RESERVED_PAGE_SLUGS, ValidationError, cleanSections, cleanSettings, cleanStoreSettings, pageSlug, type Section, type SiteSettings,
} from "../../lib/web/sections";
import { TEMPLATES, draftFor, templateFor, type TemplateId } from "../../lib/web/templates";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

/** Turns validation messages into 400 answers. */
export function valid<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof ValidationError) throw new HttpError(400, e.message); throw e; }
}

// ── Free subdomains ───────────────────────────────────────────────────────

/** Names never given to a business (infrastructure and look-alikes). */
export const RESERVED_SUBDOMAINS = new Set([
  "www", "app", "api", "admin", "administrator", "mail", "email", "smtp", "imap", "pop", "mx", "ftp", "sftp", "ssh", "vpn", "ns", "ns1", "ns2", "dns",
  "support", "help", "status", "docs", "blog", "cdn", "static", "assets", "media", "img", "images", "files", "upload", "uploads", "download",
  "dev", "test", "staging", "stage", "beta", "demo", "preview", "sandbox", "localhost", "portal", "dashboard", "login", "signin", "signup", "auth",
  "account", "accounts", "billing", "pay", "payment", "payments", "shop", "store", "checkout", "secure", "security", "root", "system", "web", "site",
  "mavin", "mavinpk", "billora", "official", "fbr", "pral", "drap", "gov", "government", "superadmin", "sub-super", "partner", "partners",
]);

export function normalizeSubdomain(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\.mavin\.pk$/, "");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s)) throw new HttpError(400, "Use 3 to 40 letters, digits or dashes; start and end with a letter or digit.");
  if (s.includes("--")) throw new HttpError(400, "Do not use two dashes in a row.");
  return s;
}

export async function checkSubdomain(sql: Sql, raw: unknown, tenantId?: string): Promise<{ name: string; available: boolean; reason: string | null }> {
  const name = normalizeSubdomain(raw);
  if (RESERVED_SUBDOMAINS.has(name)) return { name, available: false, reason: "This name is reserved." };
  const taken = (await sql.execute(`SELECT tenant_id FROM web_sites WHERE subdomain = ?`, [name])).rows[0];
  if (taken && taken.tenant_id !== tenantId) return { name, available: false, reason: "Another business already uses this name." };
  return { name, available: true, reason: null };
}

/** Reserves the name; the unique index makes two simultaneous claims safe. */
export async function reserveSubdomain(sql: Sql, actor: string, tenantId: string, raw: unknown) {
  await requireSite(sql, tenantId);
  const c = await checkSubdomain(sql, raw, tenantId);
  if (!c.available) throw new HttpError(409, c.reason ?? "Not available.");
  try {
    await sql.execute(`UPDATE web_sites SET subdomain = ?, updated_at = ? WHERE tenant_id = ?`, [c.name, iso(), tenantId]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, "Another business has just taken this name. Try another.");
    throw e;
  }
  await audit(sql, tenantId, actor, "subdomain_set", { subdomain: c.name });
  return { subdomain: c.name };
}

/** A free name from the business name (handspharmacy, handspharmacy2, ...). */
async function suggestSubdomain(sql: Sql, name: string, tenantId: string): Promise<string | null> {
  const base = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "").slice(0, 30) || "shop";
  for (let i = 0; i < 20; i++) {
    const cand = i ? `${base}${i + 1}` : base;
    if (cand.length < 3) continue;
    try { if ((await checkSubdomain(sql, cand, tenantId)).available) return cand; } catch { /* invalid; try next */ }
  }
  return null;
}

// ── Super Admin ───────────────────────────────────────────────────────────

export interface Features { website?: unknown; store?: unknown }

/** Switches the website and/or store on (one action). Safe to repeat. */
export async function enableFeatures(sql: Sql, actor: string, tenantId: string, f: Features) {
  const t = (await sql.execute(`SELECT id, name, phone, email, address, business_type FROM tenants WHERE id = ?`, [tenantId])).rows[0];
  if (!t) throw new HttpError(404, "Business not found.");
  const website = f.website === undefined ? null : Boolean(f.website);
  const store = f.store === undefined ? null : Boolean(f.store);
  const now = iso();
  const template = templateFor(t.business_type as string | null);
  await sql.execute(
    `INSERT INTO web_sites (tenant_id, website_enabled, store_enabled, template, store_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET website_enabled = COALESCE(?, website_enabled), store_enabled = COALESCE(?, store_enabled), updated_at = excluded.updated_at`,
    [tenantId, website ? 1 : 0, store ? 1 : 0, template, null, now, now, website === null ? null : website ? 1 : 0, store === null ? null : store ? 1 : 0],
  );
  // Only the request that marks the site provisioned writes the starting draft.
  const claim = await sql.execute(`UPDATE web_sites SET provisioned_at = ? WHERE tenant_id = ? AND provisioned_at IS NULL`, [now, tenantId]);
  let provisioned = false;
  if (claim.rowsAffected === 1) {
    const site = await loadSite(sql, tenantId);
    const d = draftFor((site?.template as TemplateId) ?? template, { name: String(t.name), phone: (t.phone as string | null) ?? null, email: (t.email as string | null) ?? null, address: (t.address as string | null) ?? null }, Boolean(site?.storeEnabled));
    await sql.batch([
      { sql: `UPDATE web_sites SET draft_settings = ? WHERE tenant_id = ?`, args: [JSON.stringify(d.settings), tenantId] },
      ...d.pages.map((p, i) => ({
        sql: `INSERT INTO web_pages (id, tenant_id, slug, title, kind, draft, in_nav, sort, draft_updated_at, created_at, updated_at)
              SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM web_pages WHERE tenant_id = ? AND slug = ? AND deleted_at IS NULL)`,
        args: [randomUUID(), tenantId, p.slug, p.title, p.kind, JSON.stringify(p.sections), i, now, now, now, tenantId, p.slug],
      })),
    ]);
    const sub = await suggestSubdomain(sql, String(t.name), tenantId);
    if (sub) {
      try { await sql.execute(`UPDATE web_sites SET subdomain = ? WHERE tenant_id = ? AND subdomain IS NULL`, [sub, tenantId]); } catch { /* taken meanwhile: the owner picks one */ }
    }
    provisioned = true;
  }
  await audit(sql, tenantId, actor, "features_set", { website, store, provisioned });
  return { provisioned, site: await loadSite(sql, tenantId) };
}

export interface AdminFlags {
  publicSuspended?: unknown; builderAllowed?: unknown; customDomainAllowed?: unknown; template?: unknown;
  maxPages?: unknown; maxStorageMb?: unknown; maxCustomDomains?: unknown;
}

export async function setAdminFlags(sql: Sql, actor: string, tenantId: string, f: AdminFlags) {
  if (!(await loadSite(sql, tenantId))) throw new HttpError(404, "Switch the website or store on first.");
  const sets: string[] = [];
  const args: unknown[] = [];
  const flag = (col: string, v: unknown) => { if (v !== undefined) { sets.push(`${col} = ?`); args.push(v ? 1 : 0); } };
  flag("public_suspended", f.publicSuspended);
  flag("builder_allowed", f.builderAllowed);
  flag("custom_domain_allowed", f.customDomainAllowed);
  if (f.template !== undefined) {
    if (typeof f.template !== "string" || !(f.template in TEMPLATES)) throw new HttpError(400, "Unknown template.");
    sets.push("template = ?"); args.push(f.template);
  }
  const limit = (col: string, v: unknown, max: number) => {
    if (v === undefined) return;
    if (v === null || v === "") { sets.push(`${col} = NULL`); return; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `Limits are whole numbers from 0 to ${max}.`);
    sets.push(`${col} = ?`); args.push(n);
  };
  limit("max_pages", f.maxPages, 500);
  limit("max_storage_mb", f.maxStorageMb, 100_000);
  limit("max_custom_domains", f.maxCustomDomains, 50);
  if (!sets.length) return;
  await sql.execute(`UPDATE web_sites SET ${sets.join(", ")}, updated_at = ? WHERE tenant_id = ?`, [...args, iso(), tenantId]);
  await audit(sql, tenantId, actor, "admin_flags_set", f);
}

/** Applies a template to the draft home page (replaces its sections; publish to make it live). */
export async function applyTemplate(sql: Sql, actor: string, tenantId: string, template: unknown) {
  const site = await requireSite(sql, tenantId);
  if (!(typeof template === "string" && template in TEMPLATES)) throw new HttpError(400, "Unknown template.");
  const t = (await sql.execute(`SELECT name, phone, email, address FROM tenants WHERE id = ?`, [tenantId])).rows[0];
  const d = draftFor(template as TemplateId, { name: site.draftSettings?.name ?? String(t?.name ?? ""), phone: (t?.phone as string | null) ?? null, email: (t?.email as string | null) ?? null, address: (t?.address as string | null) ?? null }, site.storeEnabled);
  const home = d.pages.find((p) => p.slug === "home")!;
  await sql.batch([
    { sql: `UPDATE web_sites SET template = ?, updated_at = ? WHERE tenant_id = ?`, args: [template, iso(), tenantId] },
    { sql: `UPDATE web_pages SET draft = ?, draft_updated_at = ?, updated_at = ? WHERE tenant_id = ? AND slug = 'home' AND deleted_at IS NULL`, args: [JSON.stringify(home.sections), iso(), iso(), tenantId] },
  ]);
  await audit(sql, tenantId, actor, "template_applied", { template });
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function saveDraftSettings(sql: Sql, actor: string, tenantId: string, input: unknown): Promise<SiteSettings> {
  const site = await requireSite(sql, tenantId);
  if (!site.builderAllowed) throw new HttpError(403, "Website editing is turned off for this business.");
  const s = valid(() => cleanSettings(input, site.tenantName));
  await sql.execute(`UPDATE web_sites SET draft_settings = ?, updated_at = ? WHERE tenant_id = ?`, [JSON.stringify(s), iso(), tenantId]);
  await audit(sql, tenantId, actor, "settings_saved");
  return s;
}

export async function saveStoreSettings(sql: Sql, actor: string, tenantId: string, input: unknown) {
  const site = await requireSite(sql, tenantId);
  if (!site.storeEnabled) throw new HttpError(403, "The online store is not switched on for this business.");
  const s = valid(() => cleanStoreSettings(input));
  await sql.execute(`UPDATE web_sites SET store_settings = ?, updated_at = ? WHERE tenant_id = ?`, [JSON.stringify(s), iso(), tenantId]);
  await audit(sql, tenantId, actor, "store_settings_saved");
  return s;
}

// ── Pages ─────────────────────────────────────────────────────────────────

export interface PageRow { id: string; slug: string; title: string; kind: string; sections: Section[]; published: Section[] | null; seoTitle: string; seoDescription: string; inNav: boolean; sort: number; draftUpdatedAt: string | null; publishedAt: string | null; changed: boolean }

const toPage = (r: Record<string, unknown>): PageRow => ({
  id: String(r.id), slug: String(r.slug), title: String(r.title), kind: String(r.kind),
  sections: json<Section[]>(r.draft, []), published: r.published ? json<Section[]>(r.published, []) : null,
  seoTitle: String(r.seo_title ?? ""), seoDescription: String(r.seo_description ?? ""), inNav: Number(r.in_nav) === 1, sort: Number(r.sort) || 0,
  draftUpdatedAt: (r.draft_updated_at as string | null) ?? null, publishedAt: (r.published_at as string | null) ?? null,
  changed: !r.published || String(r.published) !== String(r.draft),
});

export async function listPages(sql: Sql, tenantId: string): Promise<PageRow[]> {
  return (await sql.execute(`SELECT * FROM web_pages WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY sort, created_at`, [tenantId])).rows.map(toPage);
}

async function pageOf(sql: Sql, tenantId: string, pageId: string) {
  const r = (await sql.execute(`SELECT * FROM web_pages WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [pageId, tenantId])).rows[0];
  if (!r) throw new HttpError(404, "Page not found.");
  return r;
}

/** Saves a page's draft. `base` is the draft version the editor started from;
 * a newer save by someone else is not overwritten (409). */
export async function savePageDraft(sql: Sql, actor: string, tenantId: string, pageId: string, p: { sections?: unknown; title?: unknown; seoTitle?: unknown; seoDescription?: unknown; inNav?: unknown; base?: unknown }) {
  const site = await requireSite(sql, tenantId);
  if (!site.builderAllowed) throw new HttpError(403, "Website editing is turned off for this business.");
  const r = await pageOf(sql, tenantId, pageId);
  if (typeof p.base === "string" && r.draft_updated_at && p.base !== r.draft_updated_at) {
    throw new HttpError(409, "This page was changed in another window. Reload to see the latest version.");
  }
  const sections = p.sections === undefined ? json<Section[]>(r.draft, []) : valid(() => cleanSections(p.sections));
  const title = p.title === undefined ? String(r.title) : String(p.title ?? "").trim().slice(0, 60);
  if (!title) throw new HttpError(400, "Give the page a title.");
  const seoTitle = p.seoTitle === undefined ? r.seo_title : String(p.seoTitle ?? "").trim().slice(0, 70) || null;
  const seoDescription = p.seoDescription === undefined ? r.seo_description : String(p.seoDescription ?? "").trim().slice(0, 170) || null;
  const now = iso();
  await sql.execute(
    `UPDATE web_pages SET draft = ?, title = ?, seo_title = ?, seo_description = ?, in_nav = ?, draft_updated_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
    [JSON.stringify(sections), title, seoTitle, seoDescription, p.inNav === undefined ? r.in_nav : p.inNav ? 1 : 0, now, now, pageId, tenantId],
  );
  return { draftUpdatedAt: now, sections };
}

export async function createPage(sql: Sql, actor: string, tenantId: string, p: { title?: unknown; slug?: unknown }) {
  const site = await requireSite(sql, tenantId);
  if (!site.builderAllowed) throw new HttpError(403, "Website editing is turned off for this business.");
  const title = String(p.title ?? "").trim().slice(0, 60);
  if (title.length < 2) throw new HttpError(400, "Give the page a title.");
  const slug = pageSlug(String(p.slug || title));
  if (slug.length < 2 || RESERVED_PAGE_SLUGS.has(slug) || slug === "home") throw new HttpError(400, "Choose another page address.");
  const count = Number((await sql.execute(`SELECT COUNT(*) AS n FROM web_pages WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId])).rows[0]?.n ?? 0);
  if (count >= site.limits.pages) throw new HttpError(403, `Your plan allows up to ${site.limits.pages} pages.`);
  const id = randomUUID();
  const now = iso();
  try {
    await sql.execute(
      `INSERT INTO web_pages (id, tenant_id, slug, title, kind, draft, in_nav, sort, draft_updated_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'page', ?, 1, ?, ?, ?, ?)`,
      [id, tenantId, slug, title, JSON.stringify([{ id: `s-${id.slice(0, 8)}`, type: "about", heading: title, text: "" }]), count, now, now, now],
    );
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new HttpError(409, "A page with this address already exists.");
    throw e;
  }
  await audit(sql, tenantId, actor, "page_created", { slug });
  return { id, slug };
}

export async function deletePage(sql: Sql, actor: string, tenantId: string, pageId: string) {
  const r = await pageOf(sql, tenantId, pageId);
  if (r.kind === "home") throw new HttpError(400, "The home page cannot be deleted.");
  await sql.execute(`UPDATE web_pages SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`, [iso(), iso(), pageId, tenantId]);
  await audit(sql, tenantId, actor, "page_deleted", { slug: r.slug });
}

export async function reorderPages(sql: Sql, tenantId: string, ids: unknown) {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) throw new HttpError(400, "Send the page order.");
  await sql.batch((ids as string[]).map((id, i) => ({ sql: `UPDATE web_pages SET sort = ? WHERE id = ? AND tenant_id = ?`, args: [i, id, tenantId] })));
}

// ── Publish, unpublish, rollback ──────────────────────────────────────────

interface Snapshot { settings: SiteSettings | null; pages: { slug: string; title: string; kind: string; sections: Section[]; seoTitle: string; seoDescription: string; inNav: boolean; sort: number }[] }

/** Makes the drafts live and keeps a revision. */
export async function publishSite(sql: Sql, actor: string, tenantId: string, note?: unknown) {
  const site = await requireSite(sql, tenantId);
  if (!site.websiteEnabled && !site.storeEnabled) throw new HttpError(403, "The website is not switched on.");
  if (!site.draftSettings) throw new HttpError(400, "Fill in Website Settings first.");
  const pages = await listPages(sql, tenantId);
  if (site.websiteEnabled && !pages.some((p) => p.kind === "home")) throw new HttpError(400, "The website needs a home page.");
  const snap: Snapshot = { settings: site.draftSettings, pages: pages.map((p) => ({ slug: p.slug, title: p.title, kind: p.kind, sections: p.sections, seoTitle: p.seoTitle, seoDescription: p.seoDescription, inNav: p.inNav, sort: p.sort })) };
  const now = iso();
  await sql.batch([
    { sql: `UPDATE web_sites SET settings = draft_settings, status = 'published', published_at = ?, updated_at = ? WHERE tenant_id = ?`, args: [now, now, tenantId] },
    { sql: `UPDATE web_pages SET published = draft, published_at = ? WHERE tenant_id = ? AND deleted_at IS NULL`, args: [now, tenantId] },
    // Deleted pages leave the live site too.
    { sql: `UPDATE web_pages SET published = NULL WHERE tenant_id = ? AND deleted_at IS NOT NULL`, args: [tenantId] },
    { sql: `INSERT INTO web_revisions (id, tenant_id, snapshot, note, published_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`, args: [randomUUID(), tenantId, JSON.stringify(snap), typeof note === "string" ? note.slice(0, 200) : null, actor, now] },
  ]);
  await audit(sql, tenantId, actor, "published", { pages: pages.length });
  return { publishedAt: now };
}

export async function unpublishSite(sql: Sql, actor: string, tenantId: string) {
  await requireSite(sql, tenantId);
  await sql.execute(`UPDATE web_sites SET status = 'draft', updated_at = ? WHERE tenant_id = ?`, [iso(), tenantId]);
  await audit(sql, tenantId, actor, "unpublished");
}

export async function listRevisions(sql: Sql, tenantId: string) {
  return (await sql.execute(`SELECT id, note, published_by, created_at FROM web_revisions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50`, [tenantId])).rows
    .map((r) => ({ id: String(r.id), note: (r.note as string | null) ?? null, by: String(r.published_by ?? ""), at: String(r.created_at) }));
}

/** Puts an earlier published version live again (and back into the editor), as a new revision. */
export async function rollbackTo(sql: Sql, actor: string, tenantId: string, revisionId: string) {
  await requireSite(sql, tenantId);
  const r = (await sql.execute(`SELECT snapshot, created_at FROM web_revisions WHERE id = ? AND tenant_id = ?`, [revisionId, tenantId])).rows[0];
  if (!r) throw new HttpError(404, "Revision not found.");
  const snap = json<Snapshot>(r.snapshot, { settings: null, pages: [] });
  const now = iso();
  const existing = new Map((await sql.execute(`SELECT id, slug FROM web_pages WHERE tenant_id = ? AND deleted_at IS NULL`, [tenantId])).rows.map((x) => [String(x.slug), String(x.id)]));
  const stmts: { sql: string; args: unknown[] }[] = [
    { sql: `UPDATE web_sites SET settings = ?, draft_settings = ?, status = 'published', published_at = ?, updated_at = ? WHERE tenant_id = ?`, args: [JSON.stringify(snap.settings), JSON.stringify(snap.settings), now, now, tenantId] },
    // Pages not in that version leave the live site (they stay as drafts).
    { sql: `UPDATE web_pages SET published = NULL WHERE tenant_id = ?`, args: [tenantId] },
  ];
  for (const p of snap.pages) {
    const body = JSON.stringify(p.sections);
    const id = existing.get(p.slug);
    if (id) {
      stmts.push({ sql: `UPDATE web_pages SET title = ?, kind = ?, draft = ?, published = ?, seo_title = ?, seo_description = ?, in_nav = ?, sort = ?, draft_updated_at = ?, published_at = ?, updated_at = ? WHERE id = ?`, args: [p.title, p.kind, body, body, p.seoTitle || null, p.seoDescription || null, p.inNav ? 1 : 0, p.sort, now, now, now, id] });
    } else {
      stmts.push({ sql: `INSERT INTO web_pages (id, tenant_id, slug, title, kind, draft, published, seo_title, seo_description, in_nav, sort, draft_updated_at, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [randomUUID(), tenantId, p.slug, p.title, p.kind, body, body, p.seoTitle || null, p.seoDescription || null, p.inNav ? 1 : 0, p.sort, now, now, now, now] });
    }
  }
  stmts.push({ sql: `INSERT INTO web_revisions (id, tenant_id, snapshot, note, published_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`, args: [randomUUID(), tenantId, String(r.snapshot), `Rolled back to ${String(r.created_at).slice(0, 16).replace("T", " ")}`, actor, now] });
  await sql.batch(stmts);
  await audit(sql, tenantId, actor, "rolled_back", { revisionId });
}

/** Everything the Website screen needs at once. */
export async function overviewFor(sql: Sql, tenantId: string) {
  const site = await loadSite(sql, tenantId);
  if (!site) return { site: null };
  const pages = await listPages(sql, tenantId);
  const counts = (await sql.execute(
    `SELECT (SELECT COUNT(*) FROM web_products WHERE tenant_id = ? AND show_online = 1) AS listed,
            (SELECT COUNT(*) FROM web_orders WHERE tenant_id = ? AND status IN ('pending','confirmed','preparing','ready','dispatched')) AS open_orders,
            (SELECT COUNT(*) FROM web_requests WHERE tenant_id = ? AND status = 'new') AS new_requests,
            (SELECT COUNT(*) FROM web_domains WHERE tenant_id = ?) AS domains`,
    [tenantId, tenantId, tenantId, tenantId],
  )).rows[0] ?? {};
  return {
    site: publicSiteView(site), pages, unpublishedChanges: pages.some((p) => p.changed) || JSON.stringify(site.settings) !== JSON.stringify(site.draftSettings),
    counts: { listed: Number(counts.listed) || 0, openOrders: Number(counts.open_orders) || 0, newRequests: Number(counts.new_requests) || 0, domains: Number(counts.domains) || 0 },
    templates: TEMPLATES,
  };
}

/** The site as the management screens see it. */
export function publicSiteView(s: Site) {
  return {
    websiteEnabled: s.websiteEnabled, storeEnabled: s.storeEnabled, publicSuspended: s.publicSuspended, builderAllowed: s.builderAllowed,
    customDomainAllowed: s.customDomainAllowed, template: s.template, subdomain: s.subdomain, status: s.status, publishedAt: s.publishedAt,
    draftSettings: s.draftSettings, storeSettings: s.storeSettings, limits: s.limits, storageBytes: s.storageBytes, tenantName: s.tenantName,
    businessType: s.businessType, tenantActive: s.tenantActive,
  };
}
