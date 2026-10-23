/** App wiring for the restaurant module: the real database (local SQLite,
 * synced to Turso via the outbox), the signed-in session, and PRA network
 * access through the Tauri HTTP plugin. */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { dbExecute, dbSelect } from "@/lib/db";
import { recordOutbox } from "@/lib/sync/outbox";
import { newId, nowIso } from "@/lib/id";
import { isTauriShell } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { createRestaurantStore, RestError, type RestContext } from "./store.ts";
import { createPraService, type PraTransport } from "./praService.ts";

export function restaurantContext(): RestContext {
  const { currentUser, currentTenant } = useAuthStore.getState();
  const tenantDenied = currentTenant?.deniedActions ?? [];
  return {
    tenantId: currentTenant?.id ?? null,
    businessType: currentTenant ? businessType(currentTenant.businessType).id : null,
    userId: currentUser?.id ?? null,
    userName: currentUser?.displayName || currentUser?.username || null,
    role: currentUser?.role ?? null,
    deniedActions: currentUser?.role === "staff" ? [...tenantDenied, ...(currentUser.deniedActions ?? [])] : tenantDenied,
  };
}

export const restaurant = createRestaurantStore(
  {
    select: dbSelect,
    async execute(sql, params) {
      const r = await dbExecute(sql, params);
      return { changes: r.rowsAffected };
    },
    outbox: recordOutbox,
    newId,
    now: () => new Date(),
  },
  restaurantContext
);

/** PRA token: stored only on this computer (local_secrets is never synced),
 * shown masked, replaced as a whole. */
export const praToken = {
  key: () => `${restaurant.tenant()}::pra_token`,
  async get(): Promise<string | null> {
    const rows = await dbSelect<{ value: string }>(`SELECT value FROM local_secrets WHERE key = ?`, [praToken.key()]);
    return rows[0]?.value ?? null;
  },
  async set(value: string | null) {
    if (!value) {
      await dbExecute(`DELETE FROM local_secrets WHERE key = ?`, [praToken.key()]);
      return;
    }
    await dbExecute(
      `INSERT INTO local_secrets (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [praToken.key(), value, nowIso()]
    );
  },
  async masked(): Promise<string | null> {
    const t = await praToken.get();
    return t ? `${"•".repeat(8)}${t.slice(-4)}` : null;
  },
};

const httpFetch = (isTauriShell() ? tauriFetch : fetch) as typeof fetch;

const transport: PraTransport = {
  async post(url, body, headers, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await httpFetch(url, { method: "POST", body, headers, signal: ctrl.signal });
      return { httpStatus: r.status, body: await r.text() };
    } catch (e) {
      const timedOut = ctrl.signal.aborted;
      return { httpStatus: null, body: null, networkError: timedOut ? "PRA did not answer in time" : String(e instanceof Error ? e.message : e), maybeDelivered: timedOut };
    } finally {
      clearTimeout(timer);
    }
  },
  async get(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await httpFetch(url, { signal: ctrl.signal });
      return { httpStatus: r.status, body: await r.text() };
    } catch (e) {
      return { httpStatus: null, body: null, networkError: String(e instanceof Error ? e.message : e) };
    } finally {
      clearTimeout(timer);
    }
  },
};

export const pra = createPraService(restaurant, transport, () => praToken.get());

export function errorText(e: unknown): string {
  return e instanceof RestError || e instanceof Error ? e.message : String(e);
}

export const isRestaurantSession = () => restaurantContext().businessType === "restaurant";
