"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { useAuthStore } from "@/store/authStore";
import { getExpiringSoonBatches, getLowStockProducts, type ExpiringBatchRow, type LowStockRow } from "@/lib/repo/dashboard";
import { deadStock, type DeadStockRow } from "@/lib/repo/stockReports";
import { addDays } from "@/lib/repo/facility";
import { pendingSupply, type PendingSupply } from "@/lib/repo/vendors";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const rs = (n: number) => Math.round(n).toLocaleString("en-PK");

interface Alerts { low: LowStockRow[]; dead: DeadStockRow[]; expiring: ExpiringBatchRow[]; pending: PendingSupply[] }

/** Purchase Cell dashboard: low stock, dead items, expiry alerts and suppliers' pending supply; the alerts pop up on the first visit of the day. */
export default function PurchaseCellDashboard() {
  const [a, setA] = useState<Alerts | null>(null);
  const [popup, setPopup] = useState(false);
  const key = `mavin.purchaseCellAlerts.${useAuthStore((s) => s.currentTenant?.id)}.${useAuthStore((s) => s.currentUser?.id)}`;

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      const [low, dead, expiring, pending] = await Promise.all([
        getLowStockProducts(50).catch(() => []), deadStock(addDays(localDate(), -30)).catch(() => []),
        getExpiringSoonBatches(90, 50).catch(() => []), pendingSupply(),
      ]);
      setA({ low, dead, expiring, pending });
      let shown: string | null = null;
      try { shown = window.localStorage.getItem(key); } catch { shown = null; }
      if (shown !== localDate() && (low.length || expiring.length || pending.length)) setPopup(true);
    })();
  }, [key]);

  function closePopup() {
    try { window.localStorage.setItem(key, localDate()); } catch { /* shows again next time */ }
    setPopup(false);
  }

  const today = localDate();
  const expired = a?.expiring.filter((e) => e.expiry_date <= today).length ?? 0;
  return (
    <div>
      <PageHeader title="Purchase Cell" actions={<Button onClick={() => setPopup(true)} disabled={!a}><Bell size={14} className="mr-1" />Alerts</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Low stock", a?.low.length, "text-amber-700"], ["Dead items (30 days)", a?.dead.length, "text-neutral-800"], ["Expiring in 90 days", a?.expiring.length, "text-rose-700"], ["Orders not supplied", a?.pending.reduce((x, p) => x + p.orders, 0), "text-sky-700"]].map(([l, n, c]) => (
          <div key={String(l)} className={card}><p className="text-xs text-neutral-500">{l}</p><p className={`text-2xl font-bold ${c}`}>{n ?? "…"}</p></div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Low stock" empty="No product is low.">
          {a?.low.map((r) => <Row key={r.id} left={r.name} right={`${r.avail_qty} left${r.max_stock_qty ? ` of ${r.max_stock_qty}` : ""}`} tone="text-amber-700" />)}
        </Section>
        <Section title="Expiry alert (90 days)" empty="Nothing expiring soon." extra={expired ? `${expired} already expired` : null}>
          {a?.expiring.map((r) => <Row key={r.id} left={`${r.product_name}${r.batch_no ? ` · ${r.batch_no}` : ""}`} right={`${r.expiry_date} · ${r.qty}`} tone={r.expiry_date <= today ? "text-rose-700 font-semibold" : "text-rose-600"} />)}
        </Section>
        <Section title="Dead items (no use in 30 days)" empty="No dead items." link={{ href: "/reports/dead-stock", label: "Dead Stock report" }}>
          {a?.dead.slice(0, 50).map((r) => <Row key={r.id} left={r.name} right={`${r.qty} · Rs ${rs(r.cost)}`} tone="text-neutral-600" />)}
        </Section>
        <Section title="Suppliers' pending supply" empty="Every order has been supplied." link={{ href: "/orders", label: "Orders" }}>
          {a?.pending.map((p) => <Row key={p.supplier_id ?? "none"} left={p.supplier_name} right={`${p.orders} order${p.orders === 1 ? "" : "s"} · since ${p.oldest}${p.estimated ? ` · Rs ${rs(p.estimated)}` : ""}`} tone="text-sky-700" />)}
        </Section>
      </div>

      {popup && a && (
        <Modal title="Purchase Cell alerts" onClose={closePopup} width="max-w-lg">
          <ul className="flex flex-col gap-2 text-sm">
            {[[a.low.length, "products are low in stock"], [expired, "batches have expired"], [a.expiring.length - expired, "batches expire within 90 days"], [a.pending.reduce((x, p) => x + p.orders, 0), "orders are not supplied yet"], [a.dead.length, "items had no use in 30 days"]]
              .filter(([n]) => Number(n) > 0).map(([n, t]) => (
                <li key={String(t)} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900"><AlertTriangle size={15} /><b>{n}</b> {t}</li>
              ))}
          </ul>
          <div className="mt-4 flex justify-end"><Button variant="primary" onClick={closePopup}>OK</Button></div>
        </Modal>
      )}
    </div>
  );
}

function Section({ title, empty, children, extra, link }: { title: string; empty: string; children: React.ReactNode; extra?: string | null; link?: { href: string; label: string } }) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className={card}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-800">{title}{extra && <span className="ml-2 text-xs font-medium text-rose-700">{extra}</span>}</h2>
        {link && <Link href={link.href} className="text-xs text-sky-700 hover:underline">{link.label}</Link>}
      </div>
      {has ? <div className="max-h-72 overflow-y-auto">{children}</div> : <p className="text-sm text-neutral-400">{empty}</p>}
    </div>
  );
}

function Row({ left, right, tone }: { left: string; right: string; tone: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-neutral-100 py-1.5 text-sm first:border-0">
      <span className="truncate">{left}</span><span className={`shrink-0 tabular-nums text-xs ${tone}`}>{right}</span>
    </div>
  );
}
