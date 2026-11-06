/** Settings > Website: the business manages its website, store and orders
 * (owner, or staff with Settings access; order handling also with "web_orders").
 * The Super Admin may act on a business by passing tenantId. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { actorOf, assertCanEdit, assertOwner, managedTenant, previewToken } from "@/server/web/core";
import * as sites from "@/server/web/sites";
import * as store from "@/server/web/store";
import * as domains from "@/server/web/domains";
import { listMedia, deleteMedia } from "@/server/web/media";
import { vercelConfig } from "@/server/seo/vercel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Actions staff with only "web_orders" may use. */
const ORDER_ACTIONS = new Set(["overview", "orders", "order", "orderStatus", "payment", "rxReview", "orderForInvoice", "linkInvoice", "requests", "requestStatus"]);

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const tenantId = managedTenant(caller, b.tenantId);
    const action = String(b.action ?? "");
    if (!ORDER_ACTIONS.has(action)) assertCanEdit(caller);
    const sql = sqlForServer();
    const actor = actorOf(caller);
    const id = typeof b.id === "string" ? b.id : "";
    let result: unknown;
    switch (action) {
      case "overview":
        result = { ...(await sites.overviewFor(sql, tenantId)), platformDomain: domains.PLATFORM_DOMAIN, hostingConnected: Boolean(vercelConfig()) };
        break;
      // Settings and pages
      case "settings": result = await sites.saveDraftSettings(sql, actor, tenantId, b.settings); break;
      case "storeSettings": result = await sites.saveStoreSettings(sql, actor, tenantId, b.settings); break;
      case "pages": result = await sites.listPages(sql, tenantId); break;
      case "savePage": result = await sites.savePageDraft(sql, actor, tenantId, id, { sections: b.sections, title: b.title, seoTitle: b.seoTitle, seoDescription: b.seoDescription, inNav: b.inNav, base: b.base }); break;
      case "createPage": result = await sites.createPage(sql, actor, tenantId, { title: b.title, slug: b.slug }); break;
      case "deletePage": result = await sites.deletePage(sql, actor, tenantId, id); break;
      case "reorderPages": result = await sites.reorderPages(sql, tenantId, b.ids); break;
      case "applyTemplate": result = await sites.applyTemplate(sql, actor, tenantId, b.template); break;
      case "publish": result = await sites.publishSite(sql, actor, tenantId, b.note); break;
      case "unpublish": assertOwner(caller); result = await sites.unpublishSite(sql, actor, tenantId); break;
      case "revisions": result = await sites.listRevisions(sql, tenantId); break;
      case "rollback": result = await sites.rollbackTo(sql, actor, tenantId, id); break;
      case "preview": result = { token: previewToken(tenantId) }; break;
      case "media": result = await listMedia(sql, tenantId); break;
      case "deleteMedia": result = await deleteMedia(sql, actor, tenantId, id); break;
      // Free address and custom domains (owner only)
      case "checkSubdomain": result = await sites.checkSubdomain(sql, b.subdomain, tenantId); break;
      case "subdomain": assertOwner(caller); result = await sites.reserveSubdomain(sql, actor, tenantId, b.subdomain); break;
      case "domains": result = await domains.listDomains(sql, tenantId); break;
      case "addDomain": assertOwner(caller); result = await domains.addDomain(sql, actor, tenantId, b.host, b.target); break;
      case "checkDomain": result = await domains.checkDomain(sql, actor, tenantId, id); break;
      case "primaryDomain": assertOwner(caller); result = await domains.setPrimary(sql, actor, tenantId, id); break;
      case "removeDomain": assertOwner(caller); result = await domains.removeDomain(sql, actor, tenantId, id); break;
      // Products
      case "products": result = await store.listProductsForListing(sql, tenantId, { q: b.q, onlyListed: b.onlyListed, offset: b.offset }); break;
      case "saveListing": result = await store.saveListing(sql, actor, tenantId, String(b.productId ?? ""), (b.listing ?? {}) as store.ListingInput); break;
      // Orders and requests
      case "orders": result = await store.listOrders(sql, tenantId, { status: b.status, offset: b.offset }); break;
      case "order": result = await store.orderDetail(sql, tenantId, id); break;
      case "orderStatus": result = await store.setOrderStatus(sql, actor, tenantId, id, b.status, b.note); break;
      case "payment": result = await store.setPaymentStatus(sql, actor, tenantId, id, b.status, b.note); break;
      case "rxReview": result = await store.reviewPrescription(sql, actor, tenantId, id, b.decision, b.note); break;
      case "orderForInvoice": result = await store.orderForInvoice(sql, tenantId, id); break;
      case "linkInvoice": result = await store.linkInvoice(sql, actor, tenantId, id, b.invoiceId); break;
      case "requests": result = await store.listRequests(sql, tenantId); break;
      case "requestStatus": result = await store.setRequestStatus(sql, tenantId, id, b.status); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null });
  } catch (e) {
    return jsonError(e);
  }
}
