"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { businessType } from "@/config/businessTypes";
import { errorText } from "@/lib/restaurant";
import { praVerifyUrl } from "@/lib/restaurant/praModel";
import { printDirect } from "@/lib/print";
import { DEVELOPER_CREDIT } from "@/lib/printTemplates";
import type { KotRow, OrderItemRow, OrderRow } from "@/lib/restaurant/store";

export const money = (n: number | null | undefined) =>
  `Rs ${(Number(n) || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const ORDER_TYPE_LABEL: Record<string, string> = { dine_in: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" };

export const KITCHEN_BADGE: Record<string, string> = {
  new: "bg-sky-100 text-sky-800",
  sent: "bg-amber-100 text-amber-800",
  preparing: "bg-orange-100 text-orange-800",
  ready: "bg-emerald-100 text-emerald-800",
  served: "bg-neutral-100 text-neutral-600",
  cancelled: "bg-rose-100 text-rose-700 line-through",
};

export const PRA_BADGE: Record<string, string> = {
  not_required: "bg-neutral-100 text-neutral-500",
  pending: "bg-sky-100 text-sky-800",
  queued: "bg-sky-100 text-sky-800",
  submitting: "bg-sky-100 text-sky-800",
  accepted: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-700",
  retry_pending: "bg-amber-100 text-amber-800",
  manual_review: "bg-orange-100 text-orange-800",
  credited: "bg-violet-100 text-violet-800",
};

export function Badge({ cls, children }: { cls?: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls ?? "bg-neutral-100 text-neutral-600"}`}>{children}</span>;
}

/** Restaurant screens only for restaurant tenants inside the desktop app. */
export function RestGuard({ children }: { children: React.ReactNode }) {
  const tauri = useIsTauri();
  const type = useAuthStore((s) => businessType(s.currentTenant?.businessType).id);
  if (!tauri) return <Note tone="amber">Run inside the desktop app to use the restaurant module.</Note>;
  if (type !== "restaurant") return <Note tone="amber">These screens are for Restaurant accounts.</Note>;
  return <>{children}</>;
}

