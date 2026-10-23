"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Search, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { UserLoginsPage } from "@/components/admin/UserLoginsPage";
import { TenantDetailPanel } from "@/components/admin/TenantDetailPanel";
import { TenantFormModal } from "@/components/admin/TenantFormModal";
import { tenantsRepo } from "@/lib/repo/tenants";
import { subscriptionPlansRepo } from "@/lib/repo/subscriptionPlans";
import { dbSelect } from "@/lib/db";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { SubscriptionPlan, Tenant } from "@/lib/types2";
import { businessType } from "@/config/businessTypes";

type View = { kind: "list" } | { kind: "tenant"; id: string } | { kind: "admins" };

/** Super Admin > Users: pharmacies first (name, owner, mobile, login count).
 * Opening one shows its detail and only its own logins (owner + sub users). */
export default function AdminUsersPage() {
  const tauriReady = useIsTauri();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [counts, setCounts] = useState<Record<string, { owners: number; staff: number }>>({});
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Tenant | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const [t, p, c] = await Promise.all([
      tenantsRepo.list(),
      subscriptionPlansRepo.list(),
      dbSelect<{ tenant_id: string; owners: number; staff: number }>(
        `SELECT tenant_id, SUM(role = 'owner') AS owners, SUM(role = 'staff') AS staff
         FROM users WHERE deleted_at IS NULL AND tenant_id IS NOT NULL GROUP BY tenant_id`
      ),
    ]);
    setTenants(t.sort((a, b) => a.name.localeCompare(b.name)));
    setPlans(p);
    setCounts(Object.fromEntries(c.map((r) => [r.tenant_id, { owners: Number(r.owners), staff: Number(r.staff) }])));
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t) => [t.name, t.owner_name, t.phone].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [tenants, query]);

  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name ?? "—";
  const selected = view.kind === "tenant" ? tenants.find((t) => t.id === view.id) ?? null : null;

  if (!tauriReady) {
    return (
      <div>
        <PageHeader title="Users" />
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage logins.
        </p>
      </div>
    );
  }

  if (view.kind !== "list") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button onClick={() => setView({ kind: "list" })}>
            <ArrowLeft size={14} /> All Pharmacies
          </Button>
          <h1 className="truncate text-2xl font-bold tracking-tight text-neutral-900">
            {view.kind === "admins" ? "Super Admin" : selected?.name ?? "Pharmacy"}
          </h1>
        </div>
        {selected && (
          <TenantDetailPanel
            key={selected.id}
            tenant={selected}
            plans={plans}
            onSaved={() => void reload()}
            onEdit={() => setEditing(selected)}
          />
        )}
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <UserLoginsPage scope="all" embedded tenantFilter={view.kind === "admins" ? null : view.id} />
        </div>
        {editing && (
          <TenantFormModal
            tenant={editing}
            plans={plans}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void reload();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Users" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      <div className="mb-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Search size={15} className="text-neutral-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pharmacy, owner or mobile..."
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left">
              {["Pharmacy", "Owner Name", "Mobile No", "Plan", "Logins", "Status", ""].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const c = counts[t.id] ?? { owners: 0, staff: 0 };
              return (
                <tr
                  key={t.id}
                  onClick={() => setView({ kind: "tenant", id: t.id })}
                  className="cursor-pointer border-b border-neutral-50 last:border-0 hover:bg-amber-50/40"
                >
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="font-medium text-neutral-900 underline-offset-2 hover:underline">{t.name}</span>
                    <span className="ml-2 text-[11px] text-neutral-400">{businessType(t.business_type).label}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">{t.owner_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{t.phone ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{planName(t.subscription_plan_id)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-neutral-600">
                    {c.owners} owner · {c.staff} sub user{c.staff === 1 ? "" : "s"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.subscription_status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {t.subscription_status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-300">
                    <ChevronRight size={16} />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-neutral-400">
                  No content in table
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setView({ kind: "admins" })}
        className="mt-3 flex w-full items-center gap-2 rounded-2xl bg-white px-4 py-3 text-left text-sm shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] hover:bg-neutral-50"
      >
        <ShieldCheck size={16} className="text-neutral-500" />
        <span className="font-medium text-neutral-800">Super Admin logins</span>
        <ChevronRight size={16} className="ml-auto text-neutral-300" />
      </button>
    </div>
  );
}
