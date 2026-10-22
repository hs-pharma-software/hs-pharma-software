"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { listInvoicesForGrid, invoicesRepo, type InvoiceListRow } from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";

export default function MemorizedInvoicesPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listInvoicesForGrid({ isMemorized: true }));
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<InvoiceListRow>[] = [
    { header: "Date", render: (r) => r.date },
    { header: "Customer", render: (r) => r.customer_name },
    { header: "Total Bill", render: (r) => r.total.toFixed(2) },
    {
      header: "Action",
      render: (r) => (
        <button
          type="button"
          className="text-amber-700 hover:underline"
          onClick={async (e) => {
            e.stopPropagation();
            await invoicesRepo.update(r.id, { is_memorized: 0 });
            void reload();
          }}
        >
          Convert To Invoice
        </button>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Memorized Invoice Detail" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view memorized invoices.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} emptyMessage="No content in table \u2014 use Memorize on Create Invoice to save a draft here (not wired up in this build yet)." />
      )}
    </div>
  );
}
