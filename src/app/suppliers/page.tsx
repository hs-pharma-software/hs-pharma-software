"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { SupplierFormModal } from "@/components/suppliers/SupplierFormModal";
import { suppliersRepo } from "@/lib/repo/suppliers";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Supplier } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";
import { listVendors, type VendorRow } from "@/lib/repo/vendors";

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const hospital = useAuthStore((st) => st.currentTenant?.businessType) === "hospital";
  const [balances, setBalances] = useState<Map<string, VendorRow>>(new Map());

  async function reload() {
    if (!isTauri()) return;
    setSuppliers(await suppliersRepo.list());
    if (hospital) setBalances(new Map((await listVendors().catch(() => [])).map((v) => [v.id, v])));
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = suppliers.filter((s) => {
    const term = search.toLowerCase();
    return (
      !term ||
      s.name.toLowerCase().includes(term) ||
      (s.phone ?? "").toLowerCase().includes(term) ||
      (s.company_name ?? "").toLowerCase().includes(term) ||
      (s.vendor_no ?? "").toLowerCase().includes(term)
    );
  });

  const columns: Column<Supplier>[] = [
    { header: "Name", render: (s) => <span className="font-medium">{s.name}</span> },
    { header: "Company Name", render: (s) => s.company_name ?? "\u2014" },
    { header: "Phone No", render: (s) => s.phone ?? "\u2014" },
    { header: "CNIC", render: (s) => s.cnic ?? "\u2014" },
    { header: "Address", render: (s) => s.address ?? "\u2014" },
    { header: "Opening Balance", render: (s) => s.opening_balance.toFixed(2) },
  ];
  if (hospital) {
    const KIND: Record<string, string> = { supplier: "Supplier", vendor: "Vendor", both: "Supplier & vendor" };
    columns.unshift({ header: "Vendor No", render: (s) => <span className="font-mono text-xs">{s.vendor_no ?? "—"}</span> });
    columns.splice(2, 0, { header: "Type", render: (s) => KIND[s.party_kind ?? "supplier"] });
    columns.push(
      { header: "Bank", render: (s) => s.iban ? <span className="text-xs">{s.bank_title ?? ""}<span className="block font-mono text-[11px] text-neutral-500">{s.iban}</span></span> : "—" },
      { header: "Balance", render: (s) => { const b = balances.get(s.id)?.balance ?? 0; return <span className={`tabular-nums font-semibold ${b > 0 ? "text-rose-700" : "text-neutral-600"}`}>{b.toLocaleString("en-PK", { maximumFractionDigits: 0 })}</span>; } },
    );
  }

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title={hospital ? "Supplier & Vendors" : "Supplier Details"}
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

      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-4 py-2.5">
        <Input
          placeholder={hospital ? "Search by name, phone, company or vendor no..." : "Search by name, phone or company..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage suppliers.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(s) => {
            setEditing(s);
            setModalOpen(true);
          }}
        />
      )}

      {modalOpen && (
        <SupplierFormModal
          supplier={editing}
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

