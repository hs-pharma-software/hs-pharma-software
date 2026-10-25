"use client";

import { useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { hospitalEpisodesRepo, hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import { surgeryBookingsRepo } from "@/lib/repo/hospitalCare";
import { surgeryForms } from "@/lib/repo/medicalRecord";
import { availableSets, recordSetUsage, usageForSurgery, type AvailableSet, type UsageRow } from "@/lib/repo/cssd";
import { Select } from "@/components/ui/Field";
import { FormEditor, FormStatusPill, fmtWhen } from "./FormEditor";
import { VisitChecklist, VitalsPanel } from "./EpisodeRecord";
import type { FormDef } from "@/config/forms";
import type { FormRecord, HospitalEpisode, SurgeryBooking } from "@/lib/types-hospital";

type Row = { def: FormDef; records: FormRecord[]; canCreate: boolean; canFinalize: boolean };

/** Everything recorded for one surgery: assessments, consents, the safety
 * checklist, anaesthesia and recovery monitoring, operative note, post-op
 * plan and recovery discharge (MSDS COP-4, COP-5). */
export function TheatreRecord({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const [booking, setBooking] = useState<SurgeryBooking | null>(null);
  const [episode, setEpisode] = useState<HospitalEpisode | null>(null);
  const [patient, setPatient] = useState<HospitalPatient | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<{ key: string; record: FormRecord | null; canFinalize: boolean } | null>(null);
  const [tab, setTab] = useState<"forms" | "checklist" | "monitoring" | "sets">("forms");

  const loadForms = () => surgeryForms(bookingId).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    void (async () => {
      const b = await surgeryBookingsRepo.get(bookingId);
      setBooking(b);
      if (!b) return;
      const ep = await hospitalEpisodesRepo.get(b.episode_id);
      setEpisode(ep);
      if (ep) setPatient(await hospitalPatientsRepo.get(ep.patient_id));
      await loadForms();
    })();
  }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = rows.filter((r) => r.def.onePerEpisode && !r.records.some((x) => x.status !== "draft")).length;
  return (
    <Modal title={booking ? `Theatre record · ${booking.surgery_name}` : "Theatre record"} onClose={onClose} width="max-w-5xl">
      {!booking || !episode || !patient ? <p className="text-sm text-neutral-400">Loading…</p> : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
            <span><b className="text-neutral-800">{patient.name}</b> · {patient.mr_no}</span>
            <span className="font-mono">{episode.episode_no}</span>
            <span>{booking.planned_date ? `Planned ${booking.planned_date}` : "Date not set"} · {booking.status}</span>
            {patient.allergies && <span className="font-medium text-rose-600">Allergies: {patient.allergies}</span>}
            <span className={missing ? "text-amber-700" : "text-emerald-700"}>{missing ? `${missing} record(s) not signed yet` : "All records signed"}</span>
          </div>
          <div className="flex gap-1 text-sm">
            {([["forms", "Assessments, consents and notes"], ["checklist", "Safety checklist"], ["monitoring", "Anaesthesia and recovery"], ["sets", "Sterile sets used"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1 ${tab === k ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>{l}</button>
            ))}
          </div>

          {tab === "forms" && (
            <div className="flex flex-col divide-y divide-neutral-100 text-sm">
              {rows.map((r) => {
                const rec = r.records[0] ?? null;
                return (
                  <div key={r.def.key} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{r.def.title}</p>
                        <p className="text-[11px] text-neutral-400">
                          MSDS {r.def.msds.join(", ")}{r.def.requiresFinal ? ` · after ${r.def.requiresFinal.map((k) => rows.find((x) => x.def.key === k)?.def.title ?? k).join(" and ")}` : ""}
                        </p>
                      </div>
                      {r.def.onePerEpisode ? (
                        rec ? (
                          <div className="flex items-center gap-2"><FormStatusPill status={rec.status} /><Button variant="ghost" onClick={() => setOpen({ key: r.def.key, record: rec, canFinalize: r.canFinalize })}>Open</Button></div>
                        ) : r.canCreate ? (
                          <Button variant="ghost" onClick={() => setOpen({ key: r.def.key, record: null, canFinalize: r.canFinalize })}><FilePlus2 size={13} className="mr-1" />Write</Button>
                        ) : <span className="text-[11px] text-neutral-400">Not written</span>
                      ) : r.canCreate && <Button variant="ghost" onClick={() => setOpen({ key: r.def.key, record: null, canFinalize: r.canFinalize })}><FilePlus2 size={13} className="mr-1" />Report</Button>}
                    </div>
                    {!r.def.onePerEpisode && r.records.map((x) => (
                      <button key={x.id} type="button" onClick={() => setOpen({ key: r.def.key, record: x, canFinalize: r.canFinalize })} className="mt-1 flex w-full gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-neutral-50">
                        <span className="text-neutral-500">{fmtWhen(x.created_at)}</span><span>{x.summary}</span><FormStatusPill status={x.status} />
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {tab === "checklist" && <VisitChecklist episodeId={episode.id} checklistKey="surgical_safety" subjectId={booking.id} />}
          {tab === "monitoring" && (
            <div className="flex flex-col gap-4">
              <VitalsPanel episode={episode} phase="intra_op" subjectId={booking.id} title="During anaesthesia (heart rate, rhythm, BP, respiration, SpO2, airway)" />
              <VitalsPanel episode={episode} phase="recovery" subjectId={booking.id} title="Recovery (heart rate, BP, respiration, airway, consciousness, pain)" />
            </div>
          )}

          {tab === "sets" && <SterileSets bookingId={booking.id} />}

          {open && (
            <FormEditor formKey={open.key} patient={patient} episode={episode} record={open.record} canFinalize={open.canFinalize} subjectId={booking.id}
              onClose={() => setOpen(null)} onSaved={() => void loadForms()} />
          )}
        </div>
      )}
    </Modal>
  );
}

/** Instrument sets used in this surgery, traced to their sterilization load (MSDS IPC-2 Ind. 91-92). */
function SterileSets({ bookingId }: { bookingId: string }) {
  const [used, setUsed] = useState<UsageRow[]>([]);
  const [available, setAvailable] = useState<AvailableSet[]>([]);
  const [itemId, setItemId] = useState("");
  const load = async () => {
    setUsed(await usageForSurgery(bookingId));
    setAvailable(await availableSets());
  };
  useEffect(() => { void load().catch(() => undefined); }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add() {
    try {
      await recordSetUsage(bookingId, itemId);
      setItemId("");
      await load();
    } catch (e) {
      window.alert(`Could not record: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-neutral-500">Record each sterile set opened for this patient. Only sets from released, unexpired loads are offered; a recalled load lists this surgery for follow-up.</p>
      <div className="flex flex-wrap gap-2">
        <div className="min-w-72 flex-1">
          <Select id="set-pick" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">{available.length ? "— Choose a sterile set —" : "No released sets available"}</option>
            {available.map((a) => <option key={a.id} value={a.id}>{a.set_name}{a.set_code ? ` (${a.set_code})` : ""} · load ${a.equipment_code} ${a.cycle_no} · expires ${a.expires_on}</option>)}
          </Select>
        </div>
        <Button variant="primary" onClick={() => void add()} disabled={!itemId}>Record as used</Button>
      </div>
      {used.length === 0 ? <p className="text-neutral-400">No sets recorded.</p> : used.map((u) => (
        <p key={u.id} className={`text-xs ${u.cycle_status === "recalled" ? "font-medium text-rose-700" : ""}`}>
          {u.set_name}{u.set_code ? ` (${u.set_code})` : ""} · load {u.equipment_code} {u.cycle_no} · {fmtWhen(u.used_at)} · {u.recorded_by_name}{u.cycle_status === "recalled" ? " · LOAD RECALLED" : ""}
        </p>
      ))}
    </div>
  );
}
