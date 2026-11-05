"use client";

import { useCallback, useEffect, useState } from "react";
import { Select } from "@/components/ui/Field";
import { BUSINESS_TYPES } from "@/config/businessTypes";
import { MONTHS, appLabel, money, myCall, ownerCall, when, type SalesReport, type SalesRow } from "@/lib/subSupersClient";
import { ListState, errText } from "./shared";

/** Yearly sales: activated, payment-verified setups counted once in their activation month
 * (Asia/Karachi). The owner sees every distributor; a distributor only themselves. */
export function SalesPerformanceView({ scope }: { scope: "owner" | "mine" }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [appId, setAppId] = useState("");
  const [subSuperId, setSubSuperId] = useState("");
  const [rankBy, setRankBy] = useState<"amount" | "count">("amount");
  const [data, setData] = useState<SalesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  // Every distributor for the filter, kept from the unfiltered report.
  const [everyone, setEveryone] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = { year, appId: appId || null, subSuperId: subSuperId || null, rankBy };
      const r = scope === "owner" ? await ownerCall<SalesReport>("report", body) : await myCall<SalesReport>("report", body);
      setData(r);
      if (!subSuperId) setEveryone(r.leaderboard.map((x) => ({ id: x.id, name: x.name })));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [year, appId, subSuperId, rankBy, scope]);
  useEffect(() => void load(), [load]);

  const rows = data?.leaderboard ?? [];
  const metric = (r: SalesRow) => (rankBy === "count" ? `${r.salesCount} sale${r.salesCount === 1 ? "" : "s"}` : money(r.salesAmount));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="sp-year" className="flex flex-col gap-1 text-xs text-neutral-600">Year
          <Select id="sp-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 6 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        </label>
        <label htmlFor="sp-app" className="flex flex-col gap-1 text-xs text-neutral-600">Application
          <Select id="sp-app" value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="">All applications</option>
            {BUSINESS_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </label>
        {scope === "owner" && (
          <>
            <label htmlFor="sp-dist" className="flex flex-col gap-1 text-xs text-neutral-600">Distributor
              <Select id="sp-dist" value={subSuperId} onChange={(e) => setSubSuperId(e.target.value)}>
                <option value="">All distributors</option>
                {everyone.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </label>
            <label htmlFor="sp-rank" className="flex flex-col gap-1 text-xs text-neutral-600">Rank by
              <Select id="sp-rank" value={rankBy} onChange={(e) => setRankBy(e.target.value as "amount" | "count")}>
                <option value="amount">Verified sales amount</option>
                <option value="count">Number of sales</option>
              </Select>
            </label>
          </>
        )}
      </div>

      <ListState loading={loading} error={error} empty={false} emptyText="" onRetry={() => void load()} />
      {data && !loading && !error && (
        <>
          {scope === "owner" && (
            <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Top Distributor {data.year}</p>
              {data.top ? (
                <p className="mt-1 text-lg font-semibold text-neutral-900">{data.top.name} <span className="text-base font-normal text-neutral-600">· {metric(data.top)}</span></p>
              ) : (
                <p className="mt-1 text-sm text-neutral-500">No activated sales in {data.year} yet.</p>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
            <table className="w-full min-w-max text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] uppercase tracking-widest text-neutral-400">
                <tr>
                  {scope === "owner" && <th className="px-3 py-2.5">#</th>}
                  {["Distributor", "Submitted", "Pending", "Rejected", "Sales", "Verified amount", "By application"].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="cursor-pointer border-t border-neutral-100 align-top hover:bg-neutral-50">
                    {scope === "owner" && <td className="px-3 py-2 tabular-nums text-neutral-500">{i + 1}</td>}
                    <td className="px-3 py-2 font-medium text-neutral-800">{r.name}{r.status === "suspended" && <span className="ml-1 text-xs text-rose-700">(suspended)</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{r.submitted}</td>
                    <td className="px-3 py-2 tabular-nums">{r.pending}</td>
                    <td className="px-3 py-2 tabular-nums">{r.rejected}</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{r.salesCount}</td>
                    <td className="px-3 py-2 tabular-nums font-medium">{money(r.salesAmount)}</td>
                    <td className="px-3 py-2 text-xs text-neutral-600">{r.byApp.map((b) => `${b.label}: ${b.count}`).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="py-8 text-center text-sm text-neutral-400">No distributors yet.</p>}
          </div>

          <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
            <table className="w-full min-w-max text-sm">
              <caption className="px-3 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Monthly sales {data.year} (count · amount)</caption>
              <thead className="text-left text-[10px] uppercase tracking-widest text-neutral-400">
                <tr><th className="px-3 py-2">Distributor</th>{MONTHS.map((m) => <th key={m} className="px-2 py-2 text-right">{m}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-medium text-neutral-800">{r.name}</td>
                    {r.months.map((m, i) => (
                      <td key={i} className="px-2 py-2 text-right text-xs tabular-nums">{m.count ? <>{m.count}<br /><span className="text-neutral-500">{money(m.amount)}</span></> : <span className="text-neutral-300">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open && (() => {
            const r = rows.find((x) => x.id === open);
            if (!r) return null;
            return (
              <div className="rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
                <p className="text-sm font-semibold text-neutral-800">{r.name}: sales in {data.year}</p>
                {!r.records.length ? <p className="mt-1 text-sm text-neutral-400">No activated sales.</p> : (
                  <ul className="mt-2 divide-y divide-neutral-100 text-sm">
                    {r.records.map((x) => (
                      <li key={x.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span>{x.businessName ?? "—"} · <span className="text-neutral-500">{appLabel(x.appId)}</span></span>
                        <span className="tabular-nums text-neutral-600">{when(x.activatedAt)} · {money(x.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}

          <p className="text-[11px] text-neutral-400">
            A sale is a customer setup the platform owner activated after verifying payment, counted once in the month of activation ({data.timezone} time) for the
            distributor it was activated under, at the verified amount. Pending and rejected setups are never sales. The system has no refunds or reversals yet.
          </p>
        </>
      )}
    </div>
  );
}
