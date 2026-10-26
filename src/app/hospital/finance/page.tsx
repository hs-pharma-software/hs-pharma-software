"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { financeOverview, type FinanceOverview } from "@/lib/repo/cashClosing";
import { rs } from "@/components/hospital/finance/CloseDay";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const VISIT: Record<string, string> = { opd: "OPD", ipd: "Admissions", emergency: "Emergency" };

/** The hospital's money: collections by method, receptionist and day; billing by department; what is still owed. */
export default function FinanceOverviewPage() {
  const [from, setFrom] = useState(localDate());
  const [to, setTo] = useState(localDate());
  const [ov, setOv] = useState<FinanceOverview | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void financeOverview({ from, to }).then(setOv).catch((e) => window.alert(e instanceof Error ? e.message : String(e)));
  }, [from, to]);
  const tiles: [string, string, string][] = ov ? [
    ["Net collected", rs(ov.totals.net), `${ov.totals.count} entries`],
    ["Cash", rs(ov.totals.cash), ov.totals.refunds ? `refunds −${rs(ov.totals.refunds)}` : ""],
    ["Card / online / bank", rs(ov.totals.card + ov.totals.online + ov.totals.bank), ""],
    ["Billed in the period", rs(ov.billed), "charges added"],
    ["Still owed by patients", rs(ov.outstandingTotal), `${ov.outstanding.length} visits`],
    ["Closings to verify", String(ov.closingsPending), ov.closingsShort ? `${ov.closingsShort} short` : ""],
  ] : [];
  return (
    <div>
      <PageHeader title="Finance" />
      <div className="flex flex-col gap-4">
        <div className={card}>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Field label="From"><Input id="fo-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input id="fo-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          {ov && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {tiles.map(([l, n, sub]) => (
                <div key={l} className="rounded-xl bg-neutral-50 p-3">
                  <p className="text-xs text-neutral-500">{l}</p>
                  <p className="text-xl font-semibold tabular-nums">{n}</p>
                  {sub && <p className="text-[11px] text-neutral-500">{sub}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {ov && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-neutral-700">By receptionist</h2><Link href="/hospital/finance/closings" className="text-xs text-neutral-500 hover:underline">Day closings</Link></div>
              {ov.byReceiver.length === 0 ? <p className="text-sm text-neutral-400">No collections in this period.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Receptionist</th><th className={`${th} text-right`}>Cash</th><th className={`${th} text-right`}>Other</th><th className={`${th} text-right`}>Net</th><th className={`${th} text-right`}>Cash not closed</th></tr></thead>
                  <tbody>
                    {ov.byReceiver.map((r) => (
                      <tr key={r.id ?? "none"} className="border-t border-neutral-100 tabular-nums">
                        <td className={td}>{r.name}</td>
                        <td className={`${td} text-right`}>{rs(r.totals.cash - r.totals.refunds)}</td>
                        <td className={`${td} text-right`}>{rs(r.totals.card + r.totals.online + r.totals.bank)}</td>
                        <td className={`${td} text-right font-medium`}>{rs(r.totals.net)}</td>
                        <td className={`${td} text-right ${r.openCash ? "font-medium text-amber-700" : "text-neutral-400"}`}>{r.openCount ? rs(r.openCash) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className={card}>
              <h2 className="mb-2 text-sm font-semibold text-neutral-700">By day</h2>
              {ov.byDay.length === 0 ? <p className="text-sm text-neutral-400">No collections in this period.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Day</th><th className={`${th} text-right`}>Cash</th><th className={`${th} text-right`}>Card</th><th className={`${th} text-right`}>Online / bank</th><th className={`${th} text-right`}>Net</th></tr></thead>
                  <tbody>
                    {ov.byDay.map((d) => (
                      <tr key={d.day} className="border-t border-neutral-100 tabular-nums">
                        <td className={td}>{d.day}</td><td className={`${td} text-right`}>{rs(d.totals.cash - d.totals.refunds)}</td><td className={`${td} text-right`}>{rs(d.totals.card)}</td>
                        <td className={`${td} text-right`}>{rs(d.totals.online + d.totals.bank)}</td><td className={`${td} text-right font-medium`}>{rs(d.totals.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {ov.byVisitType.length > 0 && <p className="mt-2 text-xs text-neutral-500">{ov.byVisitType.map((v) => `${VISIT[v.type] ?? v.type}: ${rs(v.net)}`).join(" · ")}</p>}
            </div>
            <div className={card}>
              <h2 className="mb-2 text-sm font-semibold text-neutral-700">Billed by department</h2>
              {ov.billedByDepartment.length === 0 ? <p className="text-sm text-neutral-400">No charges in this period.</p> : ov.billedByDepartment.map((b) => (
                <div key={b.department} className="flex items-center gap-2 py-0.5 text-xs">
                  <span className="w-40 shrink-0">{b.department}</span>
                  <div className="h-2 flex-1 rounded-full bg-neutral-100"><div className="h-2 rounded-full bg-emerald-600" style={{ width: `${ov.billed ? (b.billed / ov.billed) * 100 : 0}%` }} /></div>
                  <span className="w-24 text-right tabular-nums">{rs(b.billed)}</span>
                </div>
              ))}
            </div>
            <div className={card}>
              <h2 className="mb-2 text-sm font-semibold text-neutral-700">Still owed (all dates)</h2>
              {ov.outstanding.length === 0 ? <p className="text-sm text-neutral-400">No visit has a balance due.</p> : (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Patient</th><th className={th}>Visit</th><th className={`${th} text-right`}>Balance</th></tr></thead>
                    <tbody>
                      {ov.outstanding.map((o) => (
                        <tr key={o.episode_id} className="border-t border-neutral-100">
                          <td className={td}><Link className="hover:underline" href={`/hospital/episodes/view?id=${o.episode_id}`}>{o.patient_name}</Link><span className="block text-xs text-neutral-500">{o.mr_no}</span></td>
                          <td className={td}>{o.episode_no}<span className="block text-xs text-neutral-500">{VISIT[o.type] ?? o.type} · {o.status}</span></td>
                          <td className={`${td} text-right font-medium tabular-nums text-rose-700`}>{rs(o.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
