/** Shared catalogue prices, from the page (src/server/catalogPrices.ts). Web and
 * the Windows app while online; anywhere else, or on any failure, the screens
 * carry on without them. */
import { SERVER_DB, serverJson } from "../serverMode";
import { desktopOffline } from "../desktopBridge";
import { hasSharedCatalogAccess } from "../catalogAccess";
import { useAuthStore } from "@/store/authStore";
import type { CatalogDefault, CatalogNotice, PriceItem, PriceQuestion } from "@/server/catalogPrices";
import type { ReviewRow } from "@/server/catalogChanges";

export type { CatalogNotice, PriceQuestion, ReviewRow };

export const catalogPricesAvailable = () =>
  SERVER_DB && !desktopOffline() && hasSharedCatalogAccess(useAuthStore.getState().currentTenant?.businessType);

const call = <T,>(body: Record<string, unknown>) => serverJson<{ result: T }>("/api/catalog/prices/", body).then((r) => r.result);

/** The usual price of a shared product, for a first purchase of it. */
export async function catalogDefaultPrice(productId: string): Promise<CatalogDefault | null> {
  if (!catalogPricesAvailable()) return null;
  const r = await call<Record<string, CatalogDefault>>({ action: "defaults", productIds: [productId] }).catch(() => null);
  return r?.[productId] ?? null;
}

export async function priceQuestions(items: PriceItem[]): Promise<PriceQuestion[]> {
  if (!items.length || !catalogPricesAvailable()) return [];
  return call<PriceQuestion[]>({ action: "questions", items }).catch(() => []);
}

export const proposePrices = (items: PriceItem[]) => call<{ proposed: number; sentForReview: number }>({ action: "propose", items });

/** A shared product's new pack size, reported for MAVIN.pk to approve. */
export const requestPacking = (productId: string, newPacking: number) => call<{ requested: boolean }>({ action: "packing", productId, newPacking });

export async function priceNotices(): Promise<CatalogNotice[]> {
  if (!catalogPricesAvailable()) return [];
  return call<CatalogNotice[]>({ action: "notices" }).catch(() => []);
}

/** Super Admin: the reports waiting (or already decided), and deciding one. */
export const listReviews = (status: "pending" | "decided") => call<ReviewRow[]>({ action: "reviews", status });
export const decideReview = (d: { id: string; approve: boolean; salePrice?: string; mrp?: string; note?: string }) =>
  call<{ ok: true; moved: Record<string, number> }>({ action: "decide", ...d });

export const answerPrice = (id: string, answer: "yes" | "no") => call<{ ok: true; accepted: boolean }>({ action: "answer", id, answer });
