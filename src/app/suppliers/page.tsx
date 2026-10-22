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

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setSuppliers(await suppliersRepo.list());
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
      (s.company_name ?? "").toLowerCase().includes(term)
    );
  });

  const columns: Column<Supplier>[] = [
    { header: "Name", render: (s) => <span className="font-medium">{s.name}</span> },
    { header: "Company Name", render: (s) => s.company_name ?? "â€”" },
    { header: "Phone No", render: (s) => s.phone ?? "â€”" },
    { header: "CNIC", render: (s) => s.cnic ?? "â€”" },
    { header: "Address", render: (s) => s.address ?? "â€”" },
    { header: "Opening Balance", render: (s) => s.opening_balance.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Supplier Details"
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
          placeholder="Search by name, phone or company..."
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

