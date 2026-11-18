"use client";

import { useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { printDirect } from "@/lib/print";
import { publicRadiologyReportUrl } from "@/lib/publicUrl";
import { RadiologyReportSheet } from "@/components/hospital/RadiologyReportSheet";
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

  const qrUrl = publicRadiologyReportUrl(r.publicToken);
  return (
    <Modal title={`Report ${r.order.order_no}`} onClose={onClose} width="max-w-4xl">
      <div ref={areaRef} className="print-area mx-auto w-full max-w-[190mm] bg-white text-[13px] text-neutral-900">
        <RadiologyReportSheet report={r} qrUrl={qrUrl} />
      </div>
      {r.publicToken && !qrUrl && <p className="mt-2 text-xs text-amber-700 print:hidden">No QR code: the website address for online reports is not set on this computer.</p>}
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => void print()} disabled={printing}><Printer size={14} className="mr-1" />{printing ? "Printing…" : "Print report"}</Button>
      </div>
    </Modal>
  );
}
