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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setStatus("loading");
    try {
      setPlans(await subscriptionPlansRepo.list());
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<SubscriptionPlan>[] = [
    { header: "Name", render: (p) => <span className="font-medium">{p.name}</span> },
    // Plans store no currency; the app bills in Pakistani rupees (see note below the table).
    { header: "Price (Rs)", render: (p) => p.price.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) },
    { header: "Term", render: (p) => `per ${p.duration_days} days` },
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
        <>
        {status === "error" && (
          <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Plans could not be loaded: {error}{" "}
            <button type="button" className="font-medium underline" onClick={() => void reload()}>Try again</button>
          </p>
        )}
        <DataTable
          columns={columns}
          rows={plans}
          loading={status === "loading"}
          emptyMessage={status === "error" ? "Plans could not be loaded." : "No plans yet. Add one to assign it to tenants."}
          onRowClick={(p) => {
            setEditing(p);
            setModalOpen(true);
          }}
        />
        <p className="mt-2 text-[11px] text-neutral-400">
          Prices are stored without a currency and are shown in Pakistani rupees. Confirm the currency and each plan&apos;s term before publishing prices.
        </p>
        </>
      )}

      {modalOpen && (
        <SubscriptionPlanFormModal
          plan={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
          onDeleted={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
