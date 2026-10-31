"use client";

import { useEffect, useState } from "react";
import { Eye, Pencil, Trash2, Printer, Send, CheckCircle2, XCircle, BadgeCheck } from "lucide-react";
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
import { SurgeryInvoiceModal } from "@/components/hospital/SurgeryInvoiceModal";
import { ClinicVisitInvoiceModal } from "@/components/clinic/ClinicPrints";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Field";
import { markInvoicePaid } from "@/lib/repo/invoicePayments";
import type { PaymentMethod } from "@/lib/types-hospital";

const isSurgery = (r: InvoiceListRow) => r.invoice_type === "hospital_surgery";
const isClinicVisit = (r: InvoiceListRow) => r.invoice_type === "clinic_visit";
/** Billed from services (surgery, clinic visit): opened in their own view, not edited as product invoices. */
const isServiceBill = (r: InvoiceListRow) => isSurgery(r) || isClinicVisit(r);

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const openNewTab = useFormTabs((s) => s.openNew);
  const openNewFromRxTab = useFormTabs((s) => s.openNewFromRx);
  const openEditTab = useFormTabs((s) => s.openEditInvoice);
  const savedTick = useFormTabs((s) => s.savedTick.invoice);
  const [viewing, setViewing] = useState<{ invoice: Invoice; customerName: string; salesmanName: string | null } | null>(
    null
  );
  const [printing, setPrinting] = useState<typeof viewing>(null);
  const [surgeryInvoice, setSurgeryInvoice] = useState<{ id: string; print: boolean } | null>(null);
  const [clinicInvoice, setClinicInvoice] = useState<{ id: string; print: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [payingRow, setPayingRow] = useState<InvoiceListRow | null>(null);
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [fbrSettings, setFbrSettings] = useState<FbrSettings | null>(null);
  // Per-row error tooltip state
  const [fbrErrors, setFbrErrors] = useState<Record<string, string>>({});

  const pendingAction = useAppStore((s) => s.pendingAction);
  const pendingRxId = useAppStore((s) => s.pendingRxId);
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
    } else if (pendingAction === "new-invoice-from-rx" && pendingRxId) {
      openNewFromRxTab(pendingRxId);
      setPendingAction(null);
    }
  }, [pendingAction, pendingRxId, setPendingAction, openNewTab, openNewFromRxTab]);

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
    if (isSurgery(row)) return setSurgeryInvoice({ id: row.id, print: false });
    if (isClinicVisit(row)) return setClinicInvoice({ id: row.id, print: false });
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

  // Straight to the printer with the default template; no view dialog.
  async function printInvoice(row: InvoiceListRow) {
    if (printing) return;
    if (isSurgery(row)) return setSurgeryInvoice({ id: row.id, print: true });
    if (isClinicVisit(row)) return setClinicInvoice({ id: row.id, print: true });
    const full = await invoicesRepo.get(row.id);
    if (!full) return;
    setPrinting({ invoice: full, customerName: row.customer_name, salesmanName: row.salesman_name });
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
    { header: "Customer", render: (r) => isServiceBill(r) ? <span>{r.customer_name} <span className="ml-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">{isSurgery(r) ? "Surgery" : "Clinic visit"}</span></span> : r.customer_name },
    { header: "Total Bill", render: (r) => r.total.toFixed(2) },
    { header: "Paid", render: (r) => r.paid.toFixed(2) },
    { header: "Balance", render: (r) => r.balance.toFixed(2) },
    ...(fbrSettings ? [{
      header: "FBR",
      render: (r: InvoiceListRow) => isServiceBill(r) ? <span className="text-xs text-neutral-400">—</span> : (
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
          {canEdit && !isServiceBill(r) && (
            <button
              type="button"
              title="Edit"
              onClick={(e) => { e.stopPropagation(); void openEdit(r); }}
              className="hover:text-amber-700"
            >
              <Pencil size={16} />
            </button>
          )}
          {canEdit && r.balance > 0.005 && (
            <button
              type="button"
              title={`Mark paid (balance Rs ${r.balance.toFixed(2)})`}
              onClick={(e) => { e.stopPropagation(); setPayingRow(r); }}
              className="hover:text-emerald-700"
            >
              <BadgeCheck size={16} />
            </button>
          )}
          <button
            type="button"
            title="Print"
            disabled={!!printing}
            onClick={(e) => { e.stopPropagation(); void printInvoice(r); }}
            className="hover:text-amber-700 disabled:opacity-40"
          >
            <Printer size={16} />
          </button>
          {canDelete && !isServiceBill(r) && (
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


      {printing && <InvoiceViewModal key={printing.invoice.id} row={printing} autoPrint onClose={() => setPrinting(null)} />}

      {payingRow && <MarkPaidModal row={payingRow} onClose={() => setPayingRow(null)} onPaid={() => { setPayingRow(null); void reload(); }} />}
      {clinicInvoice && (
        <ClinicVisitInvoiceModal key={clinicInvoice.id + String(clinicInvoice.print)} invoiceId={clinicInvoice.id} autoPrint={clinicInvoice.print} onClose={() => setClinicInvoice(null)} />
      )}
      {surgeryInvoice && (
        <SurgeryInvoiceModal key={surgeryInvoice.id + String(surgeryInvoice.print)} invoiceId={surgeryInvoice.id} autoPrint={surgeryInvoice.print} onClose={() => setSurgeryInvoice(null)} />
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

/** Confirms marking an invoice paid in full. A surgery invoice records a
 * payment on the admission, so it asks how the money was received. */
function MarkPaidModal({ row, onClose, onPaid }: { row: InvoiceListRow; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (!can("invoice.edit")) return window.alert(NO_PERMISSION_MESSAGE);
    setBusy(true);
    try {
      await markInvoicePaid(row.id, method);
      onPaid();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Mark invoice #${row.invoice_no ?? ""} paid`} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <b>{row.customer_name}</b> · bill Rs {row.payable.toFixed(2)}, paid Rs {row.paid.toFixed(2)}.
          The balance of <b className="tabular-nums">Rs {row.balance.toFixed(2)}</b> will be recorded as received.
        </p>
        {isSurgery(row) && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Received by</span>
            <Select id="mark-paid-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              <option value="cash">Cash</option><option value="card">Card</option><option value="online">Online transfer</option><option value="bank">Bank deposit</option>
            </Select>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Saving…" : "Mark paid"}</Button>
        </div>
      </div>
    </Modal>
  );
}
