"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { tenantsRepo } from "@/lib/repo/tenants";
import { subscriptionPlansRepo } from "@/lib/repo/subscriptionPlans";
import { listUsersForTenant } from "@/lib/repo/users";
import { isTauri, useIsTauri } from "@/lib/platform";

export default function AdminOverviewPage() {
  const [tenantCount, setTenantCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [planCount, setPlanCount] = useState(0);
  const [userCount, setUserCount] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      const [tenants, plans, users] = await Promise.all([
        tenantsRepo.list(),
        subscriptionPlansRepo.list(),
        listUsersForTenant(null),
      ]);
      setTenantCount(tenants.length);
      setActiveCount(tenants.filter((t) => t.subscription_status === "active").length);
      setPlanCount(plans.length);
      setUserCount(users.length);
    })();
  }, []);

  const tauriReady = useIsTauri();

  const tiles = [
    { label: "Tenants", value: tenantCount },
    { label: "Active Subscriptions", value: activeCount },
    { label: "Subscription Plans", value: planCount },
    { label: "Total Logins", value: userCount },
  ];

  return (
    <div>
      <PageHeader title="Overview" />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view this overview.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
              <p className="text-xs text-neutral-500">{t.label}</p>
              <p className="mt-1 font-serif text-2xl text-neutral-800">{t.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
