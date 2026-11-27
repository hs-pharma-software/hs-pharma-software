"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { card, day, EpAdminFrame, msg, pkr } from "@/components/admin/eprocurement/EpAdmin";
import { epOrganizations, epSetAllowed, type OrganizationRow } from "@/lib/eprocurementAdminClient";

/** Super Admin > eProcurement > Organizations: every hospital, whether eProcurement is on for it, and how much it is used. */
export default function EpOrganizationsPage() {
  const [rows, setRows] = useState<OrganizationRow[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setRows(await epOrganizations()); setError(null); } catch (e) { setRows([]); setError(msg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const shown = useMemo(() => (rows ?? []).filter((r) => !q.trim() || `${r.name} ${r.address ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, q]);
  const on = (rows ?? []).filter((r) => r.allowed).length;

  async function toggle(r: OrganizationRow) {
    setBusy(r.tenantId);
    try { await epSetAllowed(r.tenantId, !r.allowed); notify(`${r.name}: eProcurement ${r.allowed ? "switched off" : "switched on"}. Its staff see the change at their next sign-in.`, "success"); await load(); }
    catch (e) { notify(msg(e)); } finally { setBusy(null); }
  }

  return (
    <EpAdminFrame>
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-neutral-600">{rows ? <><b>{on}</b> of {rows.length} hospitals use eProcurement.</> : "Loading…"}</p>
          <div className="w-full max-w-xs"><Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hospital or address" aria-label="Search hospitals" /></div>
        </div>
        <FormError message={error} className="mt-3" />
        {rows === null ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" /> : shown.length === 0 ? <p className="mt-4 text-sm text-neutral-400">No hospitals.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                  <th className="pb-2 pr-3 font-medium">Hospital</th><th className="pb-2 pr-3 text-right font-medium">Vendors</th><th className="pb-2 pr-3 text-right font-medium">Quote requests</th>
                  <th className="pb-2 pr-3 text-right font-medium">Orders</th><th className="pb-2 pr-3 text-right font-medium">Orders value</th><th className="pb-2 pr-3 font-medium">Last order</th><th className="pb-2 font-medium">eProcurement</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.tenantId} className="row-in border-b border-neutral-50" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                    <td className="py-2 pr-3"><p className="font-semibold text-neutral-900">{r.name}</p>{r.address && <p className="max-w-[16rem] truncate text-xs text-neutral-500">{r.address}</p>}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.vendors}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.rfqs}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.orders}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pkr(r.ordersValue)}</td>
                    <td className="py-2 pr-3 text-neutral-500">{day(r.lastOrderAt)}</td>
                    <td className="py-2">
                      <button type="button" role="switch" aria-checked={r.allowed} aria-label={`eProcurement for ${r.name}`} disabled={busy !== null} onClick={() => void toggle(r)}
                        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${r.allowed ? "bg-emerald-500" : "bg-neutral-300"}`}>
                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${r.allowed ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </EpAdminFrame>
  );
}
