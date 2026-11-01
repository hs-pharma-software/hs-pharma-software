"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { money } from "@/components/lab/labUi";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { useAuthStore } from "@/store/authStore";
import { labDayStats, type LabDayStats } from "@/lib/repo/lab";

/** The lab's day: visits, where the tests stand, and the money. */
export default function LabDashboardPage() {
  const name = useAuthStore((s) => s.currentTenant?.name ?? "Lab");
  const [s, setS] = useState<LabDayStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void labDayStats(localDate()).then(setS).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const desk = (href: string, label: string, n: number, hint: string, tone: string) => (
    <Link href={href} className="flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] transition hover:ring-neutral-300">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={`text-3xl font-bold tabular-nums ${n > 0 ? tone : "text-neutral-300"}`}>{n}</span>
      <span className="text-xs text-neutral-500">{hint}</span>
    </Link>
  );

  return (
    <div>
      <PageHeader title={name} />
      {error && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">{error}</p>}
      {s && (
        <>
          <p className="mb-2 text-sm font-semibold text-neutral-700">Waiting now</p>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {desk("/lab/samples", "Samples to take", s.toCollect, "Technologist: collect", "text-sky-700")}
            {desk("/lab/samples", "Results to enter", s.toEnter, "Technologist: enter results", "text-amber-700")}
            {desk("/lab/verify", "To verify", s.toVerify, "Pathologist: verify and release", "text-violet-700")}
          </div>
          <p className="mb-2 text-sm font-semibold text-neutral-700">Today</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              ["Visits", String(s.visits)], ["Tests", String(s.tests)], ["Released", String(s.released)],
              ["Billed", money(s.billed)], ["Received", money(s.collected)], ["Due", money(s.due)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-black/[0.05]">
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
                <p className={`text-lg font-semibold tabular-nums ${label === "Due" && s.due > 0 ? "text-rose-700" : "text-neutral-900"}`}>{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <Link href="/lab/reception" className="rounded-full bg-neutral-900 px-4 py-1.5 font-medium text-white hover:bg-neutral-700">New visit</Link>
            <Link href="/lab/reports" className="rounded-full bg-white px-4 py-1.5 font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50">Reports</Link>
            <Link href="/lab/bills" className="rounded-full bg-white px-4 py-1.5 font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50">Bills</Link>
          </div>
        </>
      )}
    </div>
  );
}
