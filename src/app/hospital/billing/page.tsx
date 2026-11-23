"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { EpisodeBillsPanel } from "@/components/hospital/EpisodeBills";

/** Episodes & Billing > Billing: every episode's bill, with Edit for its discount. */
export default function HospitalBillingPage() {
  return (
    <div>
      <PageHeader title="Episode Bills" />
      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <EpisodeBillsPanel />
      </div>
    </div>
  );
}
