"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { InvoiceViewModal } from "@/components/invoices/InvoiceViewModal";
import { listNarcoticInvoices, invoicesRepo, type NarcoticInvoiceRow } from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Invoice } from "@/lib/types2";

export default function NarcoticsPage() {
  const tauriReady = useIsTauri();
  const [rows, setRows] = useState<NarcoticInvoiceRow[]>([]);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [viewing, setViewing] = useState<{ invoice: Invoice; customerName: string; salesmanName: string | null } | null>(
    null
  );

  async function reload() {
    if (!isTauri()) return;
    setRows(await listNarcoticInvoices());
  }

  useEffect(() => {
    void reload();
  }, []);

  async function openView(r: NarcoticInvoiceRow) {
    const invoice = await invoicesRepo.get(r.id);
    if (invoice) setViewing({ invoice, customerName: r.customer_name, salesmanName: r.salesman_name });
  }

  const term = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (!term) return true;
    return (
      r.customer_name.toLowerCase().includes(term) ||
      (r.customer_phone ?? "").includes(term) ||
      String(r.invoice_no ?? "").includes(term) ||
      r.narcotic_items.toLowerCase().includes(term)
    );
  });

  const missingContact = filtered.filter((r) => !r.customer_phone || r.customer_name === "Walk-in").length;

  const columns: Column<NarcoticInvoiceRow>[] = [
    { header: "Bill #", render: (r) => r.invoice_no ?? "—" },
    { header: "Date", render: (r) => r.date },
    { header: "Customer", render: (r) => <span className="font-medium">{r.customer_name}</span> },
    {
      header: "Mobile",
      render: (r) => r.customer_phone ?? <span className="text-rose-500">Missing</span>,
    },
    { header: "CNIC / NTN", render: (r) => r.buyer_ntn_cnic ?? "—" },
    { header: "Salesman", render: (r) => r.salesman_name ?? "—" },
    {
      header: "Narcotic Products",
      render: (r) => <span className="whitespace-normal text-rose-700">{r.narcotic_items}</span>,
    },
    { header: "Total Bill", render: (r) => r.total.toFixed(2) },
  ];

  return (
    <div>
      <PageHeader title="Narcotics" actions={<Button onClick={() => void reload()}>Refresh</Button>} />

      <div className="mb-3 grid grid-cols-1 gap-3 rounded-2xl bg-white px-4 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="Search">
            <Input
              placeholder="Customer, mobile, bill # or product..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
        </div>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to see narcotic sales.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={filtered} onRowClick={(r) => void openView(r)} />
          <div className="mt-3 flex flex-wrap gap-6 rounded-2xl bg-white px-4 py-2.5 text-sm shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
            <span>
              Invoices: <span className="font-semibold">{filtered.length}</span>
            </span>
            <span>
              Total: <span className="font-semibold">{filtered.reduce((s, r) => s + r.total, 0).toFixed(2)}</span>
            </span>
            {missingContact > 0 && (
              <span className="text-rose-600">
                {missingContact} older invoice(s) missing customer name or mobile
              </span>
            )}
          </div>
        </>
      )}

      {viewing && <InvoiceViewModal row={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
