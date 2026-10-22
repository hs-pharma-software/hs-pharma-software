"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { QuotationFormModal } from "@/components/invoices/QuotationFormModal";
import { listQuotations, convertQuotationToInvoice, type QuotationListRow } from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";

export default function QuotationsPage() {
  const [rows, setRows] = useState<QuotationListRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listQuotations());
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleAccept(row: QuotationListRow) {
    if (row.converted_invoice_id) return;
    if (!window.confirm(`Accept Quotation #${row.quotation_no ?? ""}? This will create a real invoice and deduct stock.`)) {
      return;
    }
    setAcceptingId(row.id);
    setError(null);
    try {
      await convertQuotationToInvoice(row.id);
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptingId(null);
    }
  }

  const columns: Column<QuotationListRow>[] = [
    { header: "Quotation #", render: (r) => r.quotation_no ?? "\u2014" },
    { header: "Date", render: (r) => r.date },
    { header: "Customer", render: (r) => r.customer_name },
    { header: "Salesman", render: (r) => r.salesman_name ?? "\u2014" },
    { header: "Payable (Est.)", render: (r) => r.payable.toFixed(2) },
    {
      header: "Status",
      render: (r) =>
        r.converted_invoice_id ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            Converted → Invoice #{r.converted_invoice_no ?? "\u2014"}
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Pending</span>
        ),
    },
    {
      header: "Action",
      render: (r) =>
        r.converted_invoice_id ? (
          <span className="text-neutral-400">{"\u2014"}</span>
        ) : (
          <button
            type="button"
            disabled={acceptingId === r.id}
            className="text-emerald-700 hover:underline disabled:opacity-40"
            onClick={(e) => {
              e.stopPropagation();
              void handleAccept(r);
            }}
          >
            {acceptingId === r.id ? "Accepting..." : "Accept → Generate Invoice"}
          </button>
        ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Quotation Details"
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {error && (
        <p className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>
      )}

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage quotations.
        </p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          emptyMessage="No content in table \u2014 use Add to create a quotation. Quotations don't count toward sales/invoices until accepted."
        />
      )}

      {modalOpen && (
        <QuotationFormModal
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
