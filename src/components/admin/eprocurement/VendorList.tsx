"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { epVendors, type AdminVendorRow, type ListStatus } from "@/lib/eprocurementAdminClient";
import { BUSINESS_KIND_LABEL, type BusinessKind } from "@/lib/vendorProfile";
import { card, day, msg, StatusPill, VendorDetailModal } from "./EpAdmin";

/** A list of vendors in some statuses: search, rows (name bold, details small), and the detail on click. */
export function VendorList({ statuses, empty, dateLabel = "Submitted", searchable = true }: {
  statuses: { key: ListStatus; label: string }[]; empty: string; dateLabel?: string; searchable?: boolean;
}) {
  const [status, setStatus] = useState<ListStatus>(statuses[0].key);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AdminVendorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await epVendors(status, q.trim())); setError(null); }
    catch (e) { setRows([]); setError(/no such (table|column)/i.test(msg(e)) ? "eProcurement needs the database update (v111)." : msg(e)); }
  }, [status, q]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {statuses.length > 1 ? (
          <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1 rounded-xl bg-neutral-100 p-1 text-sm">
            {statuses.map((s) => (
              <button key={s.key} type="button" role="tab" aria-selected={status === s.key} onClick={() => setStatus(s.key)}
                className={`rounded-lg px-3 py-1.5 font-medium ${status === s.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>{s.label}</button>
            ))}
          </div>
        ) : <span />}
        {searchable && <div className="w-full max-w-xs"><Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, EP no, email, phone, city, work" aria-label="Search vendors" /></div>}
      </div>
      <FormError message={error} className="mt-3" />
      {rows === null ? <div className="mt-3 h-24 animate-pulse rounded-xl bg-neutral-100" aria-busy="true" />
        : rows.length === 0 ? <p className="fade-in mt-4 text-sm text-neutral-400">{empty}</p> : (
        <ul className="mt-3 divide-y divide-neutral-100">
          {rows.map((r, i) => (
            <li key={r.id} className="row-in" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <button type="button" onClick={() => setOpen(r.id)} className="row-clickable flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 text-left">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="truncate text-sm font-semibold text-neutral-900">{r.name}<span className="ml-1.5 font-mono text-[11px] font-normal text-neutral-400">{r.code}</span></p>
                  <p className="truncate text-xs text-neutral-500">
                    {[r.kind ? BUSINESS_KIND_LABEL[r.kind as BusinessKind] : null, r.categories.slice(0, 3).join(", ") + (r.categories.length > 3 ? "…" : ""), r.city, r.phone, r.email].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                  {r.hospitals > 0 && <span>{r.hospitals} hospital{r.hospitals === 1 ? "" : "s"}</span>}
                  <span>{dateLabel} {day(dateLabel === "Submitted" ? r.submittedAt ?? r.createdAt : r.reviewedAt ?? r.createdAt)}</span>
                  <StatusPill status={r.status} label={r.statusLabel} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <VendorDetailModal id={open} onClose={() => setOpen(null)} onChanged={() => void load()} />}
    </section>
  );
}
