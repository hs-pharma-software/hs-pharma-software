"use client";

import { useEffect, useState } from "react";
import { Eye, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { isTauri, useIsTauri } from "@/lib/platform";
import { financialClosingsRepo } from "@/lib/repo/financialClosings";
import type { FinancialClosing } from "@/lib/types2";

export default function FinancialClosingHistoryPage() {
  const [rows, setRows] = useState<FinancialClosing[]>([]);
  const [viewing, setViewing] = useState<FinancialClosing | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await financialClosingsRepo.list({ orderBy: "closed_at DESC" }));
  }

  useEffect(() => {
    void reload();
  }, []);

  function printRecord(r: FinancialClosing) {
    setViewing(r);
    setTimeout(() => window.print(), 150);
  }

  async function handleDelete(r: FinancialClosing) {
    const reason = window.prompt(`Delete this financial closing record (${new Date(r.closed_at).toLocaleString()})? Reason:`);
    if (reason === null) return;
    setDeletingId(r.id);
    try {
      await financialClosingsRepo.remove(r.id, reason || undefined, "Financial Closing");
      void reload();
    } finally {
      setDeletingId(null);
    }
  }

  const columns: Column<FinancialClosing>[] = [
    { header: "Date", render: (r) => r.date },
    { header: "Closed At", render: (r) => new Date(r.closed_at).toLocaleString() },
    { header: "Batch Action", render: (r) => (r.batch_action === "archive" ? "Archive expired batches" : "Keep all batches") },
    { header: "Description", render: (r) => r.description ?? "\u2014" },
    {
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-2.5 text-neutral-500">
          <button type="button" title="View" onClick={(e) => { e.stopPropagation(); setViewing(r); }} className="hover:text-amber-700">
            <Eye size={16} />
          </button>
          <button type="button" title="Print" onClick={(e) => { e.stopPropagation(); printRecord(r); }} className="hover:text-amber-700">
            <Printer size={16} />
          </button>
          <button
            type="button"
            title="Delete"
            disabled={deletingId === r.id}
            onClick={(e) => { e.stopPropagation(); void handleDelete(r); }}
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
      <PageHeader title="View Financial Closing" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to view closing history.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={setViewing}
          emptyMessage="No financial year has been closed yet."
        />
      )}

      {viewing && (
        <Modal title="Financial Closing Detail" onClose={() => setViewing(null)} width="max-w-md">
          <div className="flex justify-end pb-3">
            <Button onClick={() => window.print()}>Print</Button>
          </div>
          <div className="print-area rounded-lg border border-neutral-200 p-5 text-sm">
            <h3 className="mb-3 font-serif text-lg text-neutral-800">Financial Year Closing</h3>
            <p>
              <span className="font-medium text-neutral-800">Closed At:</span>{" "}
              {new Date(viewing.closed_at).toLocaleString()}
            </p>
            <p className="mt-1">
              <span className="font-medium text-neutral-800">Batch Action:</span>{" "}
              {viewing.batch_action === "archive" ? "Archive expired batches" : "Keep all batches"}
            </p>
            {viewing.description && (
              <p className="mt-1">
                <span className="font-medium text-neutral-800">Description:</span> {viewing.description}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
