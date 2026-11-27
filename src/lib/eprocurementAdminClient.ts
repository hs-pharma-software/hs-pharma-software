/** Super Admin > eProcurement calls (src/server/vendorRegistration.ts through /api/eprocurement/admin). */
import { serverJson } from "./serverMode";
import type { AdminVendorDetail, AdminVendorRow, OrganizationRow } from "../server/vendorRegistration";
import type { EpCategory, VendorStatus } from "./vendorProfile";

export type { AdminVendorDetail, AdminVendorRow, OrganizationRow } from "../server/vendorRegistration";

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return (await serverJson<{ result: T }>("/api/eprocurement/admin/", { ...body, action })).result;
}

export type ListStatus = "pending" | "changes" | "rejected" | "draft" | "approved" | "suspended" | "blacklisted" | "directory";
export const epCounts = () => call<Partial<Record<VendorStatus, number>>>("counts");
export const epVendors = (status: ListStatus, q = "") => call<AdminVendorRow[]>("vendors", { status, q });
export const epVendor = (id: string) => call<AdminVendorDetail>("vendor", { id });
export type ReviewAction = "approve" | "requestChanges" | "reject" | "suspend" | "reactivate" | "blacklist" | "unblacklist";
export const epReview = (action: ReviewAction, id: string, note?: string) => call<{ ok: true; status: VendorStatus }>(action, { id, note });
export const epSetPassword = (id: string, password: string) => call<{ ok: true }>("setPassword", { id, password });
export const epCategories = () => call<EpCategory[]>("categories");
export const epSaveCategory = (c: { id?: string; kind: "supplier" | "services"; name: string; sort?: number }) => call<{ ok: true; id: string }>("saveCategory", c);
export const epCategoryActive = (id: string, active: boolean) => call<{ ok: true }>("categoryActive", { id, active });
export const epDeleteCategory = (id: string) => call<{ ok: true }>("deleteCategory", { id });
export const epOrganizations = () => call<OrganizationRow[]>("organizations");
export const epSetAllowed = (tenantId: string, allowed: boolean) => call<{ ok: true }>("setAllowed", { tenantId, allowed });
