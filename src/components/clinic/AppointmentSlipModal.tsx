"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { printDirect } from "@/lib/print";
import { loadClinicProfile, type ClinicProfile } from "@/lib/clinicProfile";
import { patientsRepo, doctorsRepo, type AppointmentWithNames } from "@/lib/repo/clinic";
import type { ClinicDoctor, ClinicPatient } from "@/lib/types-clinic";
import type { PaperSize } from "@/lib/printTemplates";
import { ClinicSlipHeader } from "./ClinicSlipHeader";

const TYPE_LABELS: Record<string, string> = { routine: "Routine", follow_up: "Follow-up", emergency: "Emergency" };

/** The appointment slip for the patient: the clinic's header, token, patient,
 * doctor and fee. Only the slip is printed. */
export function AppointmentSlipModal({ appointment: a, onClose }: { appointment: AppointmentWithNames; onClose: () => void }) {
  const [profile, setProfile] = useState<ClinicProfile | null>(null);
  const [patient, setPatient] = useState<ClinicPatient | null>(null);
  const [doctor, setDoctor] = useState<ClinicDoctor | null>(null);
  const [paper, setPaper] = useState<PaperSize>("thermal");
  const [printing, setPrinting] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadClinicProfile().then(setProfile);
    void patientsRepo.get(a.patient_id).then(setPatient);
    if (a.doctor_id) void doctorsRepo.get(a.doctor_id).then(setDoctor);
  }, [a.patient_id, a.doctor_id]);

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

  const fee = doctor ? (a.type === "follow_up" ? doctor.follow_up_fee : doctor.consultation_fee) : 0;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-0.5"><span className="text-neutral-600">{label}</span><span className="text-right font-medium">{value}</span></div>
  );

  return (
    <Modal title="Appointment Slip" onClose={onClose} width="max-w-lg">
      {!profile ? <p className="p-6 text-sm text-neutral-400">Loading…</p> : (
        <>
          <div ref={areaRef} className={`print-area mx-auto bg-white text-neutral-900 ${paper === "thermal" ? "w-[72mm] text-[11px]" : "w-full text-sm"}`}>
            <ClinicSlipHeader profile={profile} compact={paper === "thermal"} />
            <p className="mt-2 text-center text-[0.9em] font-semibold uppercase tracking-wider">Appointment Slip</p>
            {a.token_no != null && (
              <div className="my-2 text-center">
                <p className="text-[0.8em] text-neutral-600">Token No</p>
                <p className="text-4xl font-bold leading-none tabular-nums">{a.token_no}</p>
              </div>
            )}
            <div className="mt-2 border-t border-dashed border-neutral-400 pt-2">
              {row("Patient", a.patient_name)}
              {patient?.mrn && row("MRN", patient.mrn)}
              {patient?.phone && row("Mobile", patient.phone)}
              {row("Doctor", a.doctor_name ? `Dr. ${a.doctor_name}` : "Any / walk-in")}
              {doctor?.specialization && row("", doctor.specialization)}
              {row("Date", a.date)}
              {a.time && row("Time", a.time)}
              {row("Type", TYPE_LABELS[a.type] ?? a.type)}
              {a.reason && row("Reason", a.reason)}
            </div>
            {fee > 0 && (
              <div className="mt-2 flex justify-between border-t border-neutral-800 pt-1 text-[1.05em] font-bold">
                <span>{a.type === "follow_up" ? "Follow-up fee" : "Consultation fee"}</span>
                <span className="tabular-nums">Rs {Number(fee).toLocaleString()}</span>
              </div>
            )}
            <p className="mt-3 text-center text-[0.8em] text-neutral-500">Please keep this slip until your visit.</p>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 border-t border-neutral-200 pt-3 print:hidden">
            <div className="w-36">
              <Select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)} aria-label="Paper size">
                <option value="thermal">Thermal roll</option>
                <option value="a5">A5</option>
                <option value="a4">A4</option>
              </Select>
            </div>
            <Button variant="primary" onClick={() => void print()} disabled={printing}>
              <Printer size={14} className="mr-1" /> {printing ? "Printing…" : "Print slip"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
