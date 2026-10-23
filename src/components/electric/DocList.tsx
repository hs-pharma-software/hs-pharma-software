"use client";

import { useState } from "react";
import { Eye, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { useT } from "@/lib/i18n";
import { electric } from "@/lib/electric";
import type { DocType } from "@/lib/electric/store";
import { DocModal, Err, Id, Txt, money, monthStart, todayYmd, useLoad } from "./ui";

/** Searchable list of one document type with the document viewer. */
export function DocList({ type, extra }: { type: DocType; extra?: React.ReactNode }) {
  const t = useT();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayYmd);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => electric.listDocs({ type, from, to, search }), [type, from, to, search]);
  const rows = list.data ?? [];
  const sum = (f: (d: (typeof rows)[number]) => number) => rows.reduce((s, d) => s + f(d), 0);
  const withMoney = type !== "quotation";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("c.from")}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("c.to")}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="min-w-56 flex-1">
          <Field label={t("c.search")}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`${t("s.docNo")} / ${t("c.name")} / ${t("c.phone")}`} />
          </Field>
        </div>
        <Button onClick={() => void list.reload()}>
          <RefreshCw size={14} /> {t("c.refresh")}
        </Button>
        {extra}
      </div>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("s.docNo")}</th>
              <th className="px-3 py-2 text-start">{t("c.date")}</th>
              <th className="px-3 py-2 text-start">{type.startsWith("purchase") ? t("pu.supplier") : t("s.customer")}</th>
              <th className="px-3 py-2 text-end">{t("c.total")}</th>
              {withMoney && <th className="px-3 py-2 text-end">{t("pay.paid")}</th>}
              {withMoney && <th className="px-3 py-2 text-end">{t("pay.balance")}</th>}
              <th className="px-3 py-2 text-start">{t("c.status")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-neutral-100 hover:bg-amber-50/40">
                <td className="px-3 py-2 font-medium">
                  <Id>{d.doc_no}</Id>
                </td>
                <td className="px-3 py-2">
                  <Id>{d.date}</Id>
                </td>
                <td className="px-3 py-2">
                  {d.party_name ? <Txt>{d.party_name}</Txt> : <span className="text-neutral-400">{t("c.walkIn")}</span>}
                  {d.party_phone && (
                    <span className="ms-1 text-[11px] text-neutral-500">
                      <Id>{d.party_phone}</Id>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-end">{money(d.total)}</td>
                {withMoney && <td className="px-3 py-2 text-end">{money(d.paid)}</td>}
                {withMoney && <td className={`px-3 py-2 text-end ${d.balance > 0 ? "font-semibold text-rose-600" : ""}`}>{money(d.balance)}</td>}
                <td className="px-3 py-2 text-xs">
                  {d.status === "converted" ? t("s.converted") : d.fbr_invoice_no ? <span className="text-emerald-700">FBR ✓</span> : ""}
                </td>
                <td className="px-3 py-2 text-end">
                  <Button variant="ghost" onClick={() => setOpen(d.id)}>
                    <Eye size={14} /> {t("c.view")}
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-neutral-400">
                  {list.loading ? t("c.loading") : t("c.empty")}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-neutral-200 bg-neutral-50 text-sm font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
                  {t("c.total")} (<Id>{rows.length}</Id>)
                </td>
                <td className="px-3 py-2 text-end">{money(sum((d) => d.total))}</td>
                {withMoney && <td className="px-3 py-2 text-end">{money(sum((d) => d.paid))}</td>}
                {withMoney && <td className="px-3 py-2 text-end">{money(sum((d) => d.balance))}</td>}
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {open && <DocModal docId={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
    </div>
  );
}
