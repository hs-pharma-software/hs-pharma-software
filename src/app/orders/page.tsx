"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { OrderFormModal } from "@/components/orders/OrderFormModal";
import { LowStockPanel } from "@/components/orders/LowStockPanel";
import { PurchaseFormModal } from "@/components/purchases/PurchaseFormModal";
import { listOrdersForGrid, type OrderListRow } from "@/lib/repo/orders";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAppStore } from "@/store/appStore";
import type { Product } from "@/lib/types";

export default function OrdersPage() {
  const [rows, setRows] = useState<OrderListRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [purchasePrefill, setPurchasePrefill] = useState<Product[] | null>(null);
  const [lowStockRefreshKey, setLowStockRefreshKey] = useState(0);

  const pendingAction = useAppStore((s) => s.pendingAction);
  const setPendingAction = useAppStore((s) => s.setPendingAction);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listOrdersForGrid());
  }

  useEffect(() => {
    void reload();
  }, []);

  // ALT+O -> New Order (see GlobalShortcuts.tsx).
  useEffect(() => {
    if (pendingAction === "new-order") {
      setModalOpen(true);
      setPendingAction(null);
    }
  }, [pendingAction, setPendingAction]);

  const columns: Column<OrderListRow>[] = [
    { header: "Order No", render: (r) => r.order_no ?? "—" },
    { header: "Date", render: (r) => r.date },
    { header: "Supplier Name", render: (r) => r.supplier_name },
    { header: "Estimated Price", render: (r) => r.estimated_price.toFixed(2) },
    { header: "Advance Payment", render: (r) => r.advance_payment.toFixed(2) },
    { header: "Payment Method", render: (r) => r.payment_method ?? "—" },
    { header: "Description", render: (r) => r.description ?? "—" },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Order Details"
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
          Run inside the desktop app to manage orders.
        </p>
      ) : (
        <>
          <LowStockPanel
            refreshSignal={lowStockRefreshKey}
            onAddToPurchase={(products) => setPurchasePrefill(products)}
          />
          <DataTable columns={columns} rows={rows} />
        </>
      )}

      {modalOpen && (
        <OrderFormModal
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void reload();
          }}
        />
      )}

      {purchasePrefill && (
        <PurchaseFormModal
          initialProducts={purchasePrefill}
          onClose={() => setPurchasePrefill(null)}
          onSaved={() => {
            setPurchasePrefill(null);
            setLowStockRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
