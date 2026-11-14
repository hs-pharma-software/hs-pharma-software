/** Runs one module save (Phase 2: distribution, electronics) through the
 * module's own store, the same code the pages use online. The desktop runs it
 * on its local copy while offline (recording the ids it makes); MAVIN.pk runs
 * it again on its database as the same login, with the same ids and clock,
 * so both end with the same rows. No server-only or browser-only imports. */
import { createDistStore } from "../lib/dist/store.ts";
import { createElectricStore } from "../lib/electric/store.ts";
import type { RestContext, RestDb } from "../lib/restaurant/store.ts";
import { callAllowed, type CallModule } from "./callList.ts";

export interface CallDb {
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

/** Ids for the save: the recorded ones in order (replay), then fresh ones. */
export function idSource(recorded: string[], fresh: () => string) {
  const used: string[] = [];
  let i = 0;
  return {
    used,
    next(): string {
      const id = i < recorded.length ? recorded[i++] : fresh();
      used.push(id);
      return id;
    },
  };
}

/** The save's moment, whose calendar day (as the stores read it: year, month,
 * date) is the computer's business day wherever this runs (the server keeps UTC). */
export function callClock(at: string, day: string): Date {
  const [y, m, dd] = day.split("-").map(Number);
  const d = new Date(at);
  return Object.assign(d, { getFullYear: () => y, getMonth: () => m - 1, getDate: () => dd });
}

/** yyyy-mm-dd of a moment on this computer's clock. */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The context a store gets: the business, its type and the login (as the pages build it). */
export function callContext(o: { tenantId: string; businessType: string; userId: string; userName: string | null; role: "owner" | "staff"; tenantDenied: string[]; userDenied: string[] }): RestContext {
  return {
    tenantId: o.tenantId, businessType: o.businessType, userId: o.userId, userName: o.userName, role: o.role,
    deniedActions: o.role === "staff" ? [...o.tenantDenied, ...o.userDenied] : o.tenantDenied,
  };
}

export const jsonList = (raw: unknown): string[] => {
  try {
    const v = typeof raw === "string" && raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** Calls `fn` of the module's store with `args`. Only the saves listed in OFFLINE_CALLS. */
export async function runCall(db: CallDb, ctx: RestContext, call: { module: CallModule; fn: string; args: unknown[]; at: string; day: string }, nextId: () => string): Promise<unknown> {
  if (!callAllowed(call.module, call.fn)) throw new Error(`${call.fn} cannot be saved offline.`);
  const port: RestDb = {
    select: db.select,
    execute: db.execute,
    outbox: async () => undefined,
    newId: nextId,
    now: () => callClock(call.at, call.day),
  };
  const store = (call.module === "dist" ? createDistStore(port, () => ctx) : createElectricStore(port, () => ctx)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  return store[call.fn](...call.args);
}

/** What lists show for a save: its kind and amount (from the store's answer). */
export function callSummary(module: CallModule, fn: string, result: unknown): { label: string; amount: number | null } {
  const names: Record<string, string> = {
    createSale: "Sale invoice", createBooking: "Booking", receivePayment: "Payment", createSaleReturn: "Sale return", createReturn: "Return", createQuotation: "Quotation",
  };
  const r = result as { doc?: { total?: unknown; net_total?: unknown; payable?: unknown }; total?: unknown; amount?: unknown } | null;
  const n = [r?.doc?.payable, r?.doc?.net_total, r?.doc?.total, r?.total, r?.amount].map(Number).find((x) => Number.isFinite(x));
  return { label: `${module === "dist" ? "Distribution" : "Store"} ${names[fn] ?? fn}`.slice(0, 80), amount: n ?? null };
}
