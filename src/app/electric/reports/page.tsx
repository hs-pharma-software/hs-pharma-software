"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { pick, useT } from "@/lib/i18n";
import { electric } from "@/lib/electric";
import { Err, EsGuard, Id, PageTitle, Txt, money, monthStart, todayYmd, useLoad } from "@/components/electric/ui";

type Dim = "day" | "product" | "category" | "payment";

export default function ReportsPage() {
  return (
    <EsGuard>
      <Reports />
    </EsGuard>
  );
}

function Reports() {
  const t = useT();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayYmd);
  const [dim, setDim] = useState<Dim>("day");
  const summary = useLoad(() => electric.summary(from, to), [from, to]);
  const rows = useLoad(() => electric.salesBy(dim, from, to), [dim, from, to]);
  const s = summary.data;
  const dims: { id: Dim; label: string }[] = [
    { id: "day", label: t("r.byDay") },
    { id: "product", label: t("r.byProduct") },
    { id: "category", label: t("d.byCategory") },
    { id: "payment", label: t("d.payments") },
  ];
  const label = (r: { label: string; label_ur?: string | null }) => (dim === "payment" ? t(`pay.${r.label}`) : pick(t.lang, r.label, r.label_ur ?? null));
  return (
    <div className="space-y-4">
      <PageTitle
        title={t("r.title")}
        actions={
          <Button onClick={() => window.print()}>
            <Printer size={14} /> {t("c.print")}
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <Field label={t("c.from")}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t("c.to")}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <Err error={summary.error ?? rows.error} />
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label={t("r.sales")} value={money(s.sales)} hint={`${s.salesCount}`} />
          <Card label={t("r.returns")} value={money(s.returns)} hint={`${s.returnCount}`} />
          <Card label={t("r.purchases")} value={money(s.purchases)} hint={`${s.purchaseCount}`} />
          <Card label={t("r.tax")} value={money(s.tax)} />
          <Card label={t("r.revenue")} value={money(s.revenueExTax)} />
          <Card label={t("r.cogs")} value={money(s.cogs)} />
          <Card label={t("d.grossProfit")} value={money(s.grossProfit)} hint={t("d.profitHint")} />
          <Card label={t("s.discount")} value={money(s.discounts)} />
        </div>
      )}
      <div className="flex flex-wrap gap-1 print:hidden">
        {dims.map((d) => (
          <button key={d.id} type="button" onClick={() => setDim(d.id)} className={`rounded-full px-4 py-1.5 text-sm ${dim === d.id ? "bg-neutral-900 text-white" : "bg-white ring-1 ring-black/10"}`}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{dims.find((d) => d.id === dim)?.label}</th>
              <th className="px-3 py-2 text-end">{dim === "day" || dim === "payment" ? "#" : t("c.qty")}</th>
              <th className="px-3 py-2 text-end">{t("c.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r, i) => (
              <tr key={i} className="border-t border-neutral-100">
                <td className="px-3 py-2">{dim === "day" ? <Id>{r.label}</Id> : <Txt>{label(r)}</Txt>}</td>
                <td className="px-3 py-2 text-end"><Id>{Math.round(r.qty * 1000) / 1000}</Id></td>
                <td className="px-3 py-2 text-end">{money(r.amount)}</td>
              </tr>
            ))}
            {!rows.data?.length && <tr><td colSpan={3} className="py-8 text-center text-neutral-400">{rows.loading ? t("c.loading") : t("d.noData")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold" dir="ltr">{value}</p>
      {hint && <p className="text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}
