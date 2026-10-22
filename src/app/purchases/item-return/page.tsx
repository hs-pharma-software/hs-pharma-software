"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PurchaseItemReturnModal } from "@/components/purchases/PurchaseItemReturnModal";
import { listPurchasesForGrid, type PurchaseListRow } from "@/lib/repo/purchases";
import { isTauri, useIsTauri } from "@/lib/platform";

export default function PurchaseItemReturnPage() {
  const [rows, setRows] = useState<PurchaseListRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listPurchasesForGrid(true));
  }

  useEffect(() => {
    void reload();
  }, []);

  const columns: Column<PurchaseListRow>[] = [
    { header: "Return #", render: (r) => r.purchase_no ?? "\u2014" },
    { header: "Against P.ID", render: (r) => r.original_purchase_no ?? "\u2014" },
    { header: "Date", render: (r) => r.date },
    { header: "Supplier", render: (r) => r.supplier_name },
    { header: "Paid Amount", render: (r) => r.paid_amount.toFixed(2) },
    { header: "Balance", render: (r) => r.balance.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Purchase Item Return"
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
          Run inside the desktop app to manage purchase returns.
        </p>
      ) : (
        <DataTable columns={columns} rows={rows} />
      )}

      {modalOpen && (
        <PurchaseItemReturnModal
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
