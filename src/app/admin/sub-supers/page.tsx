"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { subSupersAvailable } from "@/lib/subSupersClient";
import { DistributorsView } from "@/components/subsupers/DistributorsView";
import { PendingApprovalsView } from "@/components/subsupers/PendingApprovalsView";
import { SalesPerformanceView } from "@/components/subsupers/SalesPerformanceView";

const TABS = [
  { id: "distributors", label: "Distributors" },
  { id: "pending", label: "Pending Approvals" },
  { id: "sales", label: "Sales Performance" },
] as const;

/** Super Admin > Sub Supers: software distributors, the customer setups they
 * submit for approval, and their yearly sales. Every action is checked on the
 * server (src/server/subSupers.ts). */
export default function SubSupersPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("distributors");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sub Supers"
        actions={
          <div role="tablist" className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-0.5 text-xs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1 font-medium ${tab === t.id ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      {!subSupersAvailable() ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Sub Supers works through the server: use the web version, or a desktop app that syncs through the server.
        </p>
      ) : tab === "distributors" ? (
        <DistributorsView />
      ) : tab === "pending" ? (
        <PendingApprovalsView />
      ) : (
        <SalesPerformanceView scope="owner" />
      )}
    </div>
  );
}
