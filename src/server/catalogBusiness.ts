/** Which business is asking, for the shared catalogue's prices and changes. */
import { HttpError } from "./db";
import type { Caller } from "./sqlPolicy";
import type { Sql } from "./subSupers";
import { sharedCatalogGroupsFor, type SharedCatalogGroup } from "../lib/catalogAccess";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface Business { tenantId: string; groups: SharedCatalogGroup[] }

/** A business login that uses a shared catalogue, else null. */
export function businessOf(caller: Caller): Business | null {
  if (!caller.tenantId || caller.platformRole || caller.role === "super_admin") return null;
  const groups = sharedCatalogGroupsFor(caller.businessType);
  return groups.length ? { tenantId: caller.tenantId, groups } : null;
}

/** Changing prices: the owner, or staff with Purchase or Products. */
export function mayPrice(caller: Caller) {
  return caller.role === "owner" || !Array.isArray(caller.permissions) || caller.permissions.includes("purchase") || caller.permissions.includes("products");
}

export function requirePricing(caller: Caller): Business {
  const b = businessOf(caller);
  if (!b) throw new HttpError(403, "This business does not use a shared catalogue.");
  if (!mayPrice(caller)) throw new HttpError(403, "Your login may not change prices.");
  return b;
}

/** The business's current price of a product (per pack). */
export const latestPrice = async (sql: Pick<Sql, "execute">, tenantId: string, productId: string) =>
  (await sql.execute(
    `SELECT sale_price, wholesale_price, mrp FROM price_list WHERE product_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [productId, tenantId])).rows[0];
