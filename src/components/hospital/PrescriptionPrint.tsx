"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { printDirect } from "@/lib/print";
import { loadLogo } from "@/lib/printTemplates";
import { hospitalHeader } from "@/lib/repo/hospitalCare";
import { hospitalEpisodesRepo, hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import { listRx } from "@/lib/repo/hospitalOpd";
import { staffRepo } from "@/lib/repo/staff";
import type { HospitalEpisode, HospitalRxItem } from "@/lib/types-hospital";
import type { Staff } from "@/lib/types";

const fmt = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

/** The visit's prescription on A5: the medicines by the brand the hospital
 * chose (Selected Brands), with dose, frequency, days and instructions. */
export function PrescriptionPrintModal({ episodeId, onClose }: { episodeId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{
    ep: HospitalEpisode; patient: HospitalPatient | null; doctor: Staff | null; lines: HospitalRxItem[];
    header: { name: string; address: string | null; phone: string | null }; logo: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const ep = await hospitalEpisodesRepo.get(episodeId);
      if (!ep) throw new Error("Visit not found.");
      const [patient, doctor, lines, header, logo] = await Promise.all([
        hospitalPatientsRepo.get(ep.patient_id), ep.doctor_id ? staffRepo.get(ep.doctor_id) : Promise.resolve(null),
        listRx(episodeId), hospitalHeader(), loadLogo().catch(() => null),
      ]);
      setData({ ep, patient, doctor, lines: lines.filter((l) => l.order_type !== "inpatient"), header, logo });
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [episodeId]);

  return (
    <Modal title="Prescription" onClose={onClose}>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!data ? !error && <p className="text-sm text-neutral-400">Loading…</p> : (
        <div ref={ref} className="print-area mx-auto w-full max-w-[140mm] bg-white text-[12px] text-neutral-900">
          <div className="flex items-center gap-3 border-b-2 border-neutral-800 pb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {data.logo && <img src={data.logo} alt="" className="h-12 w-auto object-contain" />}
            <div className="flex-1 text-center">
              <p className="text-base font-bold leading-tight">{data.header.name}</p>
              {(data.header.address || data.header.phone) && <p className="text-[10px] text-neutral-600">{[data.header.address, data.header.phone].filter(Boolean).join(" · ")}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-b border-neutral-300 py-1.5 text-[11px]">
            <p><span className="text-neutral-500">Patient:</span> <b>{data.patient?.name}</b></p>
            <p><span className="text-neutral-500">MR:</span> <span className="font-mono">{data.patient?.mr_no}</span></p>
            <p><span className="text-neutral-500">Age / sex:</span> {data.patient?.age_years != null ? `${data.patient.age_years}y` : "—"} / {data.patient?.gender ?? ""}</p>
            <p><span className="text-neutral-500">Date:</span> {fmt(data.ep.date)} · {data.ep.episode_no}</p>
            {data.doctor && <p className="col-span-2"><span className="text-neutral-500">Doctor:</span> {data.doctor.name}{data.doctor.specialization ? ` (${data.doctor.specialization})` : ""}</p>}
          </div>
          {data.ep.vitals && <p className="pt-1.5 text-[11px]"><span className="text-neutral-500">Vitals:</span> {data.ep.vitals}</p>}
          {data.ep.diagnosis && <p className="pt-1 text-[11px]"><span className="text-neutral-500">Diagnosis:</span> {data.ep.diagnosis}</p>}
          <p className="pt-2 text-xl font-bold italic">Rx</p>
          <ol className="list-decimal space-y-1.5 pl-5">
            {data.lines.map((l) => (
              <li key={l.id}>
                <span className="font-semibold">{l.product_name}</span>
                <span className="block text-[11px] text-neutral-700">{[l.dose, l.frequency, l.duration && `${l.duration} days`, l.qty ? `Qty ${l.qty}` : null, l.instructions].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ol>
          {data.ep.advice && <p className="mt-3 text-[11px]"><span className="text-neutral-500">Advice:</span> {data.ep.advice}</p>}
          {data.ep.followup_date && <p className="text-[11px]"><span className="text-neutral-500">Follow-up:</span> {fmt(data.ep.followup_date)}</p>}
          <div className="mt-8 flex justify-end"><p className="w-40 border-t border-neutral-500 pt-1 text-center text-[11px]">{data.doctor?.name ?? "Doctor"}</p></div>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" disabled={!data} onClick={() => void printDirect("a5", ref.current).catch((e) => window.alert(e instanceof Error ? e.message : String(e)))}><Printer size={14} className="mr-1" />Print</Button>
      </div>
    </Modal>
  );
}