export function Note({ tone = "neutral", children }: { tone?: "neutral" | "amber" | "rose" | "emerald"; children: React.ReactNode }) {
  const cls = {
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-700",
    amber: "border-amber-300 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  }[tone];
  return <div className={`rounded-xl border px-4 py-2.5 text-sm ${cls}`}>{children}</div>;
}

/** Loads data with the restaurant store; `reload` re-runs it. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(loader);
  useEffect(() => {
    ref.current = loader;
  });
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await ref.current());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}

/** Runs an action and reports its error text. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Resolves to the result, `true` for actions that return nothing, or
   * `undefined` when the action failed (error text in `error`). */
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const value = await fn();
      return value === undefined ? (true as T) : value;
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

// ── Printing ──────────────────────────────────────────────────────────

export interface ReceiptData {
  order: OrderRow;
  items: OrderItemRow[];
  business: { name: string; address?: string | null; phone?: string | null };
  tableName: string | null;
  change?: number;
  duplicate?: boolean;
}

export interface KotData {
  kot: KotRow;
  items: OrderItemRow[];
  order: OrderRow;
  tableName: string | null;
  reprint: boolean;
  copy: number;
}

const mods = (i: OrderItemRow): string[] => {
  try {
    return JSON.parse(i.modifiers ?? "[]") as string[];
  } catch {
    return [];
  }
};

const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" }) : "");

export function ReceiptView({ data }: { data: ReceiptData }) {
  const { order, items, business } = data;
  const lines = items.filter((i) => !i.parent_item_id && i.kitchen_status !== "cancelled");
  const comps = (id: string) => items.filter((i) => i.parent_item_id === id);
  const pays = order.payments ? (JSON.parse(order.payments) as { method: string; amount: number }[]) : [];
  const offers = order.offers ? (JSON.parse(order.offers) as { applied?: { code: string; name: string; discountPaisa: number }[]; manualDiscount?: number }) : null;
  const credit = !!order.refund_of;
  const row = (label: string, value: string, bold = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div style={{ width: "74mm", fontFamily: "Arial, sans-serif", fontSize: 11, color: "#000", lineHeight: 1.35 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{business.name}</div>
        {business.address && <div>{business.address}</div>}
        {business.phone && <div>Ph: {business.phone}</div>}
        <div style={{ marginTop: 4, fontWeight: 700, letterSpacing: 1 }}>{credit ? "CREDIT NOTE / REFUND" : "SALES INVOICE"}</div>
        {data.duplicate && <div style={{ fontWeight: 700 }}>*** DUPLICATE ***</div>}
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
      {row(`Invoice #${order.invoice_no ?? "-"}`, fmtTime(order.invoiced_at))}
      {row(ORDER_TYPE_LABEL[order.order_type] + (data.tableName ? ` · ${data.tableName}` : ""), `Order #${order.order_no}`)}
      {order.cashier_name && row("Cashier", order.cashier_name)}
      {order.customer_name && row("Customer", order.customer_name)}
      {credit && order.notes && <div>{order.notes}</div>}
      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
      {lines.map((i) => (
        <div key={i.id} style={{ marginBottom: 2 }}>
          <div style={{ fontWeight: 600 }}>{i.name}</div>
          {mods(i).length > 0 && <div style={{ paddingLeft: 8 }}>+ {mods(i).join(", ")}</div>}
          {comps(i.id).map((c) => (
            <div key={c.id} style={{ paddingLeft: 8 }}>
              - {c.qty} x {c.name}
            </div>
          ))}
          {row(`  ${i.qty} x ${i.unit_price.toFixed(2)}`, i.line_total.toFixed(2))}
        </div>
      ))}
      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
      {row("Total", order.gross.toFixed(2))}
      {(offers?.applied ?? []).map((o) => row(`Offer ${o.code}`, `-${(o.discountPaisa / 100).toFixed(2)}`))}
      {offers?.manualDiscount ? row("Discount", `-${offers.manualDiscount.toFixed(2)}`) : null}
      {!offers && order.discount > 0 && row("Discount", `-${order.discount.toFixed(2)}`)}
      {order.service_charge > 0 && row("Service charge", order.service_charge.toFixed(2))}
      {order.tax > 0 && row(`Sales tax (${order.tax_rate}%)`, order.tax.toFixed(2))}
      {row(credit ? "Refund total" : "Grand total", order.total.toFixed(2), true)}
      {pays.map((p, i) => (
        <div key={i}>{row(`Paid (${p.method})`, Number(p.amount).toFixed(2))}</div>
      ))}
      {!!data.change && data.change > 0 && row("Change", data.change.toFixed(2))}
      {order.pra_invoice_no ? (
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <div style={{ fontWeight: 700 }}>PRA Invoice No</div>
          <div style={{ wordBreak: "break-all" }}>{order.pra_invoice_no}</div>
          <div style={{ display: "inline-block", background: "#fff", padding: 3, marginTop: 3 }}>
            <QRCode value={praVerifyUrl(order.pra_invoice_no)} size={92} />
          </div>
          <div style={{ fontSize: 9 }}>Verify at PRA (reg.pra.punjab.gov.pk) or the PRA app</div>
        </div>
      ) : order.pra_status !== "not_required" ? (
        <div style={{ textAlign: "center", marginTop: 6, fontSize: 10 }}>PRA fiscal number: pending ({order.pra_status.replace("_", " ")})</div>
      ) : null}
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0 2px" }} />
      <div style={{ textAlign: "center", fontSize: 9 }}>Thank you! · {DEVELOPER_CREDIT}</div>
    </div>
  );
}

export function KotView({ data }: { data: KotData }) {
  const { kot, items, order, tableName } = data;
  return (
    <div style={{ width: "74mm", fontFamily: "Arial, sans-serif", fontSize: 12, color: "#000", lineHeight: 1.35 }}>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 15 }}>KITCHEN ORDER #{kot.kot_no}</div>
      {data.reprint && <div style={{ textAlign: "center", fontWeight: 700 }}>*** REPRINT (copy {data.copy}) ***</div>}
      <div style={{ textAlign: "center" }}>{kot.station}</div>
      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
        <span>{tableName ? `Table ${tableName}` : ORDER_TYPE_LABEL[order.order_type]}</span>
        <span>Order #{order.order_no}</span>
      </div>
      <div>{fmtTime(kot.created_at)}</div>
      <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
      {items.map((i) => (
        <div key={i.id} style={{ marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {i.qty} x {i.name}
          </div>
          {mods(i).length > 0 && <div style={{ paddingLeft: 10 }}>+ {mods(i).join(", ")}</div>}
          {i.notes && <div style={{ paddingLeft: 10, fontStyle: "italic" }}>Note: {i.notes}</div>}
          {i.kitchen_status === "cancelled" && <div style={{ paddingLeft: 10, fontWeight: 700 }}>CANCELLED</div>}
        </div>
      ))}
    </div>
  );
}

/** Prints receipts / kitchen tickets one after another on the thermal printer. */
export function usePrinter() {
  const [job, setJob] = useState<{ kind: "receipt"; data: ReceiptData } | { kind: "kot"; data: KotData } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const queue = useRef<NonNullable<typeof job>[]>([]);
  const busy = useRef(false);

  const next = useCallback(() => {
    const j = queue.current.shift();
    if (!j) {
      busy.current = false;
      setJob(null);
      return;
    }
    busy.current = true;
    setJob(j);
  }, []);

  useEffect(() => {
    if (!job) return;
    const handle = requestAnimationFrame(() => {
      void printDirect("thermal", area.current).finally(next);
    });
    return () => cancelAnimationFrame(handle);
  }, [job, next]);

  const print = useCallback(
    (j: NonNullable<typeof job>) => {
      queue.current.push(j);
      if (!busy.current) next();
    },
    [next]
  );

  const view = job ? (
    <div className="pointer-events-none fixed inset-0 -z-10 opacity-0 print:z-auto print:opacity-100">
      <div ref={area} className="print-area bg-white">
        {job.kind === "receipt" ? <ReceiptView data={job.data} /> : <KotView data={job.data} />}
      </div>
    </div>
  ) : null;

  return { print, view };
}
