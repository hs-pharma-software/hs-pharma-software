"use client";

import { useEffect, useState } from "react";
import { Eye, FileCheck2, Pencil, Printer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { InvoiceViewModal } from "@/components/invoices/InvoiceViewModal";
import {
  listInvoicesForGrid, invoicesRepo, convertMemorizedInvoice, deleteMemorizedInvoice, type InvoiceListRow,
} from "@/lib/repo/invoices";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useFormTabs } from "@/store/formTabsStore";
import { useCan } from "@/lib/actionPermissions";
import { localDate } from "@/lib/localDate";
import type { Invoice } from "@/lib/types2";

type ViewRow = { invoice: Invoice; customerName: string; salesmanName: string | null };

/** Memorized (draft) invoices: saved without taking stock. View and print for
 * everyone; edit, delete and convert to a real invoice for the owner, and for
 * staff the owner allowed (User Logins > Permissions > Memorized Invoices). */
export default function MemorizedInvoicesPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [viewing, setViewing] = useState<ViewRow | null>(null);
  const [printing, setPrinting] = useState<ViewRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const openEditTab = useFormTabs((s) => s.openEditInvoice);
  const savedTick = useFormTabs((s) => s.savedTick.invoice);
  // The owner always; a staff login when the owner ticked it on User Logins > Permissions.
  const canEdit = useCan("memorized.edit");
  const canDelete = useCan("memorized.delete");
  const canConvert = useCan("memorized.convert");

  async function reload() {
    if (!isTauri()) return;
    setRows(await listInvoicesForGrid({ isMemorized: true }));
  }

  useEffect(() => {
    void reload();
  }, [savedTick]);

  async function load(r: InvoiceListRow): Promise<ViewRow | null> {
    const full = await invoicesRepo.get(r.id);
    return full ? { invoice: full, customerName: r.customer_name, salesmanName: r.salesman_name } : null;
  }

  async function run(r: InvoiceListRow, fn: () => Promise<unknown>) {
    setBusyId(r.id);
    try {
      await fn();
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function convert(r: InvoiceListRow) {
    if (!window.confirm(`Convert draft #${r.invoice_no ?? ""} (${r.customer_name}, Rs ${r.total.toFixed(2)}) to an invoice dated today? Its items are taken from stock now.`)) return;
    void run(r, () => convertMemorizedInvoice(r.id, localDate()));
  }

  function remove(r: InvoiceListRow) {
    const reason = window.prompt(`Delete draft #${r.invoice_no ?? ""} (${r.customer_name})? It took no stock, so none is put back. Reason:`);
    if (reason === null) return;
    void run(r, () => deleteMemorizedInvoice(r.id, reason || undefined));
  }

  const icon = "rounded p-1 hover:bg-neutral-100 disabled:opacity-40";
  const columns: Column<InvoiceListRow>[] = [
    { header: "Draft No", render: (r) => <span className="tabular-nums text-neutral-500">{r.invoice_no ?? "—"}</span> },
    { header: "Date", render: (r) => r.date },
    { header: "Customer", render: (r) => r.customer_name },
    { header: "Total Bill", render: (r) => <span className="tabular-nums">{r.total.toFixed(2)}</span> },
    {
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1.5 text-neutral-500" onClick={(e) => e.stopPropagation()}>
          <button type="button" title="View" className={`${icon} hover:text-amber-700`} onClick={() => void load(r).then((v) => v && setViewing(v))}>
            <Eye size={16} />
          </button>
          <button type="button" title="Print" disabled={!!printing} className={`${icon} hover:text-amber-700`} onClick={() => void load(r).then((v) => v && setPrinting(v))}>
            <Printer size={16} />
          </button>
          {canEdit && (
            <button type="button" title="Edit" className={`${icon} hover:text-amber-700`} onClick={() => void invoicesRepo.get(r.id).then((full) => full && openEditTab(full))}>
              <Pencil size={16} />
            </button>
          )}
          {canDelete && (
            <button type="button" title="Delete" disabled={busyId === r.id} className={`${icon} hover:text-rose-600`} onClick={() => remove(r)}>
              <Trash2 size={16} />
            </button>
          )}
          {canConvert && (
            <Button variant="secondary" disabled={busyId === r.id} onClick={() => convert(r)} className="ml-1">
              <FileCheck2 size={14} />{busyId === r.id ? "Converting…" : "Convert to Invoice"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Memorized Invoices" actions={<Button onClick={() => void reload()}>Refresh</Button>} />
      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={(r) => void load(r).then((v) => v && setViewing(v))}
          emptyMessage="No memorized invoices. On Create Invoice, press Draft (Ctrl+D) to save a bill here without taking stock."
        />
      )}
      {viewing && <InvoiceViewModal row={viewing} onClose={() => setViewing(null)} />}
      {printing && <InvoiceViewModal key={printing.invoice.id} row={printing} autoPrint onClose={() => setPrinting(null)} />}
    </div>
  );
}
