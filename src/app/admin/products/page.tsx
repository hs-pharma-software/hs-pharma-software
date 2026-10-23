"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri, useIsTauri } from "@/lib/platform";
import { tenantsRepo } from "@/lib/repo/tenants";
import { businessType } from "@/config/businessTypes";
import { deleteUnownedProduct, giveProductsToTenant, listUnownedProducts, unownedCounts, type UnownedProductRow } from "@/lib/repo/catalogAdmin";
import type { Tenant } from "@/lib/types2";

/** Catalog review: products that belong to no tenant. Since every tenant has
 * its own catalog, these are never shown to anyone until handed over here. */
export default function AdminCatalogReviewPage() {
  const tauri = useIsTauri();
  const [rows, setRows] = useState<UnownedProductRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [giving, setGiving] = useState<"move" | "copy" | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const [r, c, t] = await Promise.all([listUnownedProducts(), unownedCounts(), tenantsRepo.list({ orderBy: "name ASC" })]);
    setRows(r);
    setCounts(c);
    setTenants(t);
    setPicked(new Set());
  }

  useEffect(() => {
    void reload();
  }, []);

  const term = search.trim().toLowerCase();
  const shown = rows.filter((p) => !term || p.name.toLowerCase().includes(term) || (p.barcode ?? "").toLowerCase().includes(term) || (p.company_name ?? "").toLowerCase().includes(term));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (!tauri) return <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">Run inside the desktop app to review the catalog.</p>;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Catalog Review (unowned items)"
        actions={
          <>
            <Button disabled={!picked.size} onClick={() => setGiving("move")}>Move to tenant</Button>
            <Button disabled={!picked.size} onClick={() => setGiving("copy")}>Copy to tenant</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
        Every tenant has its own product catalog. These rows belong to no tenant: the ownership migration found no stock, price, sale, purchase,
        order or audit line proving which business uses them, so they are hidden from every tenant. <b>Move</b> gives the row to one tenant;
        <b> Copy</b> gives a tenant its own copy and keeps the original here. Unowned now: {counts.products ?? 0} products, {counts.categories ?? 0} categories,{" "}
        {counts.sub_categories ?? 0} sub categories, {counts.uoms ?? 0} units, {counts.generic_names ?? 0} generic names (categories and units follow the products you hand over).
      </div>
      {msg && <div className={`rounded-xl border px-4 py-2.5 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{msg.text}</div>}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, barcode, company" />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">
                <input type="checkbox" checked={shown.length > 0 && shown.every((p) => picked.has(p.id))} onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())} />
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
            {shown.map((p) => (
              <tr key={p.id} className="border-t border-neutral-100">
                <td className="px-3 py-2"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
                <td className="px-3 py-2">{p.barcode ?? "—"}</td>
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
                      void reload();
                    }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">No content in table</td></tr>}
          </tbody>
        </table>
      </div>
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
                    setMsg({ ok: true, text: `${n} product(s) ${giving === "move" ? "moved" : "copied"}. They reach the tenant on its next sync.` });
                    setGiving(null);
                    void reload();
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
