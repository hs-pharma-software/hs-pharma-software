"use client";

import { useEffect, useState } from "react";
import { Search, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { searchRadiologyReports, getRadiologyReport, type RadiologyReport, type RadiologyReportRow } from "@/lib/repo/radiology";
import { RadiologyReportModal } from "@/components/hospital/RadiologyReportModal";

const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Awaiting study", color: "bg-amber-100 text-amber-800" },
  performed: { label: "Awaiting report", color: "bg-sky-100 text-sky-800" },
  reported: { label: "Reported", color: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", color: "bg-neutral-100 text-neutral-500" },
};

/** Radiology Reports: find a patient's studies by name, MR, phone, invoice /
 * order number or visit number, and view or print the reported ones. */
export default function RadiologyReportsPage() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<RadiologyReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<RadiologyReport | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setRows(null);
      setError(null);
      return;
    }
    const t = setTimeout(() => {
      searchRadiologyReports(query).then((r) => { setRows(r); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function view(id: string) {
    try {
      setOpen(await getRadiologyReport(id));
    } catch (e) {
      window.alert(`Could not open the report: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <PageHeader title="Radiology Reports" />
      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
        <Search size={16} className="shrink-0 text-neutral-400" />
        <Input id="rad-search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
          placeholder="Patient name, MR no, phone, invoice / order no (RAD-…) or visit no" className="max-w-xl" />
      </div>

      {error && <p className="mb-3 rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      {rows === null ? (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-neutral-400 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">Type at least 2 characters to search.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-neutral-400 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">No radiology order matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50/80 text-left text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                <th className="px-3 py-2.5">Invoice / Order No</th><th className="px-3 py-2.5">Patient</th><th className="px-3 py-2.5">Study</th>
                <th className="px-3 py-2.5">Ordered</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, color: "bg-neutral-100 text-neutral-600" };
                const unpaid = r.fee > 0 && !r.paid;
                return (
                  <tr key={r.id} className="border-b border-neutral-50 align-top">
                    <td className="px-3 py-2"><span className="font-mono text-xs">{r.order_no}</span>{r.episode_no && <span className="block font-mono text-[11px] text-neutral-400">{r.episode_no}</span>}</td>
                    <td className="px-3 py-2"><span className="font-medium">{r.patient_name}</span><span className="block text-xs text-neutral-500">{r.mr_no}{r.phone ? ` · ${r.phone}` : ""}</span></td>
                    <td className="px-3 py-2">{r.study}{r.body_part ? <span className="text-neutral-500"> · {r.body_part}</span> : null}</td>
                    <td className="px-3 py-2 text-xs text-neutral-600">{r.ordered_at.replace("T", " ").slice(0, 16)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${unpaid && r.status === "pending" ? "bg-rose-100 text-rose-700" : st.color}`}>
                        {unpaid && r.status === "pending" ? `Fee Rs ${r.fee.toFixed(0)} unpaid` : st.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status === "reported" && <Button variant="primary" onClick={() => void view(r.id)}><Printer size={13} className="mr-1" />View / print</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <RadiologyReportModal report={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
