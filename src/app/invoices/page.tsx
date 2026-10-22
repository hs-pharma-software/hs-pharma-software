"use client";

import { useEffect, useState } from "react";
import { Eye, Pencil, Trash2, Printer, Send, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useFormTabs } from "@/store/formTabsStore";
import { InvoiceViewModal } from "@/components/invoices/InvoiceViewModal";
import {
  listInvoicesForGrid,
  invoicesRepo,
  deleteInvoiceWithStockRestore,
  type InvoiceListRow,
} from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAppStore } from "@/store/appStore";
import { loadFbrSettings, type FbrSettings } from "@/lib/fbr";
import { submitInvoiceToFbrById } from "@/lib/fbrSubmit";
import { can, useCan, NO_PERMISSION_MESSAGE } from "@/lib/actionPermissions";
import type { Invoice } from "@/lib/types2";

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const openNewTab = useFormTabs((s) => s.openNew);
  const openEditTab = useFormTabs((s) => s.openEditInvoice);
  const savedTick = useFormTabs((s) => s.savedTick.invoice);
  const [viewing, setViewing] = useState<{ invoice: Invoice; customerName: string; salesmanName: string | null } | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [fbrSettings, setFbrSettings] = useState<FbrSettings | null>(null);
  // Per-row error tooltip state
  const [fbrErrors, setFbrErrors] = useState<Record<string, string>>({});

  const pendingAction = useAppStore((s) => s.pendingAction);
  const setPendingAction = useAppStore((s) => s.setPendingAction);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listInvoicesForGrid());
  }

  useEffect(() => {
    void reload();
    if (isTauri()) {
      void loadFbrSettings().then((s) => { if (s.enabled) setFbrSettings(s); });
    }
  }, []);

  useEffect(() => {
    if (pendingAction === "new-invoice") {
      openNewTab("invoice");
      setPendingAction(null);
    }
  }, [pendingAction, setPendingAction, openNewTab]);

  // An invoice tab saved: refresh the list.
  useEffect(() => {
    if (savedTick > 0) void reload();
  }, [savedTick]);

  const canEdit = useCan("invoice.edit");
  const canDelete = useCan("invoice.delete");
  const canFbr = useCan("invoice.fbr_submit");

  async function openEdit(row: InvoiceListRow) {
    if (!can("invoice.edit")) return window.alert(NO_PERMISSION_MESSAGE);
    const full = await invoicesRepo.get(row.id);
    if (!full) return;
    openEditTab(full);
  }

  async function openView(row: InvoiceListRow) {
    const full = await invoicesRepo.get(row.id);
    if (!full) return;
    setViewing({ invoice: full, customerName: row.customer_name, salesmanName: row.salesman_name });
  }

  async function handleDelete(row: InvoiceListRow) {
    if (!can("invoice.delete")) return window.alert(NO_PERMISSION_MESSAGE);
    const reason = window.prompt(`Delete invoice #${row.invoice_no ?? ""}? This restores its stock. Reason:`);
    if (reason === null) return;
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
    setTimeout(() => window.print(), 150);
  }

  async function handleFbrSubmit(row: InvoiceListRow) {
    if (!fbrSettings || submittingIds.has(row.id)) return;
    if (!can("invoice.fbr_submit")) return window.alert(NO_PERMISSION_MESSAGE);

    setSubmittingIds((prev) => new Set(prev).add(row.id));
    setFbrErrors((prev) => { const n = { ...prev }; delete n[row.id]; return n; });

    const result = await submitInvoiceToFbrById(row.id, fbrSettings);

    setSubmittingIds((prev) => { const n = new Set(prev); n.delete(row.id); return n; });

    if (result.success && result.fbrInvoiceNo) {
      setRows((prev) =>
        prev.map((r) => r.id === row.id ? { ...r, fbr_invoice_no: result.fbrInvoiceNo } : r)
      );
    } else {
      setFbrErrors((prev) => ({ ...prev, [row.id]: result.error ?? "FBR submission failed" }));
    }
  }

  const columns: Column<InvoiceListRow>[] = [
    { header: "Bill #", render: (r) => r.invoice_no ?? "—" },
    { header: "Date", render: (r) => r.date },
    { header: "Salesman", render: (r) => r.salesman_name ?? "—" },
    { header: "Customer", render: (r) => r.customer_name },
    { header: "Total Bill", render: (r) => r.total.toFixed(2) },
    { header: "Paid", render: (r) => r.paid.toFixed(2) },
    { header: "Balance", render: (r) => r.balance.toFixed(2) },
    ...(fbrSettings ? [{
      header: "FBR",
      render: (r: InvoiceListRow) => (
        <FbrCell
          row={r}
          submitting={submittingIds.has(r.id)}
          error={fbrErrors[r.id] ?? null}
          onSubmit={() => void handleFbrSubmit(r)}
          canSubmit={canFbr}
        />
      ),
    }] : []),
    {
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-2.5 text-neutral-500">
          <button
            type="button"
            title="View"
            onClick={(e) => { e.stopPropagation(); void openView(r); }}
            className="hover:text-amber-700"
          >
            <Eye size={16} />
          </button>
          {canEdit && (
            <button
              type="button"
              title="Edit"
              onClick={(e) => { e.stopPropagation(); void openEdit(r); }}
              className="hover:text-amber-700"
            >
              <Pencil size={16} />
            </button>
          )}
          <button
            type="button"
            title="Print"
            onClick={(e) => { e.stopPropagation(); void printInvoice(r); }}
            className="hover:text-amber-700"
          >
            <Printer size={16} />
          </button>
          {canDelete && (
            <button
              type="button"
              title="Delete"
              disabled={deletingId === r.id}
              onClick={(e) => { e.stopPropagation(); void handleDelete(r); }}
              className="hover:text-rose-600 disabled:opacity-40"
            >
              <Trash2 size={16} />
            </button>
          )}
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
              onClick={() => openNewTab("invoice")}
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


      {viewing && (
        <InvoiceViewModal
          row={viewing}
          onClose={() => {
            setViewing(null);
            void reload(); // refresh in case FBR was submitted from view modal
          }}
        />
      )}
    </div>
  );
}

