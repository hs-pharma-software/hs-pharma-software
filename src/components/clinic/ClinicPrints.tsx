"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { printDirect } from "@/lib/print";
import { loadClinicProfile, type ClinicProfile } from "@/lib/clinicProfile";
import {
  getClinicReports, getClinicVisitInvoice, listOrdersForConsultation, categoryLabel, SERVICE_CATEGORIES,
  type ClinicReports, type ClinicVisitInvoice, type ClinicOrder,
} from "@/lib/repo/clinicServices";
import { getConsultationWithPrescriptions, patientsRepo, doctorsRepo } from "@/lib/repo/clinic";
import type { ClinicConsultation, ClinicDoctor, ClinicPatient, ClinicRxItem } from "@/lib/types-clinic";
import { ClinicSlipHeader } from "./ClinicSlipHeader";
import { parseComponents } from "@/config/labPanels";
import { PAPERS } from "@/lib/printTemplates";
import { PAPER_WIDTH, loadClinicTemplate, type ClinicDoc, type ClinicPrintTemplate } from "@/lib/clinicPrintTemplates";
import { labDesign } from "@/lib/labReportDesigns";
import { LabReportDocument, type LabReportView } from "./LabReportDocument";

const money = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The document's print template (Clinic Profile > Print Templates). */
function useTemplate(doc: ClinicDoc): ClinicPrintTemplate | null {
  const [t, setT] = useState<ClinicPrintTemplate | null>(null);
  useEffect(() => { void loadClinicTemplate(doc).then(setT); }, [doc]);
  return t;
}

/** The printed area: paper width, page size, header and (at the end) the
 * signature line and footer of the template. */
function PrintArea({ t, profile, areaRef, signature, children }: {
  t: ClinicPrintTemplate;
  profile: ClinicProfile;
  areaRef: React.RefObject<HTMLDivElement | null>;
  signature: string;
  children: React.ReactNode;
}) {
  const p = PAPERS.find((x) => x.id === t.paper)!;
  return (
    <div ref={areaRef} className={`print-area mx-auto w-full ${PAPER_WIDTH[t.paper]} bg-white ${t.paper === "thermal" ? "text-[11px]" : "text-[13px]"} text-neutral-900`}>
      <style>{`@media print { @page { size: ${p.css}; margin: ${p.marginMm}mm; } }`}</style>
      <ClinicSlipHeader profile={profile} compact={t.paper === "thermal"} align={t.headerAlign} showIds={t.showIds} />
      {children}
      {t.signature && (
        <div className="mt-10 flex justify-end">
          <div className="min-w-[45%] border-t border-neutral-700 pt-1 text-center text-xs text-neutral-700">{signature}</div>
        </div>
      )}
      {t.footer && <p className="mt-4 border-t border-neutral-300 pt-1 text-center text-[0.85em] text-neutral-600">{t.footer}</p>}
    </div>
  );
}

