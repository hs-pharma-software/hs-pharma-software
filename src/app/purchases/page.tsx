"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PurchaseFormModal } from "@/components/purchases/PurchaseFormModal";
import { listPurchasesForGrid, type PurchaseListRow } from "@/lib/repo/purchases";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAppStore } from "@/store/appStore";

export default function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseListRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

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
    { header: "P.ID", render: (r) => r.purchase_no ?? "—" },
    { header: "Date", render: (r) => r.date },
    { header: "Supplier", render: (r) => r.supplier_name },
    { header: "Invoice #", render: (r) => r.supplier_invoice_no ?? "—" },
    { header: "Discount", render: (r) => r.discount_rs.toFixed(2) },
    { header: "Tax", render: (r) => r.tax.toFixed(2) },
    { header: "Paid Amount", render: (r) => r.paid_amount.toFixed(2) },
    { header: "Balance", render: (r) => r.balance.toFixed(2) },
    { header: "Payment Method", render: (r) => r.payment_method ?? "—" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Purchase Details"
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
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
