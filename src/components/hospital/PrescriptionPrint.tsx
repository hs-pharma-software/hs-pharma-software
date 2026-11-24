"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { fitToA4Page, printDirect } from "@/lib/print";
import { loadLogo } from "@/lib/printTemplates";
import { hospitalEpisodesRepo, hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import { listRx, listVisitOrders } from "@/lib/repo/hospitalOpd";
import { staffRepo } from "@/lib/repo/staff";
import { useAuthStore } from "@/store/authStore";
import { dateWithDay, loadHospitalPrint, loadHospitalProfile, prescriptionQrText, type HospitalPrintSettings, type HospitalProfileInfo } from "@/lib/hospitalPrint";
import type { HospitalEpisode, HospitalRxItem } from "@/lib/types-hospital";
import type { Staff } from "@/lib/types";

type Order = Awaited<ReturnType<typeof listVisitOrders>>[number];
interface Data {
  ep: HospitalEpisode; patient: HospitalPatient | null; doctor: Staff | null; lines: HospitalRxItem[]; orders: Order[];
  profile: HospitalProfileInfo; settings: HospitalPrintSettings; logo: string | null;
}

const age = (p: HospitalPatient | null) => {
  if (!p) return "—";
  const y = p.age_years, m = p.age_months;
  if (y == null && m == null) return "—";
  return [y != null && y > 0 ? `${y}y` : null, m != null && m > 0 ? `${m}m` : null].filter(Boolean).join(" ") || "0m";
};

/** The visit's prescription on A4 (Hospital Profile > Print templates):
 * header (hospital | doctor), patient, prescription | examination and tests
 * advised, footer (advice and note | QR, signature, doctor). Medicines print
 * by the brand the hospital chose (Selected Brands). */
export function PrescriptionPrintModal({ episodeId, onClose }: { episodeId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const tenantName = useAuthStore((s) => s.currentTenant?.name ?? "Hospital");
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const ep = await hospitalEpisodesRepo.get(episodeId);
      if (!ep) throw new Error("Visit not found.");
      const [patient, doctor, lines, orders, profile, settings, logo] = await Promise.all([
        hospitalPatientsRepo.get(ep.patient_id), ep.doctor_id ? staffRepo.get(ep.doctor_id) : Promise.resolve(null),
        listRx(episodeId), listVisitOrders(episodeId).catch(() => [] as Order[]), loadHospitalProfile(tenantName), loadHospitalPrint(), loadLogo().catch(() => null),
      ]);
      setD({ ep, patient, doctor, lines: lines.filter((l) => l.order_type !== "inpatient"), orders, profile, settings, logo });
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [episodeId, tenantName]);

  async function print() {
    const restore = fitToA4Page(ref.current);
    try { await printDirect("a4", ref.current); } catch (e) { window.alert(e instanceof Error ? e.message : String(e)); } finally { restore(); }
  }

  const docTitle = (doc: Staff | null) => [d?.settings.rxShowDesignation ? doc?.designation : null, doc?.specialization].filter(Boolean).join(" · ");
  const regs = d ? [d.profile.registration_no && `Reg. / PHC ${d.profile.registration_no}`, d.profile.ntn && `NTN ${d.profile.ntn}`, d.settings.otherRegistrations].filter(Boolean).join(" · ") : "";
  const labs = d?.orders.filter((o) => o.kind === "lab") ?? [];
  const scans = d?.orders.filter((o) => o.kind !== "lab") ?? [];
  const exam: [string, string | null | undefined][] = d ? [["Complaint", d.ep.complaint], ["Vitals", d.ep.vitals], ["Examination", d.ep.findings], ["Diagnosis", d.ep.diagnosis]] : [];

  return (
    <Modal title="Prescription" onClose={onClose} width="max-w-4xl">
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!d ? !error && <p className="text-sm text-neutral-400">Loading…</p> : (
        <div ref={ref} className="print-area mx-auto flex min-h-[270mm] w-full max-w-[190mm] flex-col bg-white text-[12px] text-neutral-900">
          {/* Header: the hospital | the doctor */}
          <div className="grid grid-cols-2 gap-4 border-b-2 border-neutral-800 pb-2">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {d.logo && <img src={d.logo} alt="" className="h-16 w-auto shrink-0 object-contain" />}
              <div>
                <p className="text-lg font-bold leading-tight">{d.profile.name}</p>
                {(d.profile.address || d.profile.city) && <p className="text-[11px] text-neutral-600">{[d.profile.address, d.profile.city].filter(Boolean).join(", ")}</p>}
                {regs && <p className="text-[10px] text-neutral-600">{regs}</p>}
                {(d.profile.phone || d.profile.email) && <p className="text-[11px] text-neutral-600">{[d.profile.phone && `Tel ${d.profile.phone}`, d.profile.email].filter(Boolean).join(" · ")}</p>}
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold leading-tight">{d.doctor?.name ?? ""}</p>
              {d.settings.rxShowQualification && d.doctor?.qualification && <p className="text-sm font-medium">{d.doctor.qualification}</p>}
              {docTitle(d.doctor) && <p className="text-[11px] text-neutral-600">{docTitle(d.doctor)}</p>}
              {d.doctor?.license_no && <p className="text-[10px] text-neutral-500">PMDC {d.doctor.license_no}</p>}
            </div>
          </div>
          {/* Patient */}
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 border-b border-neutral-300 py-1.5 text-[11px]">
            <p><span className="text-neutral-500">Patient:</span> <b>{d.patient?.name}</b></p>
            <p><span className="text-neutral-500">Age / Sex:</span> {age(d.patient)} / {d.patient?.gender ?? "—"}</p>
            <p><span className="text-neutral-500">MR No:</span> <span className="font-mono">{d.patient?.mr_no}</span></p>
            <p className="col-span-2"><span className="text-neutral-500">Date:</span> {dateWithDay(d.ep.date)} <span className="text-neutral-400">· {d.ep.episode_no}</span></p>
            <p>{d.ep.followup_date && <><span className="text-neutral-500">Follow-up:</span> <b>{dateWithDay(d.ep.followup_date)}</b></>}</p>
          </div>
          {/* Body: prescription | examination and tests advised */}
          <div className="grid flex-1 grid-cols-[2fr_1fr] gap-4 py-2">
            <div>
              <p className="text-2xl font-bold italic">Rx</p>
              {d.lines.length === 0 ? <p className="text-neutral-400">No medicines.</p> : (
                <ol className="mt-1 list-decimal space-y-2 pl-5">
                  {d.lines.map((l) => (
                    <li key={l.id}>
                      <span className="font-semibold">{l.product_name}</span>
                      <span className="block text-[11px] text-neutral-700">{[l.dose, l.frequency, l.duration && `${l.duration} days`, l.qty ? `Qty ${l.qty}` : null, l.instructions].filter(Boolean).join(" · ")}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="border-l border-neutral-300 pl-3 text-[11px]">
              {exam.filter(([, v]) => v?.trim()).map(([k, v]) => (
                <div key={k} className="mb-2"><p className="font-semibold text-neutral-700">{k}</p><p className="whitespace-pre-line">{v}</p></div>
              ))}
              {labs.length > 0 && <div className="mb-2"><p className="font-semibold text-neutral-700">Lab tests advised</p><ul className="list-disc pl-4">{labs.map((o) => <li key={o.id}>{o.name}</li>)}</ul></div>}
              {scans.length > 0 && <div className="mb-2"><p className="font-semibold text-neutral-700">Radiology advised</p><ul className="list-disc pl-4">{scans.map((o) => <li key={o.id}>{o.name}</li>)}</ul></div>}
            </div>
          </div>
          {/* Footer: advice and note | QR, signature, doctor */}
          <div className="grid grid-cols-[2fr_1fr] gap-4 border-t-2 border-neutral-800 pt-2">
            <div className="text-[11px]">
              {d.ep.advice && <><p className="font-semibold text-neutral-700">Advice</p><p className="whitespace-pre-line">{d.ep.advice}</p></>}
              {d.settings.rxFooterNote && <p className="mt-2 text-neutral-600">{d.settings.rxFooterNote}</p>}
            </div>
            <div className="flex flex-col items-center text-center text-[11px]">
              <div className="bg-white p-1 ring-1 ring-neutral-300"><QRCode value={prescriptionQrText(d)} size={64} style={{ width: 64, height: 64 }} viewBox="0 0 256 256" /></div>
              <div className="mt-8 w-full border-t border-neutral-500 pt-1">
                <p className="font-semibold">{d.doctor?.name ?? "Doctor"}</p>
                {d.settings.rxShowDesignation && d.doctor?.designation && <p className="text-neutral-600">{d.doctor.designation}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" disabled={!d} onClick={() => void print()}><Printer size={14} className="mr-1" />Print</Button>
      </div>
    </Modal>
  );
}