function usePrint(autoPrint: boolean, ready: boolean, paper: ClinicPrintTemplate["paper"] = "a4") {
  const areaRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  const done = useRef(false);
  async function print() {
    if (printing) return;
    setPrinting(true);
    try {
      await printDirect(paper, areaRef.current);
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

/** A patient's lab results or radiology reports on one report (one visit's
 * tests together), with the clinic's header, ready to print. */
export function ClinicReportModal({ orderIds, onClose, autoPrint = false }: { orderIds: string[]; onClose: () => void; autoPrint?: boolean }) {
  const [r, setR] = useState<ClinicReports | null>(null);
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const key = orderIds.join(",");
  useEffect(() => {
    void getClinicReports(orderIds).then(setR).catch((e) => { window.alert(e instanceof Error ? e.message : String(e)); onClose(); });
    void loadClinicProfile().then(setProfile);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useTemplate("lab");
  const { areaRef, printing, print } = usePrint(autoPrint, Boolean(r && profile && t), t?.paper);
  const orders = r?.orders ?? [];
  const lab = orders.filter((o) => o.kind === "lab");
  const radiology = orders.filter((o) => o.kind === "radiology");
  const reportedBy = [...new Set(orders.map((o) => o.reported_by).filter(Boolean))].join(", ");
  // A diagnostic lab: the pathologist verified the results, with any comments.
  const verified = orders.some((o) => o.verified_by);
  const comments = [...new Set(orders.map((o) => o.pathologist_note).filter((n): n is string => Boolean(n) && !n!.startsWith("Recheck:")))];
  const byLabel = verified ? "Verified by" : "Reported by";
  const lastReported = orders.map((o) => o.reported_at ?? "").sort().at(-1) || "—";
  const view: LabReportView | null = r ? {
    title: lab.length ? "Laboratory Report" : "Radiology Report",
    info: [
      { label: "Patient", value: r.patient?.name ?? "—", strong: true },
      { label: "MRN", value: r.patient?.mrn ?? "—" },
      { label: "Gender / DOB", value: [r.patient?.gender, r.patient?.dob].filter(Boolean).join(" / ") || "—" },
      { label: "Referred by", value: r.doctor ? `Dr. ${r.doctor.name}` : "—" },
      { label: orders.length > 1 ? "Orders" : "Order", value: orders.map((o) => o.order_no).join(", ") },
      { label: "Reported", value: lastReported },
    ],
    lab: lab.map((o) => ({
      id: o.id, name: o.name, value: o.result_value, unit: o.unit, range: o.ref_range, flag: o.flag,
      parts: parseComponents(o.components).map((c) => ({ key: c.key, name: c.name, group: c.group, value: c.value, unit: c.unit, range: c.ref_range, flag: c.flag })),
    })),
    radiology: radiology.map((o) => ({ id: o.id, name: o.name, findings: o.findings, impression: o.impression })),
    comments,
    signedBy: reportedBy ? `${byLabel}: ${reportedBy}` : t?.signature ? byLabel : `${byLabel}: —`,
  } : null;
  return (
    <Modal title={orders.length ? `${radiology.length && !lab.length ? "Radiology report" : "Lab report"}: ${r?.patient?.name ?? ""}` : "Report"} onClose={onClose} width="max-w-3xl">
      {!r || !profile || !t || !view ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <>
          <LabReportDocument view={view} design={labDesign(t.design)} t={t} profile={profile} areaRef={areaRef} />
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 print:hidden">
            <Button variant="primary" onClick={() => void print()} disabled={printing}><Printer size={14} />{printing ? "Printing…" : "Print"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

interface ConsultationPrintData {
  consultation: ClinicConsultation;
  patient: ClinicPatient | null;
  doctor: ClinicDoctor | null;
  medicines: ClinicRxItem[];
  orders: ClinicOrder[];
}

/** The consultation for the patient: findings, medicines, and the lab tests
 * and radiology advised, in-house and external. No fees. */
export function ConsultationPrintModal({ consultationId, onClose }: { consultationId: string; onClose: () => void }) {
  const [d, setD] = useState<ConsultationPrintData | null>(null);
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  useEffect(() => {
    void (async () => {
      const full = await getConsultationWithPrescriptions(consultationId);
      if (!full) throw new Error("Consultation not found.");
      const c = full.consultation;
      const [patient, doctor, orders] = await Promise.all([
        patientsRepo.get(c.patient_id), c.doctor_id ? doctorsRepo.get(c.doctor_id) : Promise.resolve(null), listOrdersForConsultation(c.id),
      ]);
      setD({ consultation: c, patient, doctor, medicines: full.rxItems.flat(), orders: orders.filter((o) => o.status !== "cancelled") });
    })().catch((e) => { window.alert(e instanceof Error ? e.message : String(e)); onClose(); });
    void loadClinicProfile().then(setProfile);
  }, [consultationId]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useTemplate("prescription");
  const { areaRef, printing, print } = usePrint(false, Boolean(d && profile && t), t?.paper);
  const c = d?.consultation;
  const narrow = t?.paper === "thermal";
  const section = (kind: "lab" | "radiology", external: boolean) => d?.orders.filter((o) => o.kind === kind && (o.status === "external") === external) ?? [];
  const tests = (title: string, rows: ClinicOrder[]) => rows.length > 0 && (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <ul className="list-disc pl-5">
        {rows.map((o) => (
          <li key={o.id}>{o.name}</li>
        ))}
      </ul>
    </div>
  );
  const field = (label: string, value: string | null | undefined) => value ? <div><span className="font-semibold">{label}: </span><span className="whitespace-pre-line">{value}</span></div> : null;
  return (
    <Modal title="Consultation" onClose={onClose} width="max-w-3xl">
      {!d || !profile || !c || !t ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <>
          <PrintArea t={t} profile={profile} areaRef={areaRef} signature={d.doctor ? `Dr. ${d.doctor.name}` : "Doctor's signature"}>
            <div className={`mt-3 grid ${narrow ? "grid-cols-1" : "grid-cols-2"} gap-x-6 gap-y-1 border-b border-neutral-300 pb-2`}>
              <div><span className="text-neutral-500">Patient: </span><b>{d.patient?.name ?? "—"}</b></div>
              <div><span className="text-neutral-500">Date: </span>{c.date}</div>
              <div><span className="text-neutral-500">MRN: </span>{d.patient?.mrn ?? "—"}</div>
              <div><span className="text-neutral-500">Doctor: </span>{d.doctor ? `Dr. ${d.doctor.name}${d.doctor.qualification ? `, ${d.doctor.qualification}` : ""}` : "—"}</div>
              <div><span className="text-neutral-500">Gender / DOB: </span>{[d.patient?.gender, d.patient?.dob].filter(Boolean).join(" / ") || "—"}</div>
              {d.patient?.allergies && <div className="text-rose-700"><span>Allergies: </span>{d.patient.allergies}</div>}
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {field("Complaint", c.complaint)}
              {field("History", c.history)}
              {field("Vitals", c.vitals)}
              {field("Findings", c.findings)}
              {field("Diagnosis", c.diagnosis)}
            </div>
            {d.medicines.length > 0 && (
              <div className="mt-3">
                <p className="text-lg font-bold">&#8478;</p>
                <table className="w-full border-collapse">
                  <tbody>
                    {d.medicines.map((m, i) => (
                      <tr key={m.id ?? i} className="border-b border-neutral-100 align-top">
                        <td className="py-1 pr-2 font-medium">{i + 1}. {m.product_name}{m.strength ? ` ${m.strength}` : ""}{m.dosage_form ? ` (${m.dosage_form})` : ""}</td>
                        <td className="py-1 pr-2">{[m.dose, m.route, m.frequency, m.duration].filter(Boolean).join(" · ")}</td>
                        <td className="py-1 text-neutral-600">{m.instructions ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(section("lab", false).length + section("lab", true).length + section("radiology", false).length + section("radiology", true).length) > 0 && (
              <div className={`mt-3 grid ${narrow ? "grid-cols-1" : "grid-cols-2"} gap-4`}>
                <div className="flex flex-col gap-2">
                  <p className="font-semibold">Lab tests</p>
                  {tests("In-house (this clinic)", section("lab", false))}
                  {tests("External (other lab)", section("lab", true))}
                </div>
                <div className="flex flex-col gap-2">
                  <p className="font-semibold">Radiology</p>
                  {tests("In-house (this clinic)", section("radiology", false))}
                  {tests("External (other centre)", section("radiology", true))}
                </div>
              </div>
            )}
            {c.admit_advised ? (
              <div className="mt-3 rounded border-2 border-neutral-800 px-3 py-2">
                <b>ADMISSION ADVISED</b>{c.admit_urgency && c.admit_urgency !== "routine" ? ` (${c.admit_urgency.toUpperCase()})` : ""}: {c.admit_reason}
                {c.admit_ward ? ` · Ward / room: ${c.admit_ward}` : ""}{c.admit_days ? ` · Expected stay: ${c.admit_days} day${c.admit_days === 1 ? "" : "s"}` : ""}
              </div>
            ) : null}
            <div className="mt-3 flex flex-col gap-1.5">
              {field("Advice", c.advice)}
              {c.followup_date && <div><span className="font-semibold">Follow-up: </span>{c.followup_date}{c.followup_notes ? ` - ${c.followup_notes}` : ""}</div>}
            </div>
            {!t.signature && <p className="mt-10 text-right text-xs text-neutral-600">{d.doctor ? `Dr. ${d.doctor.name}` : ""}</p>}
          </PrintArea>
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
  const t = useTemplate("invoice");
  const { areaRef, printing, print } = usePrint(autoPrint, Boolean(inv && profile && t), t?.paper);
  const narrow = t?.paper === "thermal";
  const groups = inv ? SERVICE_CATEGORIES.map((c) => ({ key: c.key, lines: inv.lines.filter((l) => l.kind === c.key) })).filter((g) => g.lines.length) : [];
  return (
    <Modal title={inv ? `Invoice #${inv.invoice.invoice_no ?? ""}` : "Invoice"} onClose={onClose} width="max-w-3xl">
      {!inv || !profile || !t ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <>
          <PrintArea t={t} profile={profile} areaRef={areaRef} signature="Received by">
            <div className={`mt-3 flex ${narrow ? "flex-col gap-1" : "items-start justify-between"}`}>
              <div>
                <p className="text-base font-bold uppercase tracking-widest">Invoice</p>
                <p>No. <b>{inv.invoice.invoice_no}</b> · {inv.invoice.date}</p>
              </div>
              <div className={narrow ? "" : "text-right"}>
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
            <div className={`mt-3 ml-auto ${narrow ? "w-full" : "w-64 text-sm"}`}>
              <div className="flex justify-between"><span>Total</span><span className="tabular-nums">{money(inv.invoice.total)}</span></div>
              {Number(inv.invoice.discount_rs) > 0 && <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">-{money(inv.invoice.discount_rs)}</span></div>}
              <div className="flex justify-between border-t border-neutral-800 font-bold"><span>Payable</span><span className="tabular-nums">{money(inv.invoice.payable)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span className="tabular-nums">{money(inv.invoice.paid)}</span></div>
              <div className="flex justify-between font-semibold"><span>Balance</span><span className="tabular-nums">{money(inv.invoice.balance)}</span></div>
            </div>
          </PrintArea>
          <div className="mt-4 flex justify-end border-t border-neutral-200 pt-3 print:hidden">
            <Button variant="primary" onClick={() => void print()} disabled={printing}><Printer size={14} />{printing ? "Printing…" : "Print"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
