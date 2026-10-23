"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri, useIsTauri } from "@/lib/platform";
import { tenantsRepo } from "@/lib/repo/tenants";
import { BUSINESS_TYPES, businessType } from "@/config/businessTypes";
import {
  bulkAssignByClassification,
  catalogCountsByType,
  deleteUnownedProduct,
  giveProductsToTenant,
  listProductsByBusinessType,
  listUnownedProducts,
  unownedCounts,
  type TenantProductRow,
  type UnownedProductRow,
} from "@/lib/repo/catalogAdmin";
import type { Tenant } from "@/lib/types2";

// "unowned" is the virtual tab for the quarantine bucket
type TabId = string | "unowned";

export default function AdminCatalogReviewPage() {
  const tauri = useIsTauri();
  const [activeTab, setActiveTab] = useState<TabId>("unowned");
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [unownedCount, setUnownedCount] = useState(0);

  // Per-tab data
  const [tenantRows, setTenantRows] = useState<TenantProductRow[]>([]);
  const [unownedRows, setUnownedRows] = useState<UnownedProductRow[]>([]);
  const [unownedMeta, setUnownedMeta] = useState<Record<string, number>>({});

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState(""); // for tenant tabs
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [giving, setGiving] = useState<"move" | "copy" | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Load tab counts (badges) once on mount
  async function loadCounts() {
    if (!isTauri()) return;
    const [typeCts, unMeta] = await Promise.all([catalogCountsByType(), unownedCounts()]);
    setTypeCounts(typeCts);
    setUnownedCount(unMeta.products ?? 0);
    setUnownedMeta(unMeta);
  }

  async function loadTab(tab: TabId) {
    if (!isTauri()) return;
    setLoading(true);
    setSearch("");
    setTenantFilter("");
    setPicked(new Set());
    setMsg(null);
    try {
      if (tab === "unowned") {
        const [rows, allTenants] = await Promise.all([listUnownedProducts(), tenantsRepo.list({ orderBy: "name ASC" })]);
        setUnownedRows(rows);
        setTenants(allTenants);
      } else {
        const rows = await listProductsByBusinessType(tab);
        setTenantRows(rows);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCounts();
    void loadTab("unowned");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    void loadTab(tab);
  };

  if (!tauri)
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Run inside the desktop app to review the catalog.
      </p>
    );

  // ── Unowned tab view ────────────────────────────────────────────────────────
  const term = search.trim().toLowerCase();
  const shownUnowned = unownedRows.filter(
    (p) => !term || p.name.toLowerCase().includes(term) || (p.barcode ?? "").toLowerCase().includes(term) || (p.company_name ?? "").toLowerCase().includes(term)
  );
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // ── Tenant tab view ─────────────────────────────────────────────────────────
  const tenantOptions = [...new Map(tenantRows.map((r) => [r.tenant_id, r.tenant_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shownTenant = tenantRows.filter((p) => {
    if (tenantFilter && p.tenant_id !== tenantFilter) return false;
    if (!term) return true;
    return (
      p.name.toLowerCase().includes(term) ||
      (p.barcode ?? "").toLowerCase().includes(term) ||
      (p.company_name ?? "").toLowerCase().includes(term) ||
      p.tenant_name.toLowerCase().includes(term)
    );
  });

  // ── Tab bar ─────────────────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; count: number }[] = [
    ...BUSINESS_TYPES.map((bt) => ({
      id: bt.id as TabId,
      label: bt.label,
      count: typeCounts[bt.id] ?? 0,
    })),
    { id: "unowned", label: "Unowned", count: unownedCount },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Catalog Review"
        actions={
          activeTab === "unowned" ? (
            <>
              <Button disabled={!picked.size} onClick={() => setGiving("move")}>Move to tenant</Button>
              <Button disabled={!picked.size} onClick={() => setGiving("copy")}>Copy to tenant</Button>
              <Button
                variant="primary"
                disabled={assigning}
                onClick={async () => {
                  if (!confirm("Copy all unowned products to matching tenant types?\n\n• pharma products → Retail Pharmacy, Medical Store, Hospital Pharmacy\n• general_store products → General Store\n\nThis is safe to run more than once.")) return;
                  setAssigning(true);
                  try {
                    const { assigned, skipped } = await bulkAssignByClassification();
                    setMsg({ ok: true, text: `Bulk assign complete — ${assigned} product copies created, ${skipped} products skipped (no matching tenants).` });
                    void loadTab("unowned");
                    void loadCounts();
                  } catch (e) {
                    setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  } finally {
                    setAssigning(false);
                  }
                }}
              >
                {assigning ? "Assigning…" : "Bulk Assign to Tenants"}
              </Button>
              <Button onClick={() => { void loadTab("unowned"); void loadCounts(); }}>Refresh</Button>
            </>
          ) : (
            <Button onClick={() => { void loadTab(activeTab); void loadCounts(); }}>Refresh</Button>
          )
        }
      />

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5 border-b border-neutral-200 pb-3">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-neutral-900 text-white"
                  : "bg-white text-neutral-600 ring-1 ring-black/10 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  active ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-500"
                }`}
              >
                {tab.count.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Messages */}
      {msg && (
        <div className={`rounded-xl border px-4 py-2.5 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {msg.text}
        </div>
      )}

      {/* ── Unowned tab ── */}
      {activeTab === "unowned" && (
        <>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            These rows belong to no tenant — the ownership migration could not attribute them.
            <b> Move</b> gives the row to one tenant; <b>Copy</b> gives a tenant its own copy and keeps the original here.
            Unowned: {unownedMeta.products ?? 0} products, {unownedMeta.categories ?? 0} categories,{" "}
            {unownedMeta.sub_categories ?? 0} sub categories, {unownedMeta.uoms ?? 0} units, {unownedMeta.generic_names ?? 0} generic names.
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, barcode, company" />
          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2">
                    <input type="checkbox" checked={shownUnowned.length > 0 && shownUnowned.every((p) => picked.has(p.id))} onChange={(e) => setPicked(e.target.checked ? new Set(shownUnowned.map((p) => p.id)) : new Set())} />
                  </th>
                  <th className="px-3 py-2 text-start">Barcode</th>
                  <th className="px-3 py-2 text-start">Name</th>
                  <th className="px-3 py-2 text-start">Company</th>
                  <th className="px-3 py-2 text-start">Category</th>
                  <th className="px-3 py-2 text-start">Unit</th>
                  <th className="px-3 py-2 text-start">Created</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shownUnowned.map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2"><input type="checkbox" checked={picked.has(p.id)} onChange={() => togglePick(p.id)} /></td>
                    <td className="px-3 py-2 text-xs">{p.barcode ?? "—"}</td>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2">{p.company_name ?? "—"}</td>
                    <td className="px-3 py-2">{p.category_name ?? "—"}</td>
                    <td className="px-3 py-2">{p.unit_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{p.created_at.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-end">
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(`Delete "${p.name}" from the unowned catalog?`)) return;
                          await deleteUnownedProduct(p.id);
                          void loadTab("unowned");
                          void loadCounts();
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
                {loading && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">Loading…</td></tr>}
                {!loading && !shownUnowned.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">No unowned products</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Business-type tabs ── */}
      {activeTab !== "unowned" && (
        <>
          {/* Description */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <span className="font-semibold">{businessType(activeTab).label}</span> — products owned by tenants of this type.
            {shownTenant.length > 0 && (
              <span className="ml-2 text-neutral-400">{shownTenant.length.toLocaleString()} product{shownTenant.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <Input
              className="!w-72"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, barcode, company, tenant"
            />
            {tenantOptions.length > 1 && (
              <Select className="!w-56" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
                <option value="">All tenants</option>
                {tenantOptions.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </Select>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-start">Tenant</th>
                  <th className="px-3 py-2 text-start">Barcode</th>
                  <th className="px-3 py-2 text-start">Name</th>
                  <th className="px-3 py-2 text-start">Company</th>
                  <th className="px-3 py-2 text-start">Category</th>
                  <th className="px-3 py-2 text-start">Unit</th>
                  <th className="px-3 py-2 text-start">Added</th>
                </tr>
              </thead>
              <tbody>
                {shownTenant.map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        {p.tenant_name}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{p.barcode ?? "—"}</td>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2">{p.company_name ?? "—"}</td>
                    <td className="px-3 py-2">{p.category_name ?? "—"}</td>
                    <td className="px-3 py-2">{p.unit_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{p.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
                {loading && <tr><td colSpan={7} className="py-8 text-center text-neutral-400">Loading…</td></tr>}
                {!loading && !shownTenant.length && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-neutral-400">
                      {typeCounts[activeTab] === 0 || !typeCounts[activeTab]
                        ? "No tenants of this type have products yet."
                        : "No products match the filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Move / Copy modal (unowned tab only) */}
      {giving && (
        <Modal title={giving === "move" ? "Move to tenant" : "Copy to tenant"} onClose={() => setGiving(null)} width="max-w-md">
          <div className="space-y-3">
            <p className="text-sm">{picked.size} product(s) selected.</p>
            <Field label="Tenant" required>
              <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">Select…</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {businessType(t.business_type).label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setGiving(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!tenantId}
                onClick={async () => {
                  try {
                    const n = await giveProductsToTenant([...picked], tenantId, giving);
                    setMsg({ ok: true, text: `${n} product(s) ${giving === "move" ? "moved" : "copied"}.` });
                    setGiving(null);
                    void loadTab("unowned");
                    void loadCounts();
                  } catch (e) {
                    setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                {giving === "move" ? "Move" : "Copy"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
