"use client";

/** Browser side of multi-branch (server: src/server/branches.ts, /api/branches).
 * The tab's branch lives in sessionStorage (one per tab) and goes with every
 * request (lib/serverMode.ts); the server checks it each time. Switching
 * reloads the page, so no screen, cart or form of the old branch survives. */
import { create } from "zustand";
import { serverJson } from "./serverMode";
import { BRANCH_TAB_KEY } from "@/config/branchTables";

export type BranchStatus = "active" | "inactive" | "archived";
export interface Branch {
  id: string; code: string; name: string; isMain: boolean; status: BranchStatus;
  address: string | null; phone: string | null; email: string | null; managerUserId: string | null;
  hours: string | null; onlineFulfillment: boolean; capacityReleased: boolean; createdAt: string;
}
export interface Allowance {
  planName: string | null; planLimit: number; override: number | null; unlimited: boolean; disabled: boolean;
  limit: number | null; used: number; remaining: number | null; overLimit: boolean; entitled: boolean;
}
export interface BranchContext {
  branches: Branch[]; mainId: string; active: string | null; managed: string[]; isOwner: boolean; allowance: Allowance;
  pendingRequest: { id: string; extra: number; reason: string | null; createdAt: string } | null;
}

export async function branchApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return (await serverJson<{ result: T }>("/api/branches/", { action, ...body })).result;
}
export async function branchAdminApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return (await serverJson<{ result: T }>("/api/branches/admin/", { action, ...body })).result;
}

interface Store { ctx: BranchContext | null; loading: boolean; error: string | null; load: (force?: boolean) => Promise<void> }
export const useBranchStore = create<Store>((set, get) => ({
  ctx: null,
  loading: false,
  error: null,
  async load(force = false) {
    if (get().loading || (get().ctx && !force)) return;
    set({ loading: true, error: null });
    try {
      set({ ctx: await branchApi<BranchContext>("context"), loading: false });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
}));

/** More than one branch to choose from (the switcher and branch pages show then). */
export const isMultiBranch = (c: BranchContext | null) => Boolean(c && (c.branches.length > 1 || (c.isOwner && c.allowance.entitled)));
export const activeBranch = (c: BranchContext | null) => (c?.active ? c.branches.find((b) => b.id === c.active) ?? null : null);
export const branchLabel = (b: Pick<Branch, "name" | "code">) => `${b.name} (${b.code})`;

/** Opens another branch (or "all" for reports) in this tab. Unsaved work is lost, so ask first. */
export function switchBranch(id: string | "all", opts: { confirmLeave?: boolean } = {}): boolean {
  if (opts.confirmLeave !== false && !confirm("Switch branch? This screen reloads; anything not saved here (a bill in progress, an open form) is cleared.")) return false;
  try {
    window.sessionStorage.setItem(BRANCH_TAB_KEY, id);
  } catch {
    alert("This browser blocks tab storage, so the branch cannot be switched.");
    return false;
  }
  window.location.reload();
  return true;
}

export const money = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
export const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
