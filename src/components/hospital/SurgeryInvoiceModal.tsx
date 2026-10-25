"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { printDirect } from "@/lib/print";
import { localDateTime } from "@/lib/localDate";
import { getSurgeryInvoice, type SurgeryInvoice } from "@/lib/repo/hospitalCare";

const rs = (n: number) => Number(n).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** The invoice of a booked surgery: one line per charge (operation fee, OT,
 * paramedics, anaesthesia, OT medicine, room, indoor medicine). */
export function SurgeryInvoiceModal({ invoiceId, onClose, autoPrint = false }: { invoiceId: string; onClose: () => void; autoPrint?: boolean }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [inv, setInv] = useState<SurgeryInvoice | null>(null);

  useEffect(() => {
    getSurgeryInvoice(invoiceId).then(setInv).catch((e) => {
      window.alert(`Could not load the invoice: ${e instanceof Error ? e.message : String(e)}`);
      onClose();
    });
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function print() {
    try {
      await printDirect("a4", areaRef.current);
    } catch (e) {
      window.alert(`Could not print: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  useEffect(() => {
    if (inv && autoPrint) void print().then(onClose);
  }, [inv]); // eslint-disable-line react-hooks/exhaustive-deps

  const i = inv?.invoice;
  return (
    <Modal title={i ? `Surgery invoice #${i.invoice_no ?? ""}` : "Surgery invoice"} onClose={onClose} width="max-w-3xl">
      {!inv || !i ? <p className="text-sm text-neutral-400">Loading…</p> : (
        <>
          <div ref={areaRef} className="print-area mx-auto w-full max-w-[190mm] bg-white text-[13px] text-neutral-900">
            <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-2">
              <div>
                <p className="text-xl font-bold leading-tight">{inv.hospital.name}</p>
                {(inv.hospital.address || inv.hospital.phone) && <p className="text-xs text-neutral-600">{[inv.hospital.address, inv.hospital.phone].filter(Boolean).join(" · ")}</p>}
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tracking-wide">SURGERY INVOICE</p>
                <p className="font-mono text-xs">Bill # {i.invoice_no ?? "—"}</p>
                <p className="text-xs">Date {i.date}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-neutral-300 py-2 text-xs sm:grid-cols-2">
              <p><span className="text-neutral-500">Patient:</span> <b>{inv.patient?.name ?? i.customer_name ?? "—"}</b></p>
              <p><span className="text-neutral-500">MR No:</span> <span className="font-mono">{inv.patient?.mr_no ?? "—"}</span></p>
              <p><span className="text-neutral-500">Admission:</span> <span className="font-mono">{inv.admission?.episode_no ?? "—"}</span></p>
              <p><span className="text-neutral-500">Ward / Bed:</span> {[inv.admission?.room_ward, inv.admission?.bed_no].filter(Boolean).join(" / ") || "—"}</p>
              <p><span className="text-neutral-500">Surgery:</span> {inv.surgery?.name ?? "—"}</p>
              <p><span className="text-neutral-500">Surgeon:</span> {inv.surgeonName ?? "—"}</p>
              {inv.surgery?.planned_date && <p><span className="text-neutral-500">Planned date:</span> {inv.surgery.planned_date}</p>}
              {inv.admission?.department && <p><span className="text-neutral-500">Department:</span> {inv.admission.department}</p>}
            </div>

            <table className="mt-2 w-full text-left">
              <thead><tr className="border-b border-neutral-400 text-[11px] uppercase tracking-wide text-neutral-600">
                <th className="py-1 pr-2 font-semibold">#</th><th className="py-1 pr-2 font-semibold">Description</th><th className="py-1 text-right font-semibold">Amount (Rs)</th>
              </tr></thead>
              <tbody>
                {inv.lines.map((l, n) => (
                  <tr key={l.id} className="border-b border-neutral-100">
                    <td className="py-1 pr-2 tabular-nums text-neutral-500">{n + 1}</td>
                    <td className="py-1 pr-2">{l.description.replace(`${inv.surgery?.name ?? ""}: `, "")}</td>
                    <td className="py-1 text-right tabular-nums">{rs(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto mt-3 w-64">
              <div className="flex justify-between"><span>Total</span><span className="tabular-nums">{rs(i.payable)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span className="tabular-nums">{rs(i.paid)}</span></div>
              <div className="mt-0.5 flex justify-between border-t border-neutral-800 pt-0.5 font-bold"><span>Balance</span><span className="tabular-nums">{rs(i.balance)}</span></div>
            </div>
            <p className="mt-6 text-center text-[11px] text-neutral-500">Payments are taken on the admission {inv.admission?.episode_no ?? ""}. Printed {localDateTime().replace("T", " ").slice(0, 16)}.</p>
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => void print()}><Printer size={14} className="mr-1" />Print invoice</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
