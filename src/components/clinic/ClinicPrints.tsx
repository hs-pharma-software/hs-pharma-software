"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { printDirect } from "@/lib/print";
import { loadClinicProfile, type ClinicProfile } from "@/lib/clinicProfile";
import { getClinicReport, getClinicVisitInvoice, categoryLabel, SERVICE_CATEGORIES, type ClinicReport, type ClinicVisitInvoice } from "@/lib/repo/clinicServices";
import { ClinicSlipHeader } from "./ClinicSlipHeader";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FLAG: Record<string, string> = { H: "High", L: "Low", N: "Normal" };

function usePrint(autoPrint: boolean, ready: boolean) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  const done = useRef(false);
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
  useEffect(() => {
    if (autoPrint && ready && !done.current) {
      done.current = true;
      void print();
    }
  });
  return { areaRef, printing, print };
}

/** A clinic lab result or radiology report, with the clinic's header, ready to print. */
export function ClinicReportModal({ orderId, onClose, autoPrint = false }: { orderId: string; onClose: () => void; autoPrint?: boolean }) {
  const [r, setR] = useState<ClinicReport | null>(null);
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  useEffect(() => {
    void getClinicReport(orderId).then(setR).catch((e) => { window.alert(e instanceof Error ? e.message : String(e)); onClose(); });
    void loadClinicProfile().then(setProfile);
  }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { areaRef, printing, print } = usePrint(autoPrint, Boolean(r && profile));
  const o = r?.order;
  return (
    <Modal title={o ? `${o.kind === "lab" ? "Lab report" : "Radiology report"} ${o.order_no}` : "Report"} onClose={onClose} width="max-w-3xl">
      {!r || !profile || !o ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <>
          <div ref={areaRef} className="print-area mx-auto w-full max-w-[190mm] bg-white text-[13px] text-neutral-900">
            <ClinicSlipHeader profile={profile} />
            <p className="mt-3 text-center text-sm font-bold uppercase tracking-widest">{o.kind === "lab" ? "Laboratory Report" : "Radiology Report"}</p>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-y border-neutral-300 py-2">
              <div><span className="text-neutral-500">Patient: </span><b>{r.patient?.name ?? "—"}</b></div>
              <div><span className="text-neutral-500">MRN: </span>{r.patient?.mrn ?? "—"}</div>
              <div><span className="text-neutral-500">Gender / DOB: </span>{[r.patient?.gender, r.patient?.dob].filter(Boolean).join(" / ") || "—"}</div>
              <div><span className="text-neutral-500">Referred by: </span>{r.doctor ? `Dr. ${r.doctor.name}` : "—"}</div>
              <div><span className="text-neutral-500">Order: </span>{o.order_no}</div>
              <div><span className="text-neutral-500">Reported: </span>{o.reported_at ?? "—"}</div>
            </div>
            {o.kind === "lab" ? (
              <table className="mt-4 w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-neutral-800 text-left">
                    <th className="py-1">Test</th><th className="py-1">Result</th><th className="py-1">Unit</th><th className="py-1">Normal range</th><th className="py-1">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-neutral-200">
                    <td className="py-1.5 font-medium">{o.name}</td>
                    <td className={`py-1.5 font-bold ${o.flag === "H" || o.flag === "L" ? "text-rose-700" : ""}`}>{o.result_value}</td>
                    <td className="py-1.5">{o.unit ?? "—"}</td>
                    <td className="py-1.5">{o.ref_range ?? "—"}</td>
                    <td className="py-1.5">{o.flag ? FLAG[o.flag] : "—"}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                <p className="font-semibold">{o.name}</p>
                {o.findings && <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Findings</p><p className="whitespace-pre-line">{o.findings}</p></div>}
                <div><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Impression</p><p className="whitespace-pre-line font-semibold">{o.impression}</p></div>
              </div>
            )}
            <p className="mt-10 text-right text-xs text-neutral-600">Reported by: {o.reported_by ?? "—"}</p>
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 print:hidden">
            <Button variant="primary" onClick={() => void print()} disabled={printing}><Printer size={14} />{printing ? "Printing…" : "Print"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** A clinic visit invoice: the clinic's header, the patient, and the lines grouped by category. */
export function ClinicVisitInvoiceModal({ invoiceId, onClose, autoPrint = false }: { invoiceId: string; onClose: () => void; autoPrint?: boolean }) {
  const [inv, setInv] = useState<ClinicVisitInvoice | null>(null);
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  useEffect(() => {
    void getClinicVisitInvoice(invoiceId).then(setInv).catch((e) => { window.alert(e instanceof Error ? e.message : String(e)); onClose(); });
    void loadClinicProfile().then(setProfile);
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const { areaRef, printing, print } = usePrint(autoPrint, Boolean(inv && profile));
  const groups = inv ? SERVICE_CATEGORIES.map((c) => ({ key: c.key, lines: inv.lines.filter((l) => l.kind === c.key) })).filter((g) => g.lines.length) : [];
  return (
    <Modal title={inv ? `Invoice #${inv.invoice.invoice_no ?? ""}` : "Invoice"} onClose={onClose} width="max-w-3xl">
      {!inv || !profile ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <>
          <div ref={areaRef} className="print-area mx-auto w-full max-w-[190mm] bg-white text-[13px] text-neutral-900">
            <ClinicSlipHeader profile={profile} />
            <div className="mt-3 flex items-start justify-between">
              <div>
                <p className="text-base font-bold uppercase tracking-widest">Invoice</p>
                <p>No. <b>{inv.invoice.invoice_no}</b> · {inv.invoice.date}</p>
              </div>
              <div className="text-right">
                <p><span className="text-neutral-500">Patient: </span><b>{inv.patient?.name ?? inv.invoice.customer_name ?? "—"}</b></p>
                {inv.patient?.mrn && <p><span className="text-neutral-500">MRN: </span>{inv.patient.mrn}</p>}
                {inv.doctor && <p><span className="text-neutral-500">Doctor: </span>Dr. {inv.doctor.name}</p>}
              </div>
            </div>
            <table className="mt-3 w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-neutral-800 text-left">
                  <th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Rate</th><th className="py-1 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr><td colSpan={4} className="pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{categoryLabel(g.key)}</td></tr>
                    {g.lines.map((l) => (
                      <tr key={l.id} className="border-b border-neutral-100">
                        <td className="py-1">{l.name}</td>
                        <td className="py-1 text-right tabular-nums">{l.qty}</td>
                        <td className="py-1 text-right tabular-nums">{money(l.rate)}</td>
                        <td className="py-1 text-right tabular-nums">{money(l.amount)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <div className="mt-3 ml-auto w-64 text-sm">
              <div className="flex justify-between"><span>Total</span><span className="tabular-nums">{money(inv.invoice.total)}</span></div>
              {Number(inv.invoice.discount_rs) > 0 && <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">-{money(inv.invoice.discount_rs)}</span></div>}
              <div className="flex justify-between border-t border-neutral-800 font-bold"><span>Payable</span><span className="tabular-nums">{money(inv.invoice.payable)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span className="tabular-nums">{money(inv.invoice.paid)}</span></div>
              <div className="flex justify-between font-semibold"><span>Balance</span><span className="tabular-nums">{money(inv.invoice.balance)}</span></div>
            </div>
          </div>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 print:hidden">
            <Button variant="primary" onClick={() => void print()} disabled={printing}><Printer size={14} />{printing ? "Printing…" : "Print"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
