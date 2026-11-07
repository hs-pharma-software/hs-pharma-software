"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, ChevronDown, Search } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { SERVER_DB } from "@/lib/serverMode";
import { activeBranch, isMultiBranch, switchBranch, useBranchStore } from "@/lib/branchClient";

/** Header: the tab's branch, a searchable list of the branches this login may
 * open, and "All Branches" for consolidated reports. Hidden for one-branch businesses. */
export function BranchSwitcher() {
  const user = useAuthStore((s) => s.currentUser);
  const { ctx, load } = useBranchStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const tenantUser = Boolean(user && user.role !== "super_admin" && user.tenantId);

  useEffect(() => {
    if (SERVER_DB && tenantUser) void load();
  }, [tenantUser, load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (ctx?.branches ?? []).filter((b) => !t || b.name.toLowerCase().includes(t) || b.code.toLowerCase().includes(t));
  }, [ctx, q]);

  if (!SERVER_DB || !tenantUser || !isMultiBranch(ctx)) return null;
  const cur = activeBranch(ctx);
  const canReport = ctx!.managed.length > 0;
  const pick = (id: string) => {
    if (id === (ctx!.active ?? "all")) return setOpen(false);
    if (switchBranch(id)) setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Branch for this tab"
        className={`flex max-w-[11rem] items-center gap-1.5 rounded-full border px-2 py-1.5 text-xs font-medium shadow-sm sm:max-w-[16rem] sm:px-3 ${cur ? "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50" : "border-amber-300 bg-amber-50 text-amber-900"}`}
      >
        <Building2 size={14} className="shrink-0" />
        <span className="truncate">{cur ? cur.name : "All Branches"}</span>
        {cur && cur.status !== "active" && <span className="rounded bg-neutral-200 px-1 text-[10px] uppercase">{cur.status}</span>}
        <ChevronDown size={13} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-neutral-200 bg-white p-2 text-sm shadow-xl">
          <label className="mb-2 flex items-center gap-2 rounded-lg border border-neutral-200 px-2 py-1.5">
            <Search size={14} className="text-neutral-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search branches" aria-label="Search branches" className="w-full bg-transparent text-sm outline-none" />
          </label>
          <ul role="listbox" aria-label="Branches" className="max-h-64 overflow-y-auto">
            {list.map((b) => (
              <li key={b.id}>
                <button type="button" role="option" aria-selected={b.id === ctx!.active} onClick={() => pick(b.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-50 ${b.id === ctx!.active ? "bg-neutral-100 font-semibold" : ""}`}>
                  <span className="min-w-0 truncate">{b.name} <span className="text-xs text-neutral-400">{b.code}</span></span>
                  <span className="flex shrink-0 gap-1 text-[10px] uppercase">
                    {b.isMain && <span className="rounded bg-sky-100 px-1 text-sky-800">Main</span>}
                    {b.status !== "active" && <span className="rounded bg-neutral-200 px-1 text-neutral-700">{b.status}</span>}
                  </span>
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2 py-1.5 text-neutral-500">No branch matches.</li>}
          </ul>
          {ctx!.branches.length > 1 && (
            <button type="button" onClick={() => pick("all")} className={`mt-1 w-full rounded-lg border-t border-neutral-100 px-2 py-1.5 text-left hover:bg-neutral-50 ${!ctx!.active ? "font-semibold" : ""}`}>
              All Branches <span className="text-xs text-neutral-500">(reports only)</span>
            </button>
          )}
          <div className="mt-1 flex flex-col border-t border-neutral-100 pt-1 text-[13px]">
            {ctx!.isOwner && <Link href="/branches" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1.5 text-[var(--accent)] hover:bg-neutral-50">Manage branches</Link>}
            {canReport && <Link href="/branches/transfers" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1.5 text-[var(--accent)] hover:bg-neutral-50">Stock transfers</Link>}
            {canReport && <Link href="/branches/reports" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1.5 text-[var(--accent)] hover:bg-neutral-50">Branch dashboard &amp; reports</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Under the header in All Branches: records are read-only until one branch is chosen. */
export function BranchModeNotice() {
  const ctx = useBranchStore((s) => s.ctx);
  if (!SERVER_DB || !ctx || ctx.active || !isMultiBranch(ctx)) return null;
  return (
    <div role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <b>All Branches</b>: reports and lists show every branch you can open. To record a sale, purchase, stock change or any other entry, choose one branch in the header.
    </div>
  );
}

/** One line on printed documents: the branch that issued it (multi-branch businesses only). */
export function BranchPrintLine({ className = "" }: { className?: string }) {
  const ctx = useBranchStore((s) => s.ctx);
  const b = activeBranch(ctx);
  if (!b || !ctx || ctx.branches.length < 2) return null;
  return <p className={`text-center text-[11px] text-black ${className}`}>Branch: {b.name} ({b.code}){b.address ? ` · ${b.address}` : ""}{b.phone ? ` · ${b.phone}` : ""}</p>;
}
