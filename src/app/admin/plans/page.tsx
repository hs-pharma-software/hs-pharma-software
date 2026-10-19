"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SubscriptionPlanFormModal } from "@/components/admin/SubscriptionPlanFormModal";
import { subscriptionPlansRepo, parseAllowedModules } from "@/lib/repo/subscriptionPlans";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { SubscriptionPlan } from "@/lib/types2";

export default function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setPlans(await subscriptionPlansRepo.list());
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<SubscriptionPlan>[] = [
    { header: "Name", render: (p) => <span className="font-medium">{p.name}</span> },
    { header: "Price", render: (p) => p.price.toFixed(2) },
    { header: "Duration", render: (p) => `${p.duration_days} days` },
    { header: "Max Staff Logins", render: (p) => p.max_staff_logins },
    { header: "Max Invoices/Month", render: (p) => p.max_invoices_per_month ?? "Unlimited" },
    { header: "Modules", render: (p) => parseAllowedModules(p).length },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Subscription Plans"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage subscription plans.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={plans}
          onRowClick={(p) => {
            setEditing(p);
            setModalOpen(true);
          }}
        />
      )}

      {modalOpen && (
        <SubscriptionPlanFormModal
          plan={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
