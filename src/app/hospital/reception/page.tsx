"use client";

import { useEffect, useState } from "react";
import { Plus, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import { hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import {
  bookOpdVisit, listHospitalDoctors, listOpdQueue, listUnpaidOrders, payOrderFee,
  type BookedVisit, type OpdQueueRow, type UnpaidOrderRow,
} from "@/lib/repo/hospitalOpd";
import type { PaymentMethod } from "@/lib/types-hospital";
import type { Staff } from "@/lib/types";
import PatientFormModal from "../patients/PatientFormModal";
import { ReceiptModal } from "./ReceiptModal";

const STATUS_LABEL: Record<string, string> = { waiting: "Waiting", in_consultation: "With doctor", done: "Seen" };
const STATUS_COLOR: Record<string, string> = {
  waiting: "bg-amber-100 text-amber-800",
  in_consultation: "bg-blue-100 text-blue-700",
  done: "bg-emerald-100 text-emerald-700",
};

/** OPD reception: book a patient with a doctor, take the fee, issue the slip;
 * take the fees of ordered tests so the lab / radiology can start them. */
export default function ReceptionPage() {
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [queue, setQueue] = useState<OpdQueueRow[]>([]);
  const [unpaid, setUnpaid] = useState<UnpaidOrderRow[]>([]);
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [registering, setRegistering] = useState(false);
  const [booking, setBooking] = useState(false);
  const [slip, setSlip] = useState<{ visit: BookedVisit; patient: HospitalPatient; doctor: Staff } | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  async function reload() {
    if (!isTauri()) return;
    const [p, d, q, u] = await Promise.all([
      hospitalPatientsRepo.list({ orderBy: "name ASC" }),
      listHospitalDoctors(),
      listOpdQueue({ date: localDate() }),
      listUnpaidOrders(),
    ]);
    setPatients(p);
    setDoctors(d);
    setQueue(q);
    setUnpaid(u);
  }
  useEffect(() => { void reload(); }, []);

  const selected = patients.find((p) => p.id === patientId) ?? null;
  const doctor = doctors.find((d) => d.id === doctorId) ?? null;
  const fee = Number(doctor?.consultation_fee) || 0;
  const term = search.trim().toLowerCase();
  const matches = term ? patients.filter((p) => p.name.toLowerCase().includes(term) || p.mr_no.toLowerCase().includes(term) || (p.phone ?? "").includes(term)).slice(0, 8) : [];

  async function book() {
    if (!selected || !doctor || booking) return;
    setBooking(true);
    try {
      const visit = await bookOpdVisit({ patientId: selected.id, doctorId: doctor.id, pay: fee > 0 ? { method } : null });
      setSlip({ visit, patient: selected, doctor });
      setPatientId("");
      setSearch("");
      await reload();
    } catch (e) {
      window.alert(`Could not book: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBooking(false);
    }
  }

  async function collect(o: UnpaidOrderRow) {
    if (payingId) return;
    if (!window.confirm(`Take Rs ${Number(o.fee).toFixed(0)} for ${o.name} (${o.patient_name})?`)) return;
    setPayingId(o.id);
    try {
      await payOrderFee(o.kind, o.id, method);
      await reload();
    } catch (e) {
      window.alert(`Could not take the fee: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPayingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Reception" actions={<Button onClick={() => void reload()}>Refresh</Button>} />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700">New OPD visit</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Patient *">
                {selected ? (
                  <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
                    <span><span className="font-medium">{selected.name}</span> <span className="text-xs text-neutral-500">{selected.mr_no}{selected.phone ? ` · ${selected.phone}` : ""}</span></span>
                    <button type="button" onClick={() => setPatientId("")} className="text-xs font-medium text-emerald-700 hover:underline">Change</button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, MR or phone…" />
                      <button type="button" title="Register a new patient" aria-label="Register a new patient" onClick={() => setRegistering(true)}
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white hover:bg-neutral-700">
                        <Plus size={16} />
                      </button>
                    </div>
                    {term && (
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-200">
                        {matches.length === 0 ? (
                          <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs text-neutral-400">No patients found.</span>
                            <button type="button" onClick={() => setRegistering(true)} className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white">
                              <Plus size={12} /> Register &ldquo;{search.trim()}&rdquo;
                            </button>
                          </div>
                        ) : matches.map((p) => (
                          <button key={p.id} type="button" onClick={() => { setPatientId(p.id); setSearch(""); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50">
                            <span className="font-medium">{p.name}</span> <span className="text-xs text-neutral-400">{p.mr_no} · {p.phone ?? ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Field>
            </div>
            <Field label="Doctor *">
              <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">— Select doctor —</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.designation}{d.specialization ? ` (${d.specialization})` : ""} · Rs {Number(d.consultation_fee ?? 0).toFixed(0)}
                  </option>
                ))}
              </Select>
              {doctors.length === 0 && <p className="mt-1 text-xs text-neutral-400">No doctors yet. Add them in HR Department &rsaquo; Staff with a doctor designation.</p>}
            </Field>
            <Field label="Payment">
              <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="online">Online transfer</option>
                <option value="bank">Bank deposit</option>
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => void book()} disabled={!selected || !doctor || booking}>
              {booking ? "Booking…" : fee > 0 ? `Book & collect Rs ${fee.toFixed(0)}` : "Book visit"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700">Slip</h2>
          {slip ? (
            <div id="opd-slip" className="space-y-1.5 text-sm">
              <p className="text-3xl font-bold tabular-nums">Token {slip.visit.token}</p>
              <p className="font-mono text-xs text-neutral-500">Slip {slip.visit.episode.episode_no}</p>
              <p><span className="text-neutral-500">Patient:</span> {slip.patient.name} ({slip.patient.mr_no})</p>
              <p><span className="text-neutral-500">Doctor:</span> {slip.doctor.name}</p>
              {slip.doctor.department && <p><span className="text-neutral-500">Department:</span> {slip.doctor.department}</p>}
              <p><span className="text-neutral-500">Fee:</span> Rs {slip.visit.fee.toFixed(0)} {slip.visit.paid >= slip.visit.fee ? "· Paid" : "· Unpaid"}</p>
              <div className="pt-2 print:hidden">
                <Button onClick={() => setReceiptFor(slip.visit.episode.id)}><Printer size={14} className="mr-1" /> Print slip</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-400">The slip of the next booking appears here.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700">Today&apos;s OPD ({queue.length})</h2>
          {queue.length === 0 ? <p className="text-sm text-neutral-400">No visits booked today.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
                  <th className="pb-1.5 pr-2 font-medium">Token</th><th className="pb-1.5 pr-2 font-medium">Patient</th>
                  <th className="pb-1.5 pr-2 font-medium">Doctor</th><th className="pb-1.5 pr-2 font-medium">Status</th><th className="pb-1.5 text-right font-medium">Due</th>
                </tr></thead>
                <tbody>
                  {queue.map((q) => (
                    <tr key={q.id} className="border-b border-neutral-50">
                      <td className="py-1.5 pr-2 font-bold tabular-nums">{q.token_no ?? "—"}</td>
                      <td className="py-1.5 pr-2">{q.patient_name}<div className="font-mono text-[11px] text-neutral-400">{q.episode_no}</div></td>
                      <td className="py-1.5 pr-2 text-neutral-600">{q.doctor_name ?? "—"}</td>
                      <td className="py-1.5 pr-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[q.consult_status ?? "waiting"] ?? ""}`}>{STATUS_LABEL[q.consult_status ?? "waiting"] ?? q.consult_status}</span></td>
                      <td className="py-1.5 text-right">
                        <button type="button" onClick={() => setReceiptFor(q.id)} title="Show the payment receipt"
                          className={`rounded px-1.5 py-0.5 tabular-nums underline-offset-2 hover:bg-amber-50 hover:underline ${q.charges - q.paid > 0 ? "font-medium text-rose-600" : "text-neutral-500"}`}>
                          {(q.charges - q.paid).toFixed(0)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
          <h2 className="mb-1 text-sm font-semibold text-neutral-700">Fees to collect ({unpaid.length})</h2>
          <p className="mb-3 text-xs text-neutral-500">Tests and scans ordered by doctors. The lab and radiology can start once the fee is taken.</p>
          {unpaid.length === 0 ? <p className="text-sm text-neutral-400">Nothing waiting for payment.</p> : (
            <div className="flex flex-col divide-y divide-neutral-100">
              {unpaid.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{o.name} <span className="text-xs font-normal text-neutral-400">{o.kind === "lab" ? "Lab" : "Radiology"} · {o.order_no}</span></p>
                    <p className="text-xs text-neutral-500">{o.patient_name} ({o.mr_no}) · {o.episode_no}{o.lab_no ? <> · Lab No <span className="font-mono">{o.lab_no}</span></> : null}</p>
                  </div>
                  <Button variant="primary" onClick={() => void collect(o)} disabled={payingId === o.id}>
                    {payingId === o.id ? "…" : `Take Rs ${Number(o.fee).toFixed(0)}`}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {receiptFor && <ReceiptModal episodeId={receiptFor} onClose={() => setReceiptFor(null)} onChanged={() => void reload()} />}
      {registering && (
        <PatientFormModal
          patient={null}
          initialName={search.trim()}
          onClose={() => setRegistering(false)}
          onSaved={(p) => {
            setRegistering(false);
            void reload().then(() => { if (p) { setPatientId(p.id); setSearch(""); } });
          }}
        />
      )}
    </div>
  );
}
