"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { TenantFormModal } from "@/components/admin/TenantFormModal";
import { tenantsRepo } from "@/lib/repo/tenants";
import { subscriptionPlansRepo } from "@/lib/repo/subscriptionPlans";
import { isTauri, useIsTauri } from "@/lib/platform";
import { nowIso } from "@/lib/id";
import type { Tenant, SubscriptionPlan } from "@/lib/types2";

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const [t, p] = await Promise.all([tenantsRepo.list(), subscriptionPlansRepo.list()]);
    setTenants(t);
    setPlans(p);
  }

  useEffect(() => {
    void reload();
  }, []);

  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name ?? "—";

  async function toggleSuspend(t: Tenant) {
    await tenantsRepo.update(t.id, {
      subscription_status: t.subscription_status === "active" ? "suspended" : "active",
    });
    void reload();
  }

  async function renew(t: Tenant) {
    const plan = plans.find((p) => p.id === t.subscription_plan_id);
    await tenantsRepo.update(t.id, {
      subscription_status: "active",
      subscription_started_at: nowIso(),
      subscription_expires_at: addDaysIso(plan?.duration_days ?? 30),
    });
    void reload();
  }

  const columns: Column<Tenant>[] = [
    { header: "Name", render: (t) => <span className="font-medium">{t.name}</span> },
    { header: "Owner", render: (t) => t.owner_name ?? "—" },
    { header: "Phone", render: (t) => t.phone ?? "—" },
    { header: "Plan", render: (t) => planName(t.subscription_plan_id) },
    {
      header: "Status",
      render: (t) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            t.subscription_status === "active"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-rose-100 text-rose-700"
          }`}
        >
          {t.subscription_status}
        </span>
      ),
    },
    {
      header: "Expires On",
      render: (t) => (t.subscription_expires_at ? new Date(t.subscription_expires_at).toLocaleDateString() : "—"),
    },
    {
      header: "Actions",
      render: (t) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => void renew(t)} className="text-emerald-600 hover:underline">
            Renew
          </button>
          <button type="button" onClick={() => void toggleSuspend(t)} className="text-amber-600 hover:underline">
            {t.subscription_status === "active" ? "Suspend" : "Activate"}
          </button>
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Tenants"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
              disabled={plans.length === 0}
            >
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {plans.length === 0 && tauriReady && (
        <p className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Create a subscription plan first before adding a tenant.
        </p>
      )}

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage tenants.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={tenants}
          onRowClick={(t) => {
            setEditing(t);
            setModalOpen(true);
          }}
        />
      )}

      {modalOpen && (
        <TenantFormModal
          tenant={editing}
          plans={plans}
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
