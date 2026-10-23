"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable } from "@/components/ui/DataTable";
import { restaurant, pra } from "@/lib/restaurant";
import type { PayMethod } from "@/lib/restaurant/engine";
import { today, type OrderRow } from "@/lib/restaurant/store";
import { tenantsRepo } from "@/lib/repo/tenants";
import { useAuthStore } from "@/store/authStore";
import { useCan } from "@/lib/actionPermissions";
import { Badge, Note, ORDER_TYPE_LABEL, PRA_BADGE, RestGuard, money, useAction, useLoad, usePrinter, type ReceiptData } from "@/components/restaurant/ui";

export default function OrdersPage() {
  return (
    <RestGuard>
      <Orders />
    </RestGuard>
  );
}

const STATUS_CLS: Record<string, string> = {
  open: "bg-sky-100 text-sky-800",
  billed: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-neutral-200 text-neutral-600",
  refunded: "bg-violet-100 text-violet-800",
};

function Orders() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState("");
  const list = useLoad(() => restaurant.listOrders({ from, to, status: status || undefined }), [from, to, status]);
  const [refunding, setRefunding] = useState<OrderRow | null>(null);
  const canRefund = useCan("rest.refund");
  const printer = usePrinter();
  const act = useAction();
  const tenant = useAuthStore((s) => s.currentTenant);
  const [business, setBusiness] = useState<ReceiptData["business"]>({ name: tenant?.name ?? "Restaurant" });
  useEffect(() => {
    if (tenant?.id) void tenantsRepo.get(tenant.id).then((t) => t && setBusiness({ name: t.name, address: t.address, phone: t.phone }));
  }, [tenant?.id]);

  const reprint = async (o: OrderRow & { table_name: string | null }) => {
    const full = await restaurant.getOrder(o.id);
    printer.print({ kind: "receipt", data: { order: full.order, items: full.items, business, tableName: o.table_name, duplicate: true } });
  };

  return (
    <div>
      <PageHeader title="Invoices & Refunds" actions={<Button onClick={() => void list.reload()}>Refresh</Button>} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {Object.keys(STATUS_CLS).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
      {(list.error || act.error) && <div className="mb-3"><Note tone="rose">{list.error ?? act.error}</Note></div>}
      <DataTable
        rows={list.data ?? []}
        columns={[
          { header: "Invoice", render: (o) => (o.invoice_no ? <span className="font-medium">#{o.invoice_no}{o.refund_of ? " (credit)" : ""}</span> : "-") },
          { header: "Order", render: (o) => `#${o.order_no}` },
          { header: "Time", render: (o) => new Date(o.invoiced_at ?? o.opened_at ?? o.created_at).toLocaleString("en-PK", { dateStyle: "short", timeStyle: "short" }) },
          { header: "Type", render: (o) => `${ORDER_TYPE_LABEL[o.order_type]}${o.table_name ? ` · ${o.table_name}` : ""}` },
          { header: "Cashier", render: (o) => o.cashier_name ?? "-" },
          { header: "Total", render: (o) => (o.refund_of ? `-${money(o.total)}` : money(o.total)) },
          { header: "Status", render: (o) => <Badge cls={STATUS_CLS[o.status]}>{o.refund_of ? "refund" : o.status}</Badge> },
          { header: "PRA", render: (o) => <Badge cls={PRA_BADGE[o.pra_status]}>{o.pra_invoice_no ?? o.pra_status.replace("_", " ")}</Badge> },
          {
            header: "Actions",
            render: (o) => (
              <div className="flex gap-3 text-xs">
                {o.invoice_no && <button type="button" className="text-amber-700 hover:underline" onClick={() => void reprint(o)}>Reprint</button>}
                {canRefund && o.status === "paid" && !o.refund_of && <button type="button" className="text-rose-600 hover:underline" onClick={() => setRefunding(o)}>Refund</button>}
                {o.cancel_reason && <span className="text-neutral-400" title={o.cancel_reason}>reason</span>}
              </div>
            ),
          },
        ]}
      />
      {refunding && (
        <RefundModal
          order={refunding}
          onClose={() => setRefunding(null)}
          onDone={async (creditId) => {
            setRefunding(null);
            void pra.processQueue().catch(() => undefined);
            const full = await restaurant.getOrder(creditId);
            printer.print({ kind: "receipt", data: { order: full.order, items: full.items, business, tableName: null } });
            void list.reload();
          }}
        />
      )}
      {printer.view}
    </div>
  );
}

function RefundModal({ order, onClose, onDone }: { order: OrderRow; onClose: () => void; onDone: (creditId: string) => void }) {
  const detail = useLoad(() => restaurant.getOrder(order.id), [order.id]);
  const lines = (detail.data?.items ?? []).filter((i) => !i.parent_item_id && i.kitchen_status !== "cancelled");
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const act = useAction();
  const open = lines.filter((l) => !l.refunded);
  const amount = open.filter((l) => chosen.includes(l.id)).reduce((s, l) => s + l.line_total - l.line_discount + l.line_tax, 0);
  return (
    <Modal title={`Refund invoice #${order.invoice_no}`} onClose={onClose} width="max-w-lg">
      <div className="space-y-3">
        <Note>A refund creates a credit note linked to this invoice; the original invoice is kept unchanged.{order.pra_status !== "not_required" ? " With PRA on, a Credit invoice is sent to PRA referencing the original." : ""}</Note>
        <div>
          {lines.map((l) => (
            <label key={l.id} className={`flex items-center gap-2 py-1 text-sm ${l.refunded ? "text-neutral-400 line-through" : ""}`}>
              <input type="checkbox" disabled={!!l.refunded} checked={chosen.includes(l.id)} onChange={() => setChosen((x) => (x.includes(l.id) ? x.filter((y) => y !== l.id) : [...x, l.id]))} />
              <span className="flex-1">{l.qty} x {l.name}</span>
              <span>{money(l.line_total - l.line_discount + l.line_tax)}</span>
            </label>
          ))}
          <button type="button" className="text-xs text-amber-700 hover:underline" onClick={() => setChosen(open.map((l) => l.id))}>Select all</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="Refund by">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank">Bank transfer</option>
              <option value="digital">Digital wallet</option>
            </Select>
          </Field>
        </div>
        <p className="text-sm font-semibold">Refund about {money(amount)} {chosen.length === open.length && open.length === lines.length && order.service_charge > 0 ? "+ service charge" : ""}</p>
        {act.error && <Note tone="rose">{act.error}</Note>}
        <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={act.busy || !chosen.length} onClick={async () => { const c = await act.run(() => restaurant.refund(order.id, { itemIds: chosen, reason, method })); if (c) onDone(c.id); }}>Refund</Button>
        </div>
      </div>
    </Modal>
  );
}
