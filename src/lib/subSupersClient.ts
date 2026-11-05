/** Calls to the Sub Supers endpoints (src/server/subSupers.ts). Every rule is
 * checked on the server; these are thin wrappers for the screens. */
import { BUSINESS_TYPES } from "@/config/businessTypes";
import { SERVER_DB, desktopViaServer, serverJson } from "./serverMode";

/** The module needs the server: the web version, or the desktop syncing through it. */
export const subSupersAvailable = () => SERVER_DB || desktopViaServer();

export async function ownerCall<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return (await serverJson<{ result: T }>("/api/sub-supers/owner/", { action, ...body })).result;
}

export async function myCall<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return (await serverJson<{ result: T }>("/api/sub-supers/me/", { action, ...body })).result;
}

export const appLabel = (id: unknown) => BUSINESS_TYPES.find((t) => t.id === id)?.label ?? String(id ?? "—");

export const STATUS_TEXT: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-neutral-100 text-neutral-600" },
  submitted: { label: "Submitted", cls: "bg-sky-100 text-sky-800" },
  under_review: { label: "Under review", cls: "bg-amber-100 text-amber-800" },
  returned: { label: "Returned for correction", cls: "bg-orange-100 text-orange-800" },
  rejected: { label: "Rejected", cls: "bg-rose-100 text-rose-700" },
  activated: { label: "Activated", cls: "bg-emerald-100 text-emerald-800" },
};

export const money = (n: unknown) => (n == null || n === "" ? "—" : `Rs ${Number(n).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`);
export const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) : "—");
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface SalesRow {
  id: string; name: string; status: string; submitted: number; pending: number; rejected: number; salesCount: number; salesAmount: number;
  byApp: { appId: string; label: string; count: number; amount: number }[];
  months: { count: number; amount: number }[];
  records: { id: string; businessName: string | null; appId: string; activatedAt: string; amount: number }[];
}
export interface SalesReport { year: number; timezone: string; rankBy: "amount" | "count"; top: SalesRow | null; leaderboard: SalesRow[] }
