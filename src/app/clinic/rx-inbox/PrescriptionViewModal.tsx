"use client";

import { useEffect, useRef, useState } from "react";
import { Package, Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { printDirect } from "@/lib/print";
import { getMailboxPrescription, type MailboxPrescription } from "@/lib/repo/clinic";
import type { PaperSize } from "@/lib/printTemplates";
import { doctorLabel } from "@/lib/doctorName";

/** A received prescription, as sent by the clinic / hospital, ready to print
 * or to bill. Only the print area is printed. */
export function PrescriptionViewModal({
  notificationId,
  pharmacyName,
  onClose,
  onConvert,
}: {
  notificationId: string;
  pharmacyName: string | null;
  onClose: () => void;
  onConvert: (prescriptionId: string, notificationId: string) => void;
}) {
  const [rx, setRx] = useState<MailboxPrescription | null | undefined>(undefined);
  const [paper, setPaper] = useState<PaperSize>("a5");
  const [printing, setPrinting] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getMailboxPrescription(notificationId).then(setRx).catch(() => setRx(null));
  }, [notificationId]);

  async function print() {
    if (printing) return;
    setPrinting(true);
    try {
      await printDirect(paper, areaRef.current);
    } finally {
      setPrinting(false);
    }
  }

  const n = rx?.notification;
  const billed = n?.status === "dispensed" || Boolean(n?.invoice_id);

  return (
    <Modal title="Prescription" onClose={onClose} width="max-w-3xl">
      {rx === undefined ? (
        <p className="p-6 text-sm text-neutral-400">Loading…</p>
      ) : rx === null || !n ? (
        <p className="p-6 text-sm text-rose-600">This prescription could not be found.</p>
      ) : (
        <>
          <div
            ref={areaRef}
            className={`print-area mx-auto bg-white text-neutral-900 ${paper === "thermal" ? "w-[72mm] text-[11px]" : "w-full text-sm"}`}
          >
            <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-2">
              <div>
                <p className="text-lg font-bold leading-tight">{n.clinic_name || "Clinic / Hospital"}</p>
                <p className="text-xs text-neutral-600">{doctorLabel(n.doctor_name)}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold leading-none">&#8478;</p>
                <p className="text-xs text-neutral-600">{n.rx_date}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 py-2 text-xs">
              <p><span className="text-neutral-500">Patient:</span> <span className="font-semibold">{n.patient_name || "—"}</span></p>
              <p className="text-right"><span className="text-neutral-500">Received by:</span> {pharmacyName ?? "Pharmacy"}</p>
            </div>

            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-y border-neutral-300 text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="py-1 pr-2 font-medium">#</th>
                  <th className="py-1 pr-2 font-medium">Medicine</th>
                  <th className="py-1 pr-2 font-medium">Dose</th>
                  <th className="py-1 pr-2 font-medium">Frequency</th>
                  <th className="py-1 pr-2 font-medium">Days</th>
                  <th className="py-1 pr-2 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody>
                {rx.lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-neutral-100 align-top">
                    <td className="py-1.5 pr-2 tabular-nums text-neutral-500">{i + 1}</td>
                    <td className="py-1.5 pr-2">
                      <span className="font-semibold">{l.product_name}</span>
                      {(l.strength || l.dosage_form) && <span className="text-neutral-500"> {[l.strength, l.dosage_form].filter(Boolean).join(" ")}</span>}
                      {l.instructions && <span className="block text-[11px] italic text-neutral-600">{l.instructions}</span>}
                      {l.route && l.route !== "Oral" && <span className="block text-[11px] text-neutral-500">Route: {l.route}</span>}
                    </td>
                    <td className="py-1.5 pr-2">{l.dose || "—"}</td>
                    <td className="py-1.5 pr-2">{l.frequency || "—"}</td>
                    <td className="py-1.5 pr-2">{l.duration || "—"}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rx.lines.length === 0 && <p className="py-3 text-xs text-neutral-500">No medicines on this prescription.</p>}

            {n.rx_notes && (
              <div className="mt-2 border-t border-neutral-200 pt-2 text-xs">
                <span className="text-neutral-500">Notes:</span> {n.rx_notes}
              </div>
            )}
            <p className="mt-4 text-right text-[11px] text-neutral-400">{rx.lines.length} item{rx.lines.length === 1 ? "" : "s"}</p>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
            {billed && <span className="mr-auto text-xs font-medium text-emerald-700">Already invoiced</span>}
            <div className="w-36">
              <Select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)} aria-label="Paper size">
                <option value="a5">A5</option>
                <option value="a4">A4</option>
                <option value="thermal">Thermal roll</option>
              </Select>
            </div>
            <Button onClick={() => void print()} disabled={printing}>
              <Printer size={14} className="mr-1" /> {printing ? "Printing…" : "Print"}
            </Button>
            {!billed && (
              <Button variant="primary" onClick={() => onConvert(n.prescription_id, n.id)} disabled={rx.lines.length === 0}>
                <Package size={14} className="mr-1" /> Convert to Invoice
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
