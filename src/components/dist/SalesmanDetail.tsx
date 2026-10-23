"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Field";
import { dist } from "@/lib/dist";
import { Badge, Bars, BOOKING_TONE, Err, LIVE_TONE, MapView, Note, Stat, TargetRing, ago, money, thisMonth, useLoad } from "./ui";

/** Salesman dashboard: same figures for the administrator and the salesman. */
export function SalesmanDetail({ salesmanId, showLocation }: { salesmanId: string; showLocation: boolean }) {
  const [month, setMonth] = useState(thisMonth);
  const perf = useLoad(() => dist.performance(salesmanId, month), [salesmanId, month]);
  const loc = useLoad(() => (showLocation ? dist.salesmanLocation(salesmanId) : Promise.resolve(null)), [salesmanId, showLocation]);
  const [dim, setDim] = useState<"day" | "week" | "company" | "category" | "customer">("company");
  // Refresh the location without reloading the page.
  useEffect(() => {
    if (!showLocation) return;
    const h = setInterval(() => void loc.reload(), 20000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesmanId, showLocation]);
  const p = perf.data;
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-500">Month</span>
        <Select className="!w-36" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </div>
      <Err error={perf.error ?? loc.error} />
      {p && (
        <>
          <TargetRing progress={p.progress} month={p.month} metric={p.metric} />
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Booking value (submitted)" value={money(p.values.bookingValue)} />
            <Stat label="Approved order value" value={money(p.values.approvedValue)} />
            <Stat label="Invoiced sales" value={money(p.values.invoiced)} />
            <Stat label="Sales returns" value={money(p.values.returns)} />
            <Stat label="Net sales" value={money(p.values.netSales)} />
            <Stat label="Collected" value={money(p.values.collected)} hint="Payments against this salesman's invoices" />
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(p.counts).map(([k, n]) => (
              <Badge key={k} tone={BOOKING_TONE[k] ?? "neutral"}>{k.replace("_", " ")}: {n}</Badge>
            ))}
          </div>
          <div className="rounded-xl bg-white p-3 ring-1 ring-black/5">
            <div className="mb-2 flex flex-wrap gap-1">
              {(["company", "category", "customer", "day", "week"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDim(d)} className={`rounded-full px-3 py-1 text-xs ${dim === d ? "bg-neutral-900 text-white" : "ring-1 ring-black/10"}`}>By {d}</button>
              ))}
            </div>
            <Bars rows={p.breakdowns[dim].map((r) => ({ label: dim === "week" ? `Week ${r.label}` : r.label, amount: r.amount }))} />
            <p className="mt-2 text-[11px] text-neutral-400">Breakdown uses the same metric as the target ({p.metric}).</p>
          </div>
        </>
      )}
      {showLocation && loc.data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={LIVE_TONE[loc.data.state]}>{loc.data.state === "live" ? "Live" : loc.data.state === "stale" ? "Stale — no recent update" : loc.data.state === "stopped" ? "Sharing stopped" : "Never shared"}</Badge>
            {loc.data.point && <span className="text-neutral-500">Last update {ago(loc.data.point.recorded_at, new Date(loc.data.now).getTime())} ({loc.data.point.recorded_at.slice(0, 19).replace("T", " ")} UTC){loc.data.point.accuracy ? ` · ±${Math.round(loc.data.point.accuracy)} m` : ""}{loc.data.point.flag ? ` · flagged: ${loc.data.point.flag}` : ""}</span>}
          </div>
          {loc.data.point ? (
            <MapView markers={[{ id: "s", lat: loc.data.point.lat, lng: loc.data.point.lng, title: loc.data.state === "live" ? "Current location" : "Last known location (not live)", glyph: "S", color: loc.data.state === "live" ? "#16a34a" : "#9ca3af" }]} height={300} />
          ) : (
            <Note>No location has been shared yet.</Note>
          )}
        </div>
      )}
    </div>
  );
}
