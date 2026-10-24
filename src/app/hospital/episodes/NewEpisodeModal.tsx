"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  hospitalPatientsRepo, hospitalEpisodesRepo, hospitalDepartmentsRepo, nextEpisodeNo,
  type HospitalPatient, type HospitalDepartment,
} from "@/lib/repo/hospital";
import type { EpisodeType } from "@/lib/types-hospital";
import PatientFormModal from "../patients/PatientFormModal";
import { localDate } from "@/lib/localDate";

interface Props {
  defaultType: EpisodeType;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export default function NewEpisodeModal({ defaultType, onClose, onSaved }: Props) {
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [departments, setDepartments] = useState<HospitalDepartment[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [registering, setRegistering] = useState(false);
  const [type, setType] = useState<EpisodeType>(defaultType);
  const [episodeNo, setEpisodeNo] = useState("");
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void hospitalPatientsRepo.list({ orderBy: "name ASC" }).then(setPatients);
    void hospitalDepartmentsRepo.list({ orderBy: "name ASC" }).then((all) => setDepartments(all.filter((d) => d.is_active)));
  }, []);

  // The number follows the type and the date; it is assigned, never typed.
  useEffect(() => {
    void nextEpisodeNo(type, date).then(setEpisodeNo);
  }, [type, date]);

  const selected = patients.find((p) => p.id === patientId) ?? null;
  const term = patientSearch.trim().toLowerCase();
  const filteredPatients = term
    ? patients.filter((p) => p.name.toLowerCase().includes(term) || p.mr_no.toLowerCase().includes(term) || (p.phone ?? "").includes(term))
    : [];

  function pick(p: HospitalPatient) {
    setPatientId(p.id);
    setPatientSearch("");
  }

  async function patientRegistered(p?: HospitalPatient) {
    setRegistering(false);
    const fresh = await hospitalPatientsRepo.list({ orderBy: "name ASC" });
    setPatients(fresh);
    if (p) pick(p);
  }

  async function save() {
    if (!patientId || saving) return;
    setSaving(true);
    try {
      // Take a fresh number at the moment of saving, so two open windows never share one.
      const number = await nextEpisodeNo(type, date);
      const ep = await hospitalEpisodesRepo.create({
        episode_no: number,
        type,
        patient_id: patientId,
        doctor_id: null,
        department: department.trim() || null,
        date,
        time: time || null,
        status: "open",
        room_ward: null,
        bed_no: null,
        admission_date: type === "ipd" ? date : null,
        discharge_date: null,
        diagnosis: null,
        notes: notes.trim() || null,
      });
      onSaved(ep.id);
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal title="New Episode" onClose={onClose}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <Field label="Episode Type *">
            <Select value={type} onChange={(e) => setType(e.target.value as EpisodeType)}>
              <option value="opd">OPD</option>
              <option value="ipd">IPD (Admission)</option>
              <option value="emergency">Emergency</option>
            </Select>
          </Field>
          <Field label="Episode No (assigned automatically)">
            <Input value={episodeNo} readOnly tabIndex={-1} className="bg-neutral-50 font-mono text-neutral-500" />
          </Field>
          <Field label="Date *">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>

          <div className="md:col-span-2">
            <Field label="Patient *">
              {selected ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
                  <span>
                    <span className="font-medium text-neutral-800">{selected.name}</span>
                    <span className="ml-2 text-xs text-neutral-500">{selected.mr_no}{selected.phone ? ` · ${selected.phone}` : ""}</span>
                  </span>
                  <button type="button" onClick={() => setPatientId("")} className="text-xs font-medium text-emerald-700 hover:underline">Change</button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      placeholder="Search patient by name, MR, phone…"
                    />
                    <button
                      type="button"
                      title="Register a new patient"
                      aria-label="Register a new patient"
                      onClick={() => setRegistering(true)}
                      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white transition hover:bg-neutral-700"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  {term && (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-200">
                      {filteredPatients.length === 0 ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                          <p className="text-xs text-neutral-400">No patients found.</p>
                          <button
                            type="button"
                            onClick={() => setRegistering(true)}
                            className="inline-flex items-center gap-1 rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700"
                          >
                            <Plus size={12} /> Register &ldquo;{patientSearch.trim()}&rdquo;
                          </button>
                        </div>
                      ) : (
                        filteredPatients.slice(0, 10).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => pick(p)}
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-amber-50"
                          >
                            <span className="font-medium">{p.name}</span>
                            <span className="ml-2 text-xs text-neutral-400">{p.mr_no} · {p.phone ?? ""}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </Field>
          </div>

          <Field label="Department">
            <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">— Select department —</option>
              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </Select>
            {departments.length === 0 && (
              <p className="mt-1 text-xs text-neutral-400">
                No departments yet. <Link href="/hospital/departments" className="text-amber-700 underline">Add departments</Link>.
              </p>
            )}
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !patientId}>
            {saving ? "Opening…" : "Open Episode"}
          </Button>
        </div>
      </Modal>

      {registering && (
        <PatientFormModal
          patient={null}
          initialName={patientSearch.trim()}
          onClose={() => setRegistering(false)}
          onSaved={(p) => void patientRegistered(p)}
        />
      )}
    </>
  );
}
