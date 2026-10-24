"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { hospitalPatientsRepo, hospitalEpisodesRepo, nextEpisodeNo, type HospitalPatient } from "@/lib/repo/hospital";
import type { EpisodeType } from "@/lib/types-hospital";

interface Props {
  defaultType: EpisodeType;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export default function NewEpisodeModal({ defaultType, onClose, onSaved }: Props) {
  const [patients, setPatients] = useState<HospitalPatient[]>([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [type, setType] = useState<EpisodeType>(defaultType);
  const [episodeNo, setEpisodeNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void hospitalPatientsRepo.list({ orderBy: "name ASC" }).then(setPatients);
  }, []);

  useEffect(() => {
    void nextEpisodeNo(type).then(setEpisodeNo);
  }, [type]);

  const filteredPatients = patientSearch.trim()
    ? patients.filter((p) =>
        p.name.toLowerCase().includes(patientSearch.toLowerCase()) ||
        p.mr_no.toLowerCase().includes(patientSearch.toLowerCase()) ||
        (p.phone ?? "").includes(patientSearch)
      )
    : patients;

  async function save() {
    if (!patientId || !episodeNo.trim()) return;
    setSaving(true);
    try {
      const ep = await hospitalEpisodesRepo.create({
        episode_no: episodeNo.trim(),
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
    <Modal title="New Episode" onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label="Episode Type *">
          <Select value={type} onChange={(e) => setType(e.target.value as EpisodeType)}>
            <option value="opd">OPD</option>
            <option value="ipd">IPD (Admission)</option>
            <option value="emergency">Emergency</option>
          </Select>
        </Field>
        <Field label="Episode No">
          <Input value={episodeNo} onChange={(e) => setEpisodeNo(e.target.value)} />
        </Field>
        <Field label="Date *">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Time">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Patient *">
            <Input
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="Search patient by name, MR, phone…"
              className="mb-2"
            />
            {patientSearch.trim() && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-neutral-200">
                {filteredPatients.length === 0 ? (
                  <p className="text-xs text-neutral-400 px-3 py-2">No patients found.</p>
                ) : (
                  filteredPatients.slice(0, 10).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setPatientId(p.id); setPatientSearch(`${p.name} (${p.mr_no})`); }}
                      className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-amber-50 ${patientId === p.id ? "bg-amber-50 font-medium" : ""}`}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-neutral-400">{p.mr_no} · {p.phone ?? ""}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            {patientId && !patientSearch.includes("(") && (
              <p className="text-xs text-amber-600 mt-1">Patient selected. Clear to change.</p>
            )}
          </Field>
        </div>
        <Field label="Department">
          <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. General Medicine" />
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
  );
}
