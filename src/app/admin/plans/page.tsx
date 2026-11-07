"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SubscriptionPlanFormModal } from "@/components/admin/SubscriptionPlanFormModal";
import { subscriptionPlansRepo, parseAllowedModules } from "@/lib/repo/subscriptionPlans";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { SubscriptionPlan } from "@/lib/types2";
import { PlanAddonsCard } from "@/components/admin/PlanAddonsCard";
import { getGlobalSetting, setGlobalSetting } from "@/lib/repo/settings";
import { businessType } from "@/config/businessTypes";

/** Platform rule: lock a business once its plan and grace period have ended (off by default). */
export const ENFORCE_EXPIRY_SETTING = "platform.enforce_expiry";
const typesOf = (p: SubscriptionPlan) => { try { const v = p.business_types ? JSON.parse(p.business_types) : []; return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

export default function SubscriptionPlansPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [enforce, setEnforce] = useState<boolean | null>(null);

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
    if (isTauri()) void getGlobalSetting(ENFORCE_EXPIRY_SETTING).then((v) => setEnforce(v === "1")).catch(() => setEnforce(false));
  }, []);

  const columns: Column<SubscriptionPlan>[] = [
    { header: "Name", render: (p) => <span className="font-medium">{p.name}</span> },
    // Plans store no currency; the app bills in Pakistani rupees (see note below the table).
    { header: "Price (Rs)", render: (p) => p.price.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) },
    { header: "Term", render: (p) => `per ${p.duration_days} days` },
    { header: "Max Staff Logins", render: (p) => p.max_staff_logins },
    { header: "Max Invoices/Month", render: (p) => p.max_invoices_per_month ?? "Unlimited" },
    { header: "Modules", render: (p) => parseAllowedModules(p).length },
    { header: "Business types", render: (p) => { const t = typesOf(p); return t.length ? t.map((x) => businessType(x).label).join(", ") : "All"; } },
    { header: "Grace", render: (p) => `${p.grace_days ?? 7} days` },
    { header: "Website", render: (p) => (p.is_public ? <span className="text-emerald-700">Shown</span> : <span className="text-neutral-400">Hidden</span>) },
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
          Prices are in Pakistani rupees. Plans marked Shown appear on the website&apos;s pricing page, grouped by business type.
        </p>
        <label className="mt-4 flex items-start gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-sm">
          <input type="checkbox" className="mt-0.5" checked={Boolean(enforce)} disabled={enforce === null} onChange={async (e) => { const v = e.target.checked; if (v && !confirm("Lock businesses whose plan and grace period have ended? Check expiry dates in Tenants first: past dates lock at once.")) return; await setGlobalSetting(ENFORCE_EXPIRY_SETTING, v ? "1" : "0"); setEnforce(v); }} />
          <span><b>Lock after grace period</b><span className="block text-xs text-neutral-500">Off: businesses keep working after expiry and only see a renewal reminder. On: access pauses once the plan&apos;s grace period has ended, until you renew it in Tenants.</span></span>
        </label>
        <PlanAddonsCard />
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
