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
import { can } from "@/lib/actionPermissions";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  const mayExtra = can("customer.extra_discount");
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggleExtra(c: Customer) {
    setToggleError(null);
    try {
      await customersRepo.update(c.id, { extra_discount: Number(c.extra_discount ?? 0) === 1 ? 0 : 1 });
      await reload();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
    }
  }

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
    { header: "Phone No", render: (c) => c.phone ?? "\u2014" },
    { header: "CNIC / NTN", render: (c) => c.cnic_ntn ?? "\u2014" },
    { header: "Address", render: (c) => c.address ?? "\u2014" },
    { header: "Area", render: (c) => c.area ?? "\u2014" },
    {
      header: "Opening Balance",
      render: (c) => `${c.opening_balance.toFixed(2)} (${c.balance_type})`,
    },
    {
      header: "Extra Discount",
      render: (c) => {
        const on = Number(c.extra_discount ?? 0) === 1;
        return mayExtra ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void toggleExtra(c); }}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${on ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"} hover:ring-1 hover:ring-neutral-300`}
            title={on ? "Click to turn off" : "Click to allow extra discount on this customer's bills"}
          >
            {on ? "On" : "Off"}
          </button>
        ) : <span className="text-xs text-neutral-500">{on ? "On" : "Off"}</span>;
      },
    },
    {
      header: "",
      render: (c) => (
        <button type="button" className="text-[var(--accent)] hover:underline" onClick={(e) => { e.stopPropagation(); setEditing(c); setModalOpen(true); }}>
          Edit
        </button>
      ),
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

      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Input
          placeholder="Search by name, phone or area..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      {toggleError && <p className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700">{toggleError}</p>}

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

