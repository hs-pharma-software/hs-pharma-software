"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { listInvoicesForGrid, type InvoiceListRow } from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";

export default function InvoiceReturnsPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listInvoicesForGrid({ isReturn: true }));
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<InvoiceListRow>[] = [
    { header: "Return #", render: (r) => r.invoice_no ?? "\u2014" },
    { header: "Against Bill #", render: (r) => r.original_invoice_no ?? "\u2014" },
    { header: "Date", render: (r) => r.date },
    { header: "Customer", render: (r) => r.customer_name },
    { header: "Total Refunded", render: (r) => r.total.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Invoice Return Details" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view invoice returns.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}
    </div>
  );
}
