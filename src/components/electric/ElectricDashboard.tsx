"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Boxes, FileText, PackagePlus, ReceiptText, ShieldCheck, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { pick, useT } from "@/lib/i18n";
import { electric } from "@/lib/electric";
import { DocModal, Err, EsGuard, Id, Txt, money, todayYmd, useLoad } from "./ui";

export function ElectricDashboard({ name }: { name: string }) {
  return (
    <EsGuard>
      <Dashboard name={name} />
    </EsGuard>
  );
}

function Dashboard({ name }: { name: string }) {
  const t = useT();
  const d = useLoad(() => electric.dashboard(todayYmd()), []);
  const [open, setOpen] = useState<string | null>(null);
  const x = d.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("d.title")}</h1>
          <p className="text-sm text-neutral-500"><Txt>{name}</Txt></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/electric/sales/new"><Button variant="primary"><ShoppingCart size={14} /> {t("s.newSale")}</Button></Link>
          <Link href="/electric/quotations/new"><Button><FileText size={14} /> {t("s.newQuotation")}</Button></Link>
          <Link href="/electric/purchases/new"><Button><PackagePlus size={14} /> {t("pu.new")}</Button></Link>
        </div>
      </div>
      <Err error={d.error} />
      {!x ? (
        <p className="text-sm text-neutral-400">{t("c.loading")}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<ReceiptText size={18} />} tone="bg-amber-500" label={t("d.todaySales")} value={money(x.today.sales)} hint={`${x.today.salesCount}`} />
            <Kpi icon={<TrendingUp size={18} />} tone="bg-emerald-500" label={t("d.monthSales")} value={money(x.month.sales)} hint={`${x.month.salesCount}`} />
            <Kpi icon={<TrendingUp size={18} />} tone="bg-teal-600" label={t("d.grossProfit")} value={money(x.month.grossProfit)} hint={t("d.profitHint")} />
            <Kpi icon={<PackagePlus size={18} />} tone="bg-sky-500" label={t("d.purchases")} value={money(x.month.purchases)} hint={`${x.month.purchaseCount}`} />
            <Kpi icon={<Wallet size={18} />} tone="bg-rose-500" label={t("d.receivable")} value={money(x.receivable)} />
            <Kpi icon={<Wallet size={18} />} tone="bg-violet-500" label={t("d.payable")} value={money(x.payable)} />
            <Kpi icon={<Boxes size={18} />} tone="bg-neutral-700" label={t("d.inventoryValue")} value={money(x.inventoryValue)} />
            <Kpi icon={<ShieldCheck size={18} />} tone="bg-orange-500" label={t("d.serialsSold")} value={String(x.serialsSold)} hint={`${t("d.returns")}: ${money(x.month.returns)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={t("d.bestSellers")}>
              <Rows rows={x.bestSellers.map((r) => ({ k: r.label, label: pick(t.lang, r.label, r.label_ur), right: money(r.amount), sub: `${Math.round(r.qty * 1000) / 1000}` }))} empty={t("d.noData")} />
            </Panel>
            <Panel title={t("d.byCategory")}>
              <Bars rows={x.byCategory.map((r) => ({ label: pick(t.lang, r.label, r.label_ur), value: r.amount }))} empty={t("d.noData")} />
            </Panel>
            <Panel title={t("d.payments")}>
              <Bars rows={x.payments.map((r) => ({ label: t(`pay.${r.label}`), value: r.amount }))} empty={t("d.noData")} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title={`${t("d.lowStock")} / ${t("d.outOfStock")}`} icon={<AlertTriangle size={14} className="text-amber-600" />}>
              <Rows
                rows={[...x.outOfStock, ...x.lowStock].slice(0, 12).map((p) => ({ k: p.id, label: pick(t.lang, p.name, p.name_ur), right: `${p.stock} ${p.unit}`, tone: p.stock <= 0 ? "text-rose-600" : "text-amber-600" }))}
                empty={t("d.noData")}
              />
            </Panel>
            <Panel title={t("d.warrantyExpiring")}>
              <Rows rows={x.warrantyExpiring.map((s) => ({ k: s.id, label: s.product_name, sub: s.serial, right: s.warranty_end ?? "" }))} empty={t("d.noData")} />
            </Panel>
            <Panel title={t("d.claims")}>
              <Rows rows={x.claims.map((c) => ({ k: c.status, label: t(`cl.${c.status}`), right: String(c.n) }))} empty={t("d.noData")} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t("d.recentSales")}>
              <Rows rows={x.recentSales.map((s) => ({ k: s.id, label: `#${s.doc_no} — ${s.party_name ?? t("c.walkIn")}`, sub: s.date, right: money(s.total), onClick: () => setOpen(s.id) }))} empty={t("d.noData")} />
            </Panel>
            <Panel title={t("d.recentPurchases")}>
              <Rows rows={x.recentPurchases.map((s) => ({ k: s.id, label: `#${s.doc_no} — ${s.party_name ?? ""}`, sub: s.date, right: money(s.total), onClick: () => setOpen(s.id) }))} empty={t("d.noData")} />
            </Panel>
          </div>
        </>
      )}
      {open && <DocModal docId={open} onClose={() => setOpen(null)} onChanged={() => void d.reload()} />}
    </div>
  );
}

function Kpi({ icon, tone, label, value, hint }: { icon: React.ReactNode; tone: string; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white p-4 ring-1 ring-black/5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-neutral-500">{label}</p>
        <p className="text-lg font-bold" dir="ltr">{value}</p>
        {hint && <p className="truncate text-[11px] text-neutral-400">{hint}</p>}
      </div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Rows({ rows, empty }: { rows: { k: string; label: string; sub?: string; right: string; tone?: string; onClick?: () => void }[]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-center text-xs text-neutral-400">{empty}</p>;
  return (
    <ul className="divide-y divide-neutral-100 text-sm">
      {rows.map((r) => (
        <li key={r.k}>
          <button type="button" disabled={!r.onClick} onClick={r.onClick} className="flex w-full items-center justify-between gap-2 py-1.5 text-start enabled:hover:bg-amber-50/50">
            <span className="min-w-0">
              <span className="block truncate"><Txt>{r.label}</Txt></span>
              {r.sub && <span className="text-[11px] text-neutral-400"><Id>{r.sub}</Id></span>}
            </span>
            <span className={`shrink-0 font-medium ${r.tone ?? ""}`} dir="ltr">{r.right}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Bars({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  if (!rows.length) return <p className="py-4 text-center text-xs text-neutral-400">{empty}</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <ul className="space-y-2 text-sm">
      {rows.slice(0, 8).map((r, i) => (
        <li key={i}>
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate"><Txt>{r.label}</Txt></span>
            <span dir="ltr">{money(r.value)}</span>
          </div>
          <div className="mt-0.5 h-2 rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-amber-500" style={{ width: `${(Math.max(0, r.value) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
