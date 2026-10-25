"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { isTauri } from "@/lib/platform";
import { complianceSnapshot, MSDS_AREAS, type ComplianceCheck, type CheckState } from "@/lib/repo/compliance";
import { err } from "@/components/hospital/quality/SafetyModals";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const STATE: Record<CheckState, [string, string, string]> = {
  ok: ["Records in order", "bg-emerald-100 text-emerald-700", "border-l-emerald-500"],
  attention: ["Needs attention", "bg-rose-100 text-rose-700", "border-l-rose-500"],
  no_data: ["No records yet", "bg-neutral-100 text-neutral-600", "border-l-neutral-300"],
};

/** Internal MSDS self-assessment from this hospital's own records. */
export default function CompliancePage() {
  const [data, setData] = useState<{ checks: ComplianceCheck[]; from: string; to: string } | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void complianceSnapshot().then(setData).catch(err);
  }, []);
  const count = (s: CheckState) => data?.checks.filter((c) => c.state === s).length ?? 0;
  return (
    <div>
      <PageHeader title="MSDS Self-assessment" />
      <div className="flex flex-col gap-4">
        <div className={`${card} text-sm text-neutral-700`}>
          <p>
            What this hospital&apos;s own records in this software show against each chapter of the PHC Minimum Service Delivery Standards. It is an
            internal readiness check for the quality team. It is not a PHC inspection, licence, score or accreditation, and it only sees what has been entered here.
          </p>
          {data && (
            <p className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="text-neutral-500">Activity from {data.from} to {data.to}:</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATE.attention[1]}`}>{count("attention")} need attention</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATE.no_data[1]}`}>{count("no_data")} with no records</span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${STATE.ok[1]}`}>{count("ok")} in order</span>
            </p>
          )}
        </div>
        {data && MSDS_AREAS.map(([code, name]) => {
          const checks = data.checks.filter((c) => c.area === code);
          if (!checks.length) return null;
          return (
            <div key={code} className={card}>
              <h2 className="mb-3 text-sm font-semibold text-neutral-700"><span className="mr-2 font-mono text-xs text-neutral-500">{code}</span>{name}</h2>
              <div className="flex flex-col gap-2">
                {checks.map((c) => (
                  <Link key={c.label} href={c.href} className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border-l-4 bg-neutral-50 px-3 py-2 hover:bg-neutral-100 ${STATE[c.state][2]}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-neutral-800">{c.label}</span>
                      <span className="block text-xs text-neutral-600">{c.detail}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE[c.state][1]}`}>{STATE[c.state][0]}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
