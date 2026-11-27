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
  deleteTenantProducts,
  giveProductsToTenant,
  listProductsByBusinessType,
  listUnownedProducts,
  unownedCounts,
  type TenantProductRow,
  type UnownedProductRow,
} from "@/lib/repo/catalogAdmin";
import type { Tenant } from "@/lib/types2";
import { PHARMACY_FAMILY_TYPES } from "@/lib/catalogAccess";
import { serverJson } from "@/lib/serverMode";
import type { ShareResult } from "@/server/catalogShare";
import { ArrowLeft, Share2, Store } from "lucide-react";

/** Retail pharmacies, medical stores and hospital pharmacies: one shared Pharmacy catalogue, and one tab for their own products. */
const PHARMACIES_TAB = "pharmacies";
const PHARMACY_TYPES: readonly string[] = PHARMACY_FAMILY_TYPES;
const pharmacyTypeNames = PHARMACY_TYPES.map((t) => businessType(t).label);

// Rows with no business (tenant_id NULL): the shared catalogues every business of a
// type sees, and the quarantine bucket of rows that belong to no catalogue.
type SharedTab = "shared:pharma" | "shared:general_store";
type TabId = string | SharedTab | "unowned";
const isNoBusinessTab = (t: TabId) => t === "unowned" || t.startsWith("shared:");
/** Which tab a row with no business belongs to. Rows from before v32 have no group: pharmacies see them. */
const tabOfShared = (p: { catalog_group: string | null }): TabId =>
  p.catalog_group === "general_store" ? "shared:general_store" : p.catalog_group == null || p.catalog_group === "pharma" ? "shared:pharma" : "unowned";
const SHARED_INFO: Record<SharedTab, { label: string; seenBy: string }> = {
  "shared:pharma": { label: "Pharmacy catalogue (shared)", seenBy: `every ${pharmacyTypeNames.join(", ")}` },
  "shared:general_store": { label: "General store catalogue (shared)", seenBy: "every general store, pharmacy and medical store" },
};

