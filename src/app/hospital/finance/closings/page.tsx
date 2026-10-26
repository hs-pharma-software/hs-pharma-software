"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { addDays } from "@/lib/repo/facility";
import { listClosings, verifyClosing, type CashClosing } from "@/lib/repo/cashClosing";
import { ClosingSlipModal, rs } from "@/components/hospital/finance/CloseDay";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const err = (e: unknown) => window.alert(e instanceof Error ? e.message : String(e));

/** Every receptionist's day closings: what they took, what they counted, and verification. */
export default function ClosingsPage() {
  const [from, setFrom] = useState(() => addDays(localDate(), -7));
  const [to, setTo] = useState(localDate());
  const [status, setStatus] = useState<CashClosing["status"] | "">("");
  const [rows, setRows] = useState<CashClosing[]>([]);
  const [open, setOpen] = useState<CashClosing | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listClosings({ from, to, status })); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [from, to, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, c) => s + c.net_total, 0);
  const counted = rows.reduce((s, c) => s + c.counted_cash, 0);
  const verify = async (c: CashClosing) => {
    const note = window.prompt(`Verify ${c.closing_no} from ${c.user_name}: cash received Rs ${rs(c.counted_cash)}. Note (optional):`, "");
    if (note === null) return;
    try { await verifyClosing(c.id, note); setOpen(null); void reload(); } catch (e) { err(e); }
  };
  return (
    <div>
      <PageHeader title="Day Closings" />
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="From"><Input id="cl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input id="cl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Status">
            <Select id="cl-st" value={status} onChange={(e) => setStatus(e.target.value as CashClosing["status"] | "")}><option value="">All</option><option value="submitted">Waiting for verification</option><option value="verified">Verified</option></Select>
          </Field>
          <p className="ml-auto pb-2 text-sm"><span className="text-neutral-500">{rows.length} closings · net</span> <b className="tabular-nums">Rs {rs(total)}</b> <span className="text-neutral-500">· cash counted</span> <b className="tabular-nums">Rs {rs(counted)}</b></p>
        </div>
        {rows.length === 0 ? <p className="text-sm text-neutral-400">No closings in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Closing</th><th className={th}>Receptionist</th><th className={th}>Period</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Cash expected</th><th className={`${th} text-right`}>Counted</th><th className={`${th} text-right`}>Difference</th><th className={th}>Status</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={`cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 ${c.difference < 0 && c.status === "submitted" ? "bg-rose-50/60" : ""}`} onClick={() => setOpen(c)}>
                    <td className={`${td} font-mono text-xs`}>{c.closing_no}</td>
                    <td className={td}>{c.user_name}<span className="block text-xs text-neutral-500">{c.desk ?? ""}</span></td>
                    <td className={`${td} text-xs tabular-nums`}>{(c.from_at ?? "").slice(0, 16)}<span className="block">{c.to_at.slice(0, 16)}</span></td>
                    <td className={`${td} text-right tabular-nums`}>{rs(c.net_total)}</td>
                    <td className={`${td} text-right tabular-nums`}>{rs(c.cash - c.refunds)}</td>
                    <td className={`${td} text-right tabular-nums`}>{rs(c.counted_cash)}</td>
                    <td className={`${td} text-right tabular-nums ${c.difference < 0 ? "font-medium text-rose-700" : c.difference > 0 ? "text-amber-700" : "text-neutral-400"}`}>{c.difference === 0 ? "—" : rs(c.difference)}</td>
                    <td className={td}>{c.status === "verified" ? <span className="text-xs text-emerald-700">Verified · {c.verified_by_name}</span> : <span className="text-xs font-medium text-amber-700">Waiting</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <ClosingSlipModal closing={open} onClose={() => setOpen(null)} actions={open.status === "submitted" ? <Button onClick={() => void verify(open)}>Verify cash received</Button> : undefined} />}
    </div>
  );
}
