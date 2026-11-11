"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { QuotationFormModal } from "@/components/invoices/QuotationFormModal";
import { listQuotations, convertQuotationToInvoice, deleteQuotation, type QuotationListRow } from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";

export default function QuotationsPage() {
  const [rows, setRows] = useState<QuotationListRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  /** An existing quotation opened to view or edit. */
  const [opened, setOpened] = useState<{ id: string; viewOnly: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  async function handleDelete(row: QuotationListRow) {
    if (row.converted_invoice_id) return;
    const reason = window.prompt(`Delete Quotation #${row.quotation_no ?? ""}? It does not affect stock or sales.\n\nReason (kept in the delete history):`);
    if (reason === null) return;
    setDeletingId(row.id);
    setError(null);
    try {
      await deleteQuotation(row.id, reason.trim());
      void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
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
      render: (r) => (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap">
          <button type="button" className="text-[var(--accent)] hover:underline" onClick={(e) => { e.stopPropagation(); setOpened({ id: r.id, viewOnly: true }); }}>
            View
          </button>
          {!r.converted_invoice_id && (
            <>
              <button type="button" className="text-neutral-800 hover:underline" onClick={(e) => { e.stopPropagation(); setOpened({ id: r.id, viewOnly: false }); }}>
                Edit
              </button>
              <button type="button" disabled={deletingId === r.id} className="text-rose-600 hover:underline disabled:opacity-40" onClick={(e) => { e.stopPropagation(); void handleDelete(r); }}>
                {deletingId === r.id ? "Deleting..." : "Delete"}
              </button>
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
            </>
          )}
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  // Phones: "8 Nov" (year only when it isn't this year), as on the invoice list.
  const shortDate = (d: string) => {
    const x = new Date(`${d.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(x.getTime())) return d;
    return x.toLocaleDateString("en-PK", { day: "numeric", month: "short", ...(x.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
  };

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
          onRowClick={(r) => setOpened({ id: r.id, viewOnly: true })}
          mobile={(r) => ({
            title: <>#{r.quotation_no ?? "—"} <span className="font-normal text-neutral-600">· {r.customer_name}</span></>,
            meta: (
              <>
                <span>{shortDate(r.date)}</span>
                {r.salesman_name && <span className="min-w-0 truncate">{r.salesman_name}</span>}
                {r.converted_invoice_id ? (
                  <span className="rounded-full bg-emerald-100 px-1.5 text-[11px] font-medium text-emerald-800">Invoice #{r.converted_invoice_no ?? "—"}</span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800">Pending</span>
                )}
              </>
            ),
            value: `Rs ${r.payable.toFixed(2)}`,
            sub: "Est.",
            actions: [
              { label: "View", onClick: () => setOpened({ id: r.id, viewOnly: true }) },
              ...(!r.converted_invoice_id ? [
                { label: "Edit", onClick: () => setOpened({ id: r.id, viewOnly: false }) },
                { label: acceptingId === r.id ? "Accepting..." : "Accept → Generate Invoice", onClick: () => void handleAccept(r), disabled: acceptingId === r.id },
                { label: deletingId === r.id ? "Deleting..." : "Delete", onClick: () => void handleDelete(r), danger: true, disabled: deletingId === r.id },
              ] : []),
            ],
          })}
          emptyMessage="No content in table \u2014 use Add to create a quotation. Quotations don't count toward sales/invoices until accepted."
        />
      )}

      {opened && (
        <QuotationFormModal
          key={`${opened.id}-${opened.viewOnly}`}
          quotationId={opened.id}
          viewOnly={opened.viewOnly}
          onClose={() => setOpened(null)}
          onSaved={() => {
            setOpened(null);
            void reload();
          }}
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