export default function AdminCatalogReviewPage() {
  const tauri = useIsTauri();
  const [activeTab, setActiveTab] = useState<TabId>("shared:pharma");
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [unownedCount, setUnownedCount] = useState(0);

  // Per-tab data
  const [tenantRows, setTenantRows] = useState<(TenantProductRow & { btype?: string })[]>([]);
  const [unownedRows, setUnownedRows] = useState<UnownedProductRow[]>([]);
  const [unownedMeta, setUnownedMeta] = useState<Record<string, number>>({});

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState("");
  const [tenantFilter, setTenantFilter] = useState(""); // for tenant tabs
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedTenant, setPickedTenant] = useState<Set<string>>(new Set());
  const [giving, setGiving] = useState<"move" | "copy" | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  // Pharmacies (own): a pharmacy's products shared to a shared catalogue.
  const [shareTarget, setShareTarget] = useState<"pharma" | "general_store">("pharma");
  const [sharing, setSharing] = useState<string | null>(null);

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
    setPickedTenant(new Set());
    setMsg(null);
    try {
      if (isNoBusinessTab(tab)) {
        const [rows, allTenants] = await Promise.all([listUnownedProducts(), tenantsRepo.list({ orderBy: "name ASC" })]);
        setUnownedRows(rows);
        setTenants(allTenants);
      } else {
        // The pharmacies' tab: their three types together, each row marked with its type.
        const types = tab === PHARMACIES_TAB ? PHARMACY_TYPES : [tab];
        const lists = await Promise.all(types.map(async (t) => (await listProductsByBusinessType(t)).map((r) => ({ ...r, btype: t }))));
        setTenantRows(lists.flat().sort((a, b) => a.tenant_name.localeCompare(b.tenant_name) || a.name.localeCompare(b.name)));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCounts();
    void loadTab("shared:pharma");
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
  const noBusinessCount = (t: TabId) => unownedRows.filter((p) => tabOfShared(p) === t).length;
  const shownUnowned = unownedRows.filter(
    (p) => tabOfShared(p) === activeTab).filter((p) => !term || p.name.toLowerCase().includes(term) || (p.barcode ?? "").toLowerCase().includes(term) || (p.company_name ?? "").toLowerCase().includes(term)
  );
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePickTenant = (id: string) => setPickedTenant((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

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

  // ── Pharmacies (own): each pharmacy, then its products and sharing ─────────
  const pharmacyCards = [...tenantRows.reduce((m, r) => {
    const c = m.get(r.tenant_id) ?? { id: r.tenant_id, name: r.tenant_name, btype: r.btype ?? "", count: 0 };
    c.count++;
    return m.set(r.tenant_id, c);
  }, new Map<string, { id: string; name: string; btype: string; count: number }>()).values()].sort((a, b) => a.name.localeCompare(b.name));
  const openPharmacy = activeTab === PHARMACIES_TAB ? pharmacyCards.find((c) => c.id === tenantFilter) ?? null : null;
  const targetLabel = shareTarget === "pharma" ? "Pharmacy catalogue (shared)" : "General store catalogue (shared)";

  async function shareProducts(ids: string[] | "all") {
    if (!openPharmacy) return;
    const what = ids === "all" ? `all ${openPharmacy.count} products of ${openPharmacy.name}` : `${ids.length} product(s) of ${openPharmacy.name}`;
    if (!confirm(`Share ${what} to the ${targetLabel}?\n\nEvery pharmacy then sees them. ${openPharmacy.name} keeps its stock, prices and history on the same products, so nothing shows twice. A product the catalogue already has (same name) is merged into it.`)) return;
    setSharing(ids === "all" ? "all" : ids.length === 1 ? ids[0] : "picked");
    setMsg(null);
    let shared = 0, merged = 0;
    const skipped: { name: string; reason: string }[] = [];
    try {
      // Large lists go in parts (the server takes a few hundred at a time).
      for (let round = 0; round < 50; round++) {
        const r = (await serverJson<{ result: ShareResult }>("/api/catalog/share/", { tenantId: openPharmacy.id, target: shareTarget, ...(ids === "all" ? { all: true } : { productIds: ids }) })).result;
        shared += r.shared; merged += r.merged; skipped.push(...r.skipped);
        if (ids !== "all" || r.remaining === 0 || r.shared + r.merged === 0) break;
      }
      setMsg({ ok: skipped.length === 0, text: `${shared} product(s) now in the ${targetLabel}; ${merged} merged into products it already had.` + (skipped.length ? ` ${skipped.length} not shared: ${skipped.slice(0, 3).map((x) => `${x.name} (${x.reason})`).join(" · ")}` : "") });
      setPickedTenant(new Set());
      void loadCounts();
      const keep = tenantFilter;
      await loadTab(activeTab);
      setTenantFilter(keep);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSharing(null);
    }
  }

  // ── Tab bar ─────────────────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "shared:pharma", label: SHARED_INFO["shared:pharma"].label, count: unownedRows.length ? noBusinessCount("shared:pharma") : unownedCount },
    { id: "shared:general_store", label: SHARED_INFO["shared:general_store"].label, count: noBusinessCount("shared:general_store") },
    { id: PHARMACIES_TAB, label: "Pharmacies (own)", count: PHARMACY_TYPES.reduce((n, t) => n + (typeCounts[t] ?? 0), 0) },
    ...BUSINESS_TYPES.filter((bt) => !PHARMACY_TYPES.includes(bt.id)).map((bt) => ({
      id: bt.id as TabId,
      label: `${bt.label} (own)`,
      count: typeCounts[bt.id] ?? 0,
    })),
    { id: "unowned", label: "Unowned", count: noBusinessCount("unowned") },
  ];
  const sharedTab = activeTab.startsWith("shared:") ? SHARED_INFO[activeTab as SharedTab] : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Catalog Review"
        actions={
          sharedTab ? (
            <>
              {/* No copies to businesses: they already see the shared catalogue (a copy would show twice). */}
              <Button disabled={!picked.size} onClick={() => setGiving("move")} title="Take the product out of the shared catalogue and give it to one business only">Move to one tenant</Button>
              <Button onClick={() => { void loadTab(activeTab); void loadCounts(); }}>Refresh</Button>
            </>
          ) : activeTab === "unowned" ? (
            <>
              <Button disabled={!picked.size} onClick={() => setGiving("move")}>Move to tenant</Button>
              <Button disabled={!picked.size} onClick={() => setGiving("copy")}>Copy to tenant</Button>
              <Button loading={assigning}
                variant="primary"
                disabled={assigning}
                onClick={async () => {
                  if (!confirm("Give businesses their own copy of unowned products?\n\nBusinesses that already see a product in the shared catalog (pharmacies for pharma products, general stores for general-store products) are skipped, so nothing is shown twice.\n\nSafe to run more than once.")) return;
                  setAssigning(true);
                  try {
                    const { assigned, skipped } = await bulkAssignByClassification();
                    setMsg({ ok: true, text: `Bulk assign complete: ${assigned} copies created, ${skipped} skipped (already visible in the shared catalog, or no matching business).` });
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
            <>
              {openPharmacy && <>
                <Select className="!w-auto" value={shareTarget} onChange={(e) => setShareTarget(e.target.value as "pharma" | "general_store")} aria-label="Share to">
                  <option value="pharma">To Pharmacy catalogue</option>
                  <option value="general_store">To General store catalogue</option>
                </Select>
                <Button loading={sharing === "picked"} disabled={!pickedTenant.size || sharing !== null} onClick={() => void shareProducts([...pickedTenant])}>
                  <Share2 size={14} className="mr-1" />Share selected ({pickedTenant.size})
                </Button>
                <Button variant="primary" loading={sharing === "all"} disabled={sharing !== null || !openPharmacy.count} onClick={() => void shareProducts("all")}>
                  <Share2 size={14} className="mr-1" />Share all {openPharmacy.count}
                </Button>
              </>}
              <Button
                disabled={!pickedTenant.size}
                onClick={async () => {
                  if (!confirm(`Delete ${pickedTenant.size} selected product(s)? This cannot be undone.`)) return;
                  try {
                    const n = await deleteTenantProducts([...pickedTenant]);
                    setMsg({ ok: true, text: `${n} product(s) deleted.` });
                    void loadTab(activeTab);
                    void loadCounts();
                  } catch (e) {
                    setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                Delete Selected ({pickedTenant.size})
              </Button>
              <Button onClick={() => { void loadTab(activeTab); void loadCounts(); }}>Refresh</Button>
            </>
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
              <span className="flex flex-col items-start leading-tight">
                {tab.label}
                {tab.id === "shared:pharma" && <span className={`text-[10px] font-normal ${active ? "text-white/70" : "text-neutral-400"}`}>{pharmacyTypeNames.join(" · ")}</span>}
              </span>
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

      {/* ── Shared catalogue and unowned tabs ── */}
      {isNoBusinessTab(activeTab) && (
        <>
          {sharedTab ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <b>{sharedTab.label}</b>: products added by businesses to the shared catalogue, seen by <b>{sharedTab.seenBy}</b>. Nothing needs assigning.
              Duplicates are merged in Super Admin › Duplicate Products. {shownUnowned.length.toLocaleString()} product{shownUnowned.length === 1 ? "" : "s"}.
            </div>
          ) : (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            These rows belong to no business and no shared catalogue: the ownership migration could not attribute them.
            <b> Move</b> gives the row to one tenant; <b>Copy</b> gives a tenant its own copy and keeps the original here.
            Unowned: {unownedMeta.products ?? 0} products, {unownedMeta.categories ?? 0} categories,{" "}
            {unownedMeta.sub_categories ?? 0} sub categories, {unownedMeta.uoms ?? 0} units, {unownedMeta.generic_names ?? 0} generic names (all rows with no business, shared catalogues included).
          </div>
          )}
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
                          if (!confirm(sharedTab
                            ? `Delete "${p.name}" from the shared catalogue? It disappears from the product list of ${sharedTab.seenBy} (their past records stay).`
                            : `Delete "${p.name}" from the unowned catalog?`)) return;
                          await deleteUnownedProduct(p.id);
                          void loadTab(activeTab);
                          void loadCounts();
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
                {loading && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">Loading…</td></tr>}
                {!loading && !shownUnowned.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{sharedTab ? "No products in this catalogue" : "No unowned products"}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Business-type tabs ── */}
      {!isNoBusinessTab(activeTab) && (
        <>
          {/* Description */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <span className="font-semibold">{openPharmacy ? `${openPharmacy.name} (${businessType(openPharmacy.btype).label})` : activeTab === PHARMACIES_TAB ? `Pharmacies (${pharmacyTypeNames.join(", ")})` : businessType(activeTab).label}</span> — each business&apos;s own products (not shared with others). Products these businesses add to a shared catalogue are in the shared catalogue tabs.
            {shownTenant.length > 0 && (
              <span className="ml-2 text-neutral-400">{shownTenant.length.toLocaleString()} product{shownTenant.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {activeTab === PHARMACIES_TAB && !openPharmacy ? (
            loading ? <div className="h-32 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />
            : pharmacyCards.length === 0 ? <p className="py-8 text-center text-sm text-neutral-400">No pharmacy has products of its own.</p> : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {pharmacyCards.map((c, i) => (
                <li key={c.id} className="row-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                  <button type="button" onClick={() => { setTenantFilter(c.id); setPickedTenant(new Set()); setSearch(""); }}
                    className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-black/5 transition hover:shadow-md hover:ring-[var(--accent)]/40">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Store size={18} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-neutral-900">{c.name}</span>
                      <span className="block text-xs text-neutral-500">{businessType(c.btype).label} · {c.count.toLocaleString()} own product{c.count === 1 ? "" : "s"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )) : <>
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            {openPharmacy && (
              <Button onClick={() => { setTenantFilter(""); setPickedTenant(new Set()); setSearch(""); }}><ArrowLeft size={14} className="mr-1" />All pharmacies</Button>
            )}
            <Input
              className="!w-72"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, barcode, company, tenant"
            />
            {tenantOptions.length > 1 && !openPharmacy && (
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
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={shownTenant.length > 0 && shownTenant.every((p) => pickedTenant.has(p.id))}
                      onChange={(e) => setPickedTenant(e.target.checked ? new Set(shownTenant.map((p) => p.id)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2 text-start">Tenant</th>
                  <th className="px-3 py-2 text-start">Barcode</th>
                  <th className="px-3 py-2 text-start">Name</th>
                  <th className="px-3 py-2 text-start">Company</th>
                  <th className="px-3 py-2 text-start">Category</th>
                  <th className="px-3 py-2 text-start">Unit</th>
                  <th className="px-3 py-2 text-start">Added</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shownTenant.map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2"><input type="checkbox" checked={pickedTenant.has(p.id)} onChange={() => togglePickTenant(p.id)} /></td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
                        {p.tenant_name}
                      </span>
                      {activeTab === PHARMACIES_TAB && p.btype && <span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">{businessType(p.btype).label}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{p.barcode ?? "—"}</td>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2">{p.company_name ?? "—"}</td>
                    <td className="px-3 py-2">{p.category_name ?? "—"}</td>
                    <td className="px-3 py-2">{p.unit_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{p.created_at.slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-end">
                      {openPharmacy && (
                        <Button variant="ghost" loading={sharing === p.id} disabled={sharing !== null} onClick={() => void shareProducts([p.id])} title={`Share to the ${targetLabel}`}>
                          <Share2 size={13} className="mr-1" />Share
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(`Delete "${p.name}" from ${p.tenant_name}?`)) return;
                          try {
                            await deleteTenantProducts([p.id]);
                            void loadTab(activeTab);
                            void loadCounts();
                          } catch (e) {
                            setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
                {loading && <tr><td colSpan={9} className="py-8 text-center text-neutral-400">Loading…</td></tr>}
                {!loading && !shownTenant.length && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-neutral-400">
                      {!tabs.find((t) => t.id === activeTab)?.count
                        ? "No tenants of this type have products yet."
                        : "No products match the filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>}
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
                    const r = await giveProductsToTenant([...picked], tenantId, giving);
                    const verb = giving === "move" ? "moved" : "copied";
                    const why = r.skipped.slice(0, 5).map((x) => `${x.name}: ${x.reason}`).join(" · ");
                    setMsg({
                      ok: r.skipped.length === 0,
                      text: `${r.done.length} product(s) ${verb}.` + (r.skipped.length ? ` ${r.skipped.length} not ${verb}: ${why}${r.skipped.length > 5 ? " …" : ""}` : ""),
                    });
                    setGiving(null);
                    void loadTab(activeTab);
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
