"use client";

import { useEffect, useRef, useState } from "react";
import { FileInput, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { OrderFormModal } from "@/components/orders/OrderFormModal";
import { LowStockPanel } from "@/components/orders/LowStockPanel";
import { PurchaseFormModal } from "@/components/purchases/PurchaseFormModal";
import {
  listOrdersWithStatus, createStockOutOrders, deleteOrder, orderForPurchase, ordersRepo, AUTO_ORDER_TYPE,
  type OrderGridRow, type OrderForPurchase,
} from "@/lib/repo/orders";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAppStore } from "@/store/appStore";
import { can, NO_PERMISSION_MESSAGE } from "@/lib/actionPermissions";
import { localDate } from "@/lib/localDate";
import type { Product } from "@/lib/types";
import type { OrderRow } from "@/lib/types2";

/** Orders to suppliers. Opening the page raises orders for products that ran
 * out of stock (to the supplier who delivered them last); each order can be
 * edited, converted to a purchase or deleted. */
export default function OrdersPage() {
  const [rows, setRows] = useState<OrderGridRow[]>([]);
  const [editing, setEditing] = useState<OrderRow | "new" | null>(null);
  const [converting, setConverting] = useState<OrderForPurchase | null>(null);
  const [purchasePrefill, setPurchasePrefill] = useState<Product[] | null>(null);
  const [lowStockRefreshKey, setLowStockRefreshKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checkedOnce = useRef(false);

  const pendingAction = useAppStore((s) => s.pendingAction);
  const setPendingAction = useAppStore((s) => s.setPendingAction);

  async function reload() {
    if (!isTauri()) return;
    setRows(await listOrdersWithStatus());
  }

  async function checkStockOuts(quiet: boolean) {
    if (!isTauri()) return;
    setChecking(true);
    try {
      const r = await createStockOutOrders(localDate());
      if (r.products > 0) setNotice(`${r.products} out-of-stock product${r.products === 1 ? "" : "s"} put on order${r.orders ? ` (${r.orders} new order${r.orders === 1 ? "" : "s"})` : ""}.`);
      else if (!quiet) setNotice("No new out-of-stock products: everything sold out is already on an order.");
    } catch (e) {
      setNotice(`Could not check stock: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChecking(false);
      await reload();
    }
  }

  useEffect(() => {
    if (checkedOnce.current) return;
    checkedOnce.current = true;
    void checkStockOuts(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ALT+O -> New Order (see GlobalShortcuts.tsx).
  useEffect(() => {
    if (pendingAction === "new-order") {
      setEditing("new");
      setPendingAction(null);
    }
  }, [pendingAction, setPendingAction]);

  async function edit(r: OrderGridRow) {
    if (r.purchase_id) return window.alert("This order is already converted to a purchase; edit the purchase instead.");
    const o = await ordersRepo.get(r.id);
    if (o) setEditing(o);
  }

  async function convert(r: OrderGridRow) {
    try {
      setConverting(await orderForPurchase(r.id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(r: OrderGridRow) {
    if (!can("purchase.delete")) return window.alert(NO_PERMISSION_MESSAGE);
    const reason = window.prompt(
      `Delete order #${r.order_no ?? ""} (${r.supplier_name})?${r.purchase_id ? " The purchase made from it stays." : ""} Reason:`
    );
    if (reason === null) return;
    try {
      await deleteOrder(r.id, reason || undefined);
      await reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  const icon = "rounded p-1 hover:bg-neutral-100 disabled:opacity-30";
  const columns: Column<OrderGridRow>[] = [
    { header: "Order No", render: (r) => r.order_no ?? "—" },
    { header: "Date", render: (r) => r.date },
    { header: "Supplier Name", render: (r) => <span className="font-medium">{r.supplier_name}</span> },
    {
      header: "Type",
      render: (r) => r.order_type === AUTO_ORDER_TYPE
        ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Auto: stock out</span>
        : <span className="text-xs text-neutral-600">{r.order_type ?? "—"}</span>,
    },
    { header: "Items", render: (r) => r.item_count },
    { header: "Estimated Price", render: (r) => <span className="tabular-nums">{r.estimated_price.toFixed(2)}</span> },
    { header: "Advance Payment", render: (r) => r.advance_payment.toFixed(2) },
    {
      header: "Status",
      render: (r) => r.purchase_id
        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Converted{r.purchase_no ? ` · Purchase #${r.purchase_no}` : ""}</span>
        : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Open</span>,
    },
    { header: "Description", render: (r) => r.description ?? "—" },
    {
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-1 text-neutral-500" onClick={(e) => e.stopPropagation()}>
          <button type="button" title={r.purchase_id ? "Converted: edit the purchase instead" : "Edit"} disabled={Boolean(r.purchase_id)} className={`${icon} hover:text-amber-700`} onClick={() => void edit(r)}>
            <Pencil size={16} />
          </button>
          <button type="button" title={r.purchase_id ? "Already converted" : "Convert to purchase"} disabled={Boolean(r.purchase_id) || r.item_count === 0} className={`${icon} hover:text-emerald-700`} onClick={() => void convert(r)}>
            <FileInput size={16} />
          </button>
          <button type="button" title="Delete" className={`${icon} hover:text-rose-600`} onClick={() => void remove(r)}>
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Order Details"
        actions={
          <>
            <Button variant="primary" onClick={() => setEditing("new")}>Add</Button>
            <Button onClick={() => void checkStockOuts(false)} disabled={checking}><RefreshCw size={14} />{checking ? "Checking…" : "Check stock-outs"}</Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {notice && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-4 py-2.5 text-sm text-sky-900 ring-1 ring-sky-200">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-medium hover:underline">Dismiss</button>
        </div>
      )}

      {!tauriReady ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : (
        <>
          <LowStockPanel refreshSignal={lowStockRefreshKey} onAddToPurchase={(products) => setPurchasePrefill(products)} />
          <DataTable columns={columns} rows={rows} onRowClick={(r) => void edit(r)} emptyMessage="No orders yet. Products that run out of stock are ordered here automatically from the supplier who delivered them last." />
        </>
      )}

      {editing && (
        <OrderFormModal
          order={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void reload(); }}
        />
      )}

      {converting && (
        <PurchaseFormModal
          fromOrder={converting}
          onClose={() => setConverting(null)}
          onSaved={() => { setConverting(null); setLowStockRefreshKey((k) => k + 1); void reload(); }}
        />
      )}

      {purchasePrefill && (
        <PurchaseFormModal
          initialProducts={purchasePrefill}
          onClose={() => setPurchasePrefill(null)}
          onSaved={() => { setPurchasePrefill(null); setLowStockRefreshKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}
