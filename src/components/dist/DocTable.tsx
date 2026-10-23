"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui/Field";
import { dist } from "@/lib/dist";
import type { DistDocType } from "@/lib/dist/store";
import { Badge, Err, money, monthStart, todayYmd, useLoad } from "./ui";
import { DocView } from "./DocView";

export function DocTable({ type, reloadKey = 0 }: { type: DistDocType; reloadKey?: number }) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayYmd);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => dist.listDocs({ type, from, to, search }), [type, from, to, search, reloadKey]);
  const rows = list.data ?? [];
  const sale = type.startsWith("sale");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="No. or name" /></Field>
      </div>
      <Err error={list.error} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-black/5">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start">No.</th>
              <th className="px-3 py-2 text-start">Date</th>
              <th className="px-3 py-2 text-start">{sale ? "Customer" : "Supplier"}</th>
              <th className="px-3 py-2 text-end">Goods total</th>
              {sale && <th className="px-3 py-2 text-end">WHT</th>}
              <th className="px-3 py-2 text-end">Paid</th>
              <th className="px-3 py-2 text-end">Balance</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="cursor-pointer border-t border-neutral-100 hover:bg-amber-50/40" onClick={() => setOpen(d.id)}>
                <td className="px-3 py-2 font-medium">#{d.doc_no}</td>
                <td className="px-3 py-2 text-xs">{d.date}</td>
                <td className="px-3 py-2">{d.party_name}</td>
                <td className="px-3 py-2 text-end">{money(d.total)}</td>
                {sale && <td className="px-3 py-2 text-end text-xs">{money(d.wht_amount)} <span className="text-neutral-400">{d.wht_rate}% {d.wht_status}</span></td>}
                <td className="px-3 py-2 text-end">{money(d.paid)}</td>
                <td className={`px-3 py-2 text-end ${d.balance > 0 ? "font-semibold text-rose-600" : ""}`}>{money(d.balance)}</td>
                <td className="px-3 py-2 text-xs">{d.booking_id && <Badge tone="violet">from booking</Badge>}{d.wht_overridden ? <Badge tone="amber">WHT overridden</Badge> : null}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-8 text-center text-neutral-400">{list.loading ? "Loading…" : "No content in table"}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <DocView id={open} onClose={() => { setOpen(null); void list.reload(); }} />}
    </div>
  );
}