// ── FBR status cell ────────────────────────────────────────────────────────
function FbrCell({
  row,
  submitting,
  error,
  onSubmit,
  canSubmit,
}: {
  row: InvoiceListRow;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  canSubmit: boolean;
}) {
  // Fixed position so the table's overflow container can't clip the popup.
  const [errorAt, setErrorAt] = useState<{ top: number; left: number } | null>(null);
  const showError = errorAt !== null;
  const valid = !!row.fbr_invoice_no;

  function toggleError(e: React.MouseEvent<HTMLButtonElement>) {
    if (!error) return;
    if (errorAt) return setErrorAt(null);
    const r = e.currentTarget.getBoundingClientRect();
    const width = 320;
    setErrorAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  }

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {/* Validation circle */}
      <div className="relative">
        <button
          type="button"
          title={valid ? `FBR: ${row.fbr_invoice_no}` : error ? "Click to see error" : "Not submitted to FBR"}
          onClick={toggleError}
          className="flex items-center"
        >
          {submitting ? (
            <svg className="h-4 w-4 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
            </svg>
          ) : valid ? (
            <CheckCircle2 size={16} className="text-emerald-500" />
          ) : error ? (
            <XCircle size={16} className="text-rose-500" />
          ) : (
            <XCircle size={16} className="text-neutral-300" />
          )}
        </button>

        {/* Error tooltip */}
        {showError && error && (
          <div
            style={{ top: errorAt.top, left: errorAt.left }}
            className="fixed z-50 w-80 max-w-[calc(100vw-16px)] whitespace-normal break-words rounded-lg bg-rose-50 p-3 text-left text-xs text-rose-700 shadow-lg ring-1 ring-rose-200"
          >
            <p className="font-semibold">FBR Error</p>
            <p className="mt-1 max-h-60 overflow-y-auto whitespace-pre-line leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={() => setErrorAt(null)}
              className="mt-1.5 text-rose-400 underline hover:text-rose-600"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Submit button — only when not yet submitted */}
      {!valid && canSubmit && (
        <button
          type="button"
          title="Submit to FBR"
          disabled={submitting}
          onClick={onSubmit}
          className="flex h-6 w-6 items-center justify-center rounded-md bg-[#006633]/10 text-[#006633] transition hover:bg-[#006633]/20 disabled:opacity-40"
        >
          <Send size={12} />
        </button>
      )}
    </div>
  );
}
