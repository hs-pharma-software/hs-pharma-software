"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useFormTabs } from "@/store/formTabsStore";
import { Modal } from "@/components/ui/Modal";
import { deleteDraft, listPurchaseDrafts, type PurchaseDraft } from "@/lib/repo/purchaseDrafts";
import { Pencil, Trash2 } from "lucide-react";
import {
  listPurchasesForGrid,
  purchasesRepo,
  deletePurchaseWithStockReversal,
  type PurchaseListRow,
} from "@/lib/repo/purchases";
import { can, useCan, NO_PERMISSION_MESSAGE } from "@/lib/actionPermissions";
import type { Purchase } from "@/lib/types2";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAppStore } from "@/store/appStore";

export default function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseListRow[]>([]);
  const openNewTab = useFormTabs((s) => s.openNew);
  const openEditTab = useFormTabs((s) => s.openEditPurchase);
  const savedTick = useFormTabs((s) => s.savedTick.purchase);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // A purchase tab saved: refresh the list.
  useEffect(() => {
    if (savedTick > 0) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTick]);
  const canEdit = useCan("purchase.edit");
  const canDelete = useCan("purchase.delete");

  async function openEdit(row: PurchaseListRow) {
    if (!can("purchase.edit")) return window.alert(NO_PERMISSION_MESSAGE);
    const full = await purchasesRepo.get(row.id);
    if (!full) return;
    openEditTab(full);
  }

  async function handleDelete(row: PurchaseListRow) {
    if (!can("purchase.delete")) return window.alert(NO_PERMISSION_MESSAGE);
    const reason = window.prompt(
      `Delete purchase #${row.purchase_no ?? ""}? Its received stock will be taken back out. Reason:`
    );
    if (reason === null) return;
    setDeletingId(row.id);
    try {
      await deletePurchaseWithStockReversal(row.id, reason || undefined);
      void reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  const pendingAction = useAppStore((s) => s.pendingAction);
  const setPendingAction = useAppStore((s) => s.setPendingAction);

  const openDraftTab = useFormTabs((s) => s.openPurchaseDraft);
  const [drafts, setDrafts] = useState<PurchaseDraft[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    const [list, draftRows] = await Promise.all([listPurchasesForGrid(false), listPurchaseDrafts()]);
    setRows(list);
    setDrafts(draftRows);
  }

  // Drafts are auto-saved while a purchase tab is open; refresh the count
  // whenever the drafts list is opened.
  useEffect(() => {
    if (draftsOpen && isTauri()) void listPurchaseDrafts().then(setDrafts);
  }, [draftsOpen]);

  useEffect(() => {
    void reload();
  }, []);

  // ALT+U -> New Purchase (see GlobalShortcuts.tsx).
  useEffect(() => {
    if (pendingAction === "new-purchase") {
      openNewTab("purchase");
      setPendingAction(null);
    }
  }, [pendingAction, setPendingAction]);

  const columns: Column<PurchaseListRow>[] = [
    { header: "P.ID", render: (r) => r.purchase_no ?? "\u2014" },
    { header: "Date", render: (r) => r.date },
    { header: "Supplier", render: (r) => r.supplier_name },
    { header: "Invoice #", render: (r) => r.supplier_invoice_no ?? "\u2014" },
    { header: "Discount", render: (r) => r.discount_rs.toFixed(2) },
    { header: "Tax", render: (r) => r.tax.toFixed(2) },
    { header: "Paid Amount", render: (r) => r.paid_amount.toFixed(2) },
    { header: "Balance", render: (r) => r.balance.toFixed(2) },
    { header: "Payment Method", render: (r) => r.payment_method ?? "\u2014" },
    ...(canEdit || canDelete
      ? [
          {
            header: "Actions",
            render: (r: PurchaseListRow) => (
              <div className="flex items-center gap-2.5 text-neutral-500">
                {canEdit && (
                  <button type="button" title="Edit" onClick={(e) => { e.stopPropagation(); void openEdit(r); }} className="hover:text-amber-700">
                    <Pencil size={16} />
                  </button>
                )}
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
        ]
      : []),
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Purchase Details"
        actions={
          <>
            <Button variant="primary" onClick={() => openNewTab("purchase")} title="Alt+U">
              Add
            </Button>
            <Button onClick={() => setDraftsOpen(true)}>Drafts{drafts.length > 0 ? ` (${drafts.length})` : ""}</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to manage purchases.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}

      {draftsOpen && (
        <Modal title="Purchase Drafts" onClose={() => setDraftsOpen(false)} width="max-w-2xl">
          {drafts.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">No drafts.</p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {drafts.map((d) => (
                <div key={d.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-800">{d.title || "Untitled draft"}</p>
                    <p className="text-[11px] text-neutral-400">
                      {d.is_auto ? "Auto-saved" : "Saved as draft"} {new Date(d.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setDraftsOpen(false);
                      openDraftTab(d.id);
                    }}
                  >
                    Resume
                  </Button>
                  <button
                    type="button"
                    title="Delete draft"
                    onClick={async () => {
                      if (!window.confirm("Delete this draft?")) return;
                      await deleteDraft(d.id);
                      setDrafts(await listPurchaseDrafts());
                    }}
                    className="rounded-full p-1.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

    </div>
  );
}
