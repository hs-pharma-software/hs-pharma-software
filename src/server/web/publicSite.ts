/** What a public website request may show: the business behind the host
 * (allowlist only), its published pages and settings, or its drafts when a
 * valid preview link for that same business is used. Suspended, switched-off
 * or unpublished websites show nothing. */
import type { Sql } from "../subSupers";
import { json, loadSite, readPreviewToken, type Site } from "./core";
import { canonicalBase, resolveHost, type Resolved } from "./domains";
import { publicCatalog, publicCategories, type PublicProduct } from "./store";
import type { Section, SiteSettings } from "../../lib/web/sections";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface PublicPage { slug: string; title: string; kind: string; inNav: boolean; sections: Section[]; seoTitle: string; seoDescription: string }

export interface WebContext {
  site: Site;
  host: Resolved;
  preview: string | null;
  settings: SiteSettings;
  pages: PublicPage[];
  /** Where the store lives on this host ("" on a store domain). */
  storeBase: string;
  websiteOn: boolean;
  storeOn: boolean;
  canonicalWebsite: string | null;
  canonicalStore: string | null;
}

export async function webContext(sql: Sql, rawHost: string | null, previewParam: string | null): Promise<WebContext | null> {
  const host = await resolveHost(sql, rawHost);
  if (!host || host.target === "portal") return null;
  const site = await loadSite(sql, host.tenantId);
  if (!site || site.publicSuspended || !site.tenantActive) return null;
  const previewTenant = readPreviewToken(previewParam);
  const preview = previewTenant === site.tenantId ? previewParam : null;
  if (!preview && site.status !== "published") return null;
  const settings = preview ? site.draftSettings : site.settings;
  if (!settings) return null;
  const rows = (await sql.execute(
    `SELECT slug, title, kind, in_nav, draft, published, seo_title, seo_description FROM web_pages WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY sort, created_at`,
    [site.tenantId],
  )).rows;
  const pages = rows
    .filter((r) => preview || r.published)
    .map((r) => ({
      slug: String(r.slug), title: String(r.title), kind: String(r.kind), inNav: Number(r.in_nav) === 1,
      sections: json<Section[]>(preview ? r.draft : r.published, []).filter((s) => !s.hidden),
      seoTitle: String(r.seo_title ?? ""), seoDescription: String(r.seo_description ?? ""),
    }));
  return {
    site, host, preview, settings, pages,
    storeBase: host.target === "store" ? "" : "/shop",
    websiteOn: site.websiteEnabled && host.target !== "store",
    storeOn: site.storeEnabled,
    canonicalWebsite: await canonicalBase(sql, site.tenantId, "website"),
    canonicalStore: await canonicalBase(sql, site.tenantId, "store"),
  };
}

/** Data the sections show (only what is meant to be public). */
export async function sectionData(sql: Sql, ctx: WebContext, sections: Section[]) {
  const types = new Set(sections.map((s) => s.type));
  const t = ctx.site.tenantId;
  const out: { featured: PublicProduct[]; categories: string[]; doctors: { name: string; specialty: string; qualification: string; days: string }[]; departments: { name: string; type: string }[] } = { featured: [], categories: [], doctors: [], departments: [] };
  if (ctx.storeOn && types.has("featured")) {
    const limit = Math.max(...sections.filter((s) => s.type === "featured").map((s) => s.limit ?? 8));
    out.featured = await publicCatalog(sql, ctx.site, { featured: true, limit });
    if (!out.featured.length) out.featured = await publicCatalog(sql, ctx.site, { limit });
  }
  if (ctx.storeOn && types.has("categories")) out.categories = await publicCategories(sql, ctx.site);
  if (types.has("doctors")) {
    out.doctors = (await sql.execute(`SELECT name, specialization, qualification, available_days FROM clinic_doctors WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY name LIMIT 60`, [t]).catch(() => ({ rows: [] }))).rows
      .map((r) => ({ name: String(r.name), specialty: String(r.specialization ?? ""), qualification: String(r.qualification ?? ""), days: String(r.available_days ?? "") }));
  }
  if (types.has("departments")) {
    out.departments = (await sql.execute(`SELECT name, type FROM hospital_departments WHERE tenant_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY name LIMIT 60`, [t]).catch(() => ({ rows: [] }))).rows
      .map((r) => ({ name: String(r.name), type: String(r.type ?? "") }));
  }
  return out;
}
export type SectionData = Awaited<ReturnType<typeof sectionData>>;
