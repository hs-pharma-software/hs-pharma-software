"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { listInvoicesForGrid, type InvoiceListRow } from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";
import { Pencil } from "lucide-react";
import { SaleReturnEditModal } from "@/components/invoices/SaleReturnEditModal";
import { useCan } from "@/lib/actionPermissions";

export default function InvoiceReturnsPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = useCan("invoice.edit");

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
    { header: "Paid Back", render: (r) => r.paid.toFixed(2) },
    ...(canEdit ? [{
      header: "",
      render: (r: InvoiceListRow) => (
        <button type="button" title="Edit" aria-label={`Edit return ${r.invoice_no ?? ""}`} onClick={(e) => { e.stopPropagation(); setEditing(r.id); }} className="rounded-full p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-amber-700">
          <Pencil size={15} />
        </button>
      ),
    }] : []),
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
      {editing && (
        <SaleReturnEditModal returnId={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />
      )}
    </div>
  );
}
