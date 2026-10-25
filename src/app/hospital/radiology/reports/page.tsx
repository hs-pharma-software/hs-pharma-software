"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Field";
import { printDirect } from "@/lib/print";
import { searchRadiologyReports, getRadiologyReport, type RadiologyReport, type RadiologyReportRow } from "@/lib/repo/radiology";

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

      {open && <ReportView report={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReportView({ report: r, onClose }: { report: RadiologyReport; onClose: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);

  async function print() {
    if (printing) return;
    setPrinting(true);
    try {
      await printDirect("a4", areaRef.current);
    } catch (e) {
      window.alert(`Could not print: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPrinting(false);
    }
  }

  const o = r.order;
  return (
    <Modal title={`Report ${o.order_no}`} onClose={onClose} width="max-w-4xl">
      <div ref={areaRef} className="print-area mx-auto w-full max-w-[190mm] bg-white text-[13px] text-neutral-900">
        <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-2">
          <div>
            <p className="text-xl font-bold leading-tight">{r.hospital.name}</p>
            <p className="text-xs text-neutral-600">Department of Radiology</p>
            {(r.hospital.address || r.hospital.phone) && <p className="text-xs text-neutral-600">{[r.hospital.address, r.hospital.phone].filter(Boolean).join(" · ")}</p>}
            {r.hospital.registration && <p className="text-xs text-neutral-500">Reg. {r.hospital.registration}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-wide">RADIOLOGY REPORT</p>
            <p className="font-mono text-xs">Invoice / Order {o.order_no}</p>
            {r.episodeNo && <p className="font-mono text-xs">Visit {r.episodeNo}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-neutral-300 py-2 text-xs sm:grid-cols-2">
          <p><span className="text-neutral-500">Patient:</span> <b>{r.patient.name}</b></p>
          <p><span className="text-neutral-500">MR No:</span> <span className="font-mono">{r.patient.mrNo}</span></p>
          <p><span className="text-neutral-500">Age / Sex:</span> {[r.patient.age, r.patient.gender].filter(Boolean).join(" / ") || "—"}</p>
          <p><span className="text-neutral-500">Referred by:</span> {r.referringDoctor ?? "Self"}</p>
          <p><span className="text-neutral-500">Ordered:</span> {o.ordered_at.replace("T", " ").slice(0, 16)}</p>
          <p><span className="text-neutral-500">Reported:</span> {o.reported_at?.replace("T", " ").slice(0, 16) ?? "—"}</p>
        </div>
        <p className="mt-3 text-base font-semibold">{o.modality}{o.body_part ? ` · ${o.body_part}` : ""}</p>
        {o.findings && (
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Findings</p>
            <p className="whitespace-pre-line">{o.findings}</p>
          </div>
        )}
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Impression</p>
          <p className="whitespace-pre-line font-medium">{o.impression}</p>
        </div>
        <div className="mt-8 text-xs">
          <p>Reported by <b>{o.radiologist ?? "—"}</b></p>
          <p className="text-neutral-500">Electronically generated report.</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => void print()} disabled={printing}><Printer size={14} className="mr-1" />{printing ? "Printing…" : "Print report"}</Button>
      </div>
    </Modal>
  );
}
