"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { attendanceRepo } from "@/lib/repo/attendance";
import { staffRepo } from "@/lib/repo/staff";
import { isTauri, useIsTauri } from "@/lib/platform";
import type { Staff } from "@/lib/types";
import type { Attendance } from "@/lib/types2";

interface AttendanceRow extends Attendance {
  staff_name?: string;
}

function computeHours(timeIn: string, timeOut: string): number {
  if (!timeIn || !timeOut) return 0;
  const [inH, inM] = timeIn.split(":").map(Number);
  const [outH, outM] = timeOut.split(":").map(Number);
  const minutes = outH * 60 + outM - (inH * 60 + inM);
  return minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : 0;
}

export default function AttendancePage() {
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    if (!isTauri()) return;
    const [attendance, staff] = await Promise.all([
      attendanceRepo.list({ orderBy: "date DESC" }),
      staffRepo.list(),
    ]);
    const staffMap = new Map(staff.map((s) => [s.id, s.name]));
    setRows(attendance.map((a) => ({ ...a, staff_name: staffMap.get(a.staff_id) })));
    setStaffList(staff);
  }

  useEffect(() => {
    void reload();
  }, []);

  const totalHours = rows.reduce((sum, r) => sum + r.hours, 0);

  const columns: Column<AttendanceRow>[] = [
    { header: "Employee Name", render: (r) => r.staff_name ?? "â€”" },
    { header: "Date Of Attendance", render: (r) => r.date },
    { header: "Time In", render: (r) => r.time_in ?? "â€”" },
    { header: "Time Out", render: (r) => r.time_out ?? "â€”" },
    { header: "Hours", render: (r) => r.hours.toFixed(2) },
  ];

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader
        title="Attendance Detail"
        actions={
          <>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              Add
            </Button>
            <Button onClick={() => void reload()}>Refresh</Button>
          </>
        }
      />

      {!tauriReady ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Run inside the desktop app to record attendance.
        </p>
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <div className="mt-3 flex justify-end rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] px-5 py-2.5 text-sm">
            <span className="font-medium text-neutral-700">Total Hours: {totalHours.toFixed(2)}</span>
          </div>
        </>
      )}

      {modalOpen && (
        <Modal title="-:Add Attendance:-" onClose={() => setModalOpen(false)} width="max-w-md">
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!staffId) return;
              setSaving(true);
              try {
                await attendanceRepo.create({
                  staff_id: staffId,
                  date,
                  time_in: timeIn || null,
                  time_out: timeOut || null,
                  hours: computeHours(timeIn, timeOut),
                });
                setModalOpen(false);
                void reload();
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Employee Name" required>
              <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} required autoFocus>
                <option value="">Select...</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Time In" required>
                <Input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} required />
              </Field>
              <Field label="Time Out">
                <Input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-200 pt-3">
              <Button type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

