"use client";

import { useEffect, useRef, useState } from "react";
import { Printer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { printDirect } from "@/lib/print";
import { publicReportUrl } from "@/lib/publicUrl";
import { LabReportSheet } from "@/components/hospital/LabReportSheet";
import { recordReportPrint, listReportLog, type LabReport, type ReportLogRow } from "@/lib/repo/labReports";

/** A lab report on screen: print (counted and logged) and the access log. */
export function LabReportModal({ report, onClose }: { report: LabReport; onClose: () => void }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  const [copies, setCopies] = useState(report.request.print_count);
  const [log, setLog] = useState<ReportLogRow[]>([]);

  const loadLog = () => void listReportLog(report.request.id).then(setLog).catch(() => setLog([]));
  useEffect(loadLog, [report.request.id]);

  async function print() {
    if (printing) return;
    setPrinting(true);
    try {
      const r = await recordReportPrint(report.request.id);
      setCopies(r.printCount);
      await printDirect("a4", areaRef.current);
      loadLog();
    } catch (err) {
      window.alert(`Could not print: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPrinting(false);
    }
  }

  const r = report;
  return (
    <Modal title={`Report ${r.request.lab_no}`} onClose={onClose} width="max-w-4xl">
      <div ref={areaRef} className="print-area mx-auto w-full max-w-[190mm] bg-white text-[13px] text-neutral-900">
        <LabReportSheet report={r} qrUrl={publicReportUrl(r.publicToken)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
        <span className="mr-auto text-xs text-neutral-500">
          {copies > 0 ? `Printed ${copies} time${copies === 1 ? "" : "s"}` : "Not printed yet"}
          {r.publicToken && !publicReportUrl(r.publicToken) && <span className="block text-amber-700">No QR code: the website address (NEXT_PUBLIC_PUBLIC_SITE_URL) is not set in this app.</span>}
        </span>
        <Button onClick={onClose}><ArrowLeft size={14} className="mr-1" />Back to results</Button>
        <Button variant="primary" onClick={() => void print()} disabled={printing}>
          <Printer size={14} className="mr-1" />{printing ? "Printing…" : copies > 0 ? "Print again" : "Print report"}
        </Button>
      </div>
      {log.length > 0 && (
        <details className="mt-3 text-xs text-neutral-600 print:hidden">
          <summary className="cursor-pointer">Access log ({log.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {log.map((l, i) => <li key={i}>{l.created_at.replace("T", " ").slice(0, 19)} · {l.action} · {l.user_name ?? "—"}{l.details ? ` · ${l.details}` : ""}</li>)}
          </ul>
        </details>
      )}
    </Modal>
  );
}
