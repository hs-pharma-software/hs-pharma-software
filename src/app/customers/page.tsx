"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { CustomerFormModal } from "@/components/customers/CustomerFormModal";
import { customersRepo } from "@/lib/repo/customers";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setCustomers(await customersRepo.list());
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = customers.filter((c) => {
    const term = search.toLowerCase();
    return (
      !term ||
      c.name.toLowerCase().includes(term) ||
      (c.phone ?? "").toLowerCase().includes(term) ||
      (c.area ?? "").toLowerCase().includes(term)
    );
  });

  const columns: Column<Customer>[] = [
    { header: "Name", render: (c) => <span className="font-medium">{c.name}</span> },
    { header: "Phone No", render: (c) => c.phone ?? "—" },
    { header: "CNIC / NTN", render: (c) => c.cnic_ntn ?? "—" },
    { header: "Address", render: (c) => c.address ?? "—" },
    { header: "Area", render: (c) => c.area ?? "—" },
    {
      header: "Opening Balance",
      render: (c) => `${c.opening_balance.toFixed(2)} (${c.balance_type})`,
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Customer Details"
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

      <div className="mb-3 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-2.5">
        <Input
          placeholder="Search by name, phone or area..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {!tauriReady ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage customers.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(c) => {
            setEditing(c);
            setModalOpen(true);
          }}
        />
      )}

      {modalOpen && (
        <CustomerFormModal
          customer={editing}
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
