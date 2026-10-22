"use client";

import { useEffect, useState } from "react";
import { Eye, Pencil, Trash2, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { InvoiceFormModal } from "@/components/invoices/InvoiceFormModal";
import { InvoiceViewModal } from "@/components/invoices/InvoiceViewModal";
import {
  listInvoicesForGrid,
  invoicesRepo,
  deleteInvoiceWithStockRestore,
  type InvoiceListRow,
} from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAppStore } from "@/store/appStore";
import type { Invoice } from "@/lib/types2";

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [viewing, setViewing] = useState<{ invoice: Invoice; customerName: string; salesmanName: string | null } | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const pendingAction = useAppStore((s) => s.pendingAction);
  const setPendingAction = useAppStore((s) => s.setPendingAction);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listInvoicesForGrid());
  }

  useEffect(() => {
    void reload();
  }, []);

  // Ctrl+N (see GlobalShortcuts.tsx) lands here as a store flag.
  useEffect(() => {
    if (pendingAction === "new-invoice") {
      setEditingInvoice(null);
      setModalOpen(true);
      setPendingAction(null);
    }
  }, [pendingAction, setPendingAction]);

  async function openEdit(row: InvoiceListRow) {
    const full = await invoicesRepo.get(row.id);
    if (!full) return;
    setEditingInvoice(full);
    setModalOpen(true);
  }

  async function openView(row: InvoiceListRow) {
    const full = await invoicesRepo.get(row.id);
    if (!full) return;
    setViewing({ invoice: full, customerName: row.customer_name, salesmanName: row.salesman_name });
  }

  async function handleDelete(row: InvoiceListRow) {
    const reason = window.prompt(`Delete invoice #${row.invoice_no ?? ""}? This restores its stock. Reason:`);
    if (reason === null) return; // cancelled
    setDeletingId(row.id);
    try {
      await deleteInvoiceWithStockRestore(row.id, reason || undefined);
      void reload();
    } finally {
      setDeletingId(null);
    }
  }

  async function printInvoice(row: InvoiceListRow) {
    await openView(row);
    // Give the view modal a tick to render #invoice-print-area before printing.
    setTimeout(() => window.print(), 150);
  }

  const columns: Column<InvoiceListRow>[] = [
    { header: "Bill #", render: (r) => r.invoice_no ?? "\u2014" },
    { header: "Date", render: (r) => r.date },
    { header: "Salesman", render: (r) => r.salesman_name ?? "\u2014" },
    { header: "Customer", render: (r) => r.customer_name },
    { header: "Total Bill", render: (r) => r.total.toFixed(2) },
    { header: "Paid", render: (r) => r.paid.toFixed(2) },
    { header: "Balance", render: (r) => r.balance.toFixed(2) },
    {
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-2.5 text-neutral-500">
          <button
            type="button"
            title="View"
            onClick={(e) => {
              e.stopPropagation();
              void openView(r);
            }}
            className="hover:text-amber-700"
          >
            <Eye size={16} />
          </button>
          <button
            type="button"
            title="Edit"
            onClick={(e) => {
              e.stopPropagation();
              void openEdit(r);
            }}
            className="hover:text-amber-700"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            title="Print"
            onClick={(e) => {
              e.stopPropagation();
              void printInvoice(r);
            }}
            className="hover:text-amber-700"
          >
            <Printer size={16} />
          </button>
          <button
            type="button"
            title="Delete"
            disabled={deletingId === r.id}
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(r);
            }}
            className="hover:text-rose-600 disabled:opacity-40"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Invoices Details"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditingInvoice(null);
                setModalOpen(true);
              }}
              title="Ctrl+N"
            >
              New Invoice
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage invoices.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} onRowClick={(r) => void openView(r)} />
      )}

      {modalOpen && (
        <InvoiceFormModal
          invoice={editingInvoice}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}

      {viewing && <InvoiceViewModal row={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
