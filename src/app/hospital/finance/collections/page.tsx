"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { listCollections, totalsOf, METHOD_LABEL, type PaymentRow } from "@/lib/repo/cashClosing";
import { rs } from "@/components/hospital/finance/CloseDay";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";

/** Every payment and refund taken, with who took it and whether it is in a day closing. */
export default function CollectionsPage() {
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [receiver, setReceiver] = useState("");
  const [method, setMethod] = useState("");
  const [all, setAll] = useState<PaymentRow[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    void listCollections({ from, to }).then(setAll).catch((e) => window.alert(e instanceof Error ? e.message : String(e)));
  }, [from, to]);
  const receivers = useMemo(() => [...new Map(all.map((r) => [r.received_by ?? "__none", r.received_by_name ?? "Not recorded"])).entries()], [all]);
  const rows = all.filter((r) => (!receiver || (r.received_by ?? "__none") === receiver) && (!method || r.method === method));
  const t = totalsOf(rows);
  return (
    <div>
      <PageHeader title="Collections" />
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="From"><Input id="co-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input id="co-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Taken by">
            <Select id="co-by" value={receiver} onChange={(e) => setReceiver(e.target.value)}><option value="">Everyone</option>{receivers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          </Field>
          <Field label="Method">
            <Select id="co-m" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">All</option>{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          <p className="ml-auto pb-2 text-sm"><span className="text-neutral-500">{t.count} entries · net</span> <b className="tabular-nums">Rs {rs(t.net)}</b></p>
        </div>
        {rows.length === 0 ? <p className="text-sm text-neutral-400">No collections.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Time</th><th className={th}>Patient</th><th className={th}>For</th><th className={th}>Method</th><th className={th}>Taken by</th><th className={th}>Closing</th><th className={`${th} text-right`}>Rs</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className={`${td} tabular-nums`}>{r.received_at.replace("T", " ").slice(0, 16)}</td>
                    <td className={td}><Link className="hover:underline" href={`/hospital/episodes/view?id=${r.episode_id}`}>{r.patient_name}</Link><span className="block text-xs text-neutral-500">{r.episode_no}</span></td>
                    <td className={td}>{r.notes ?? "—"}{r.reference ? <span className="block text-xs text-neutral-500">{r.reference}</span> : null}</td>
                    <td className={td}>{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td className={td}>{r.received_by_name ?? <span className="text-neutral-400">Not recorded</span>}</td>
                    <td className={td}>{r.closing_id ? <span className="text-xs text-emerald-700">Closed</span> : r.received_by ? <span className="text-xs text-amber-700">Not closed</span> : "—"}</td>
                    <td className={`${td} text-right tabular-nums ${r.type === "refund" ? "text-rose-700" : ""}`}>{r.type === "refund" ? "−" : ""}{rs(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
