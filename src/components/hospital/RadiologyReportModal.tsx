"use client";

import { useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { printDirect } from "@/lib/print";
import type { RadiologyReport } from "@/lib/repo/radiology";

/** A reported radiology study on screen, ready to print. */
export function RadiologyReportModal({ report: r, onClose }: { report: RadiologyReport; onClose: () => void }) {
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
