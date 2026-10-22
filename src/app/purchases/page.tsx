"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PurchaseFormModal } from "@/components/purchases/PurchaseFormModal";
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
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const canEdit = useCan("purchase.edit");
  const canDelete = useCan("purchase.delete");

  async function openEdit(row: PurchaseListRow) {
    if (!can("purchase.edit")) return window.alert(NO_PERMISSION_MESSAGE);
    const full = await purchasesRepo.get(row.id);
    if (!full) return;
    setEditing(full);
    setModalOpen(true);
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

  async function reload() {
    if (!isTauri()) return;
    setRows(await listPurchasesForGrid(false));
  }

  useEffect(() => {
    void reload();
  }, []);

  // ALT+U -> New Purchase (see GlobalShortcuts.tsx).
  useEffect(() => {
    if (pendingAction === "new-purchase") {
      setModalOpen(true);
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
            <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
              Add
            </Button>
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

      {modalOpen && (
        <PurchaseFormModal
          purchase={editing}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setModalOpen(false);
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
