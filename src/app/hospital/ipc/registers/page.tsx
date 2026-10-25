"use client";

import { useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { hospitalPatientsRepo, type HospitalPatient } from "@/lib/repo/hospital";
import { listRegister, currentActor, roleAllowed } from "@/lib/repo/medicalRecord";
import { IPC_REGISTERS } from "@/config/forms/ipc";
import { FormEditor, FormStatusPill, fmtWhen } from "@/components/hospital/record/FormEditor";
import type { FormRecord } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";

/** IPC registers (MSDS IPC-1 Ind. 84-88, COP-5 Ind. 50). */
export default function IpcRegistersPage() {
  const [tab, setTab] = useState(IPC_REGISTERS[0].key);
  const def = IPC_REGISTERS.find((d) => d.key === tab)!;
  const [rows, setRows] = useState<FormRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rights, setRights] = useState({ create: false, finalize: false });
  const [open, setOpen] = useState<{ record: FormRecord | null; patient: HospitalPatient | null } | null>(null);
  const [mr, setMr] = useState("");

  async function reload() {
    if (!isTauri()) return;
    setError(null);
    try {
      const a = await currentActor();
      setRights({ create: roleAllowed(def.createRoles, a), finalize: roleAllowed(def.finalizeRoles, a) });
      setRows(await listRegister(def.key));
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [tab]);

  async function openNew() {
    let patient: HospitalPatient | null = null;
    if (def.key === "hai_case" && mr.trim()) {
      patient = (await hospitalPatientsRepo.list({ where: "mr_no = ?", params: [mr.trim()] }))[0] ?? null;
      if (!patient) return window.alert(`No patient with MR number ${mr.trim()}.`);
    }
    setOpen({ record: null, patient });
  }
  async function openRecord(r: FormRecord) {
    setOpen({ record: r, patient: r.patient_id ? await hospitalPatientsRepo.get(r.patient_id) : null });
  }

  // COP-5 Ind. 50: surgical site infections by month and surgeon, procedure, theatre.
  const ssi = def.key === "hai_case"
    ? rows.map((r) => JSON.parse(r.data) as Record<string, string>).filter((d) => d.infection_type === "Surgical site infection")
    : [];
  const ssiGroups = new Map<string, number>();
  for (const d of ssi) {
    const k = `${(d.onset_on ?? "").slice(0, 7)} | ${d.surgeon ?? "—"} | ${d.procedure ?? "—"} | ${d.theatre ?? "—"}`;
    ssiGroups.set(k, (ssiGroups.get(k) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader title="IPC Registers" />
      <div className="mb-4 flex flex-wrap gap-1 text-sm">
        {IPC_REGISTERS.map((d) => (
          <button key={d.key} type="button" onClick={() => setTab(d.key)} className={`rounded-full px-3 py-1 ${tab === d.key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}>{d.title}</button>
        ))}
      </div>
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-700">{def.title}</h2>
            <p className="text-[11px] text-neutral-400">MSDS {def.msds.join(", ")}{def.viewRoles ? " · restricted: IPC, senior nursing and HR read this register" : ""}</p>
          </div>
          {rights.create && (
            <div className="flex items-end gap-2">
              {def.key === "hai_case" && <div className="w-44"><Field label="Patient MR (optional)"><Input id="ipc-mr" value={mr} onChange={(e) => setMr(e.target.value)} placeholder="MR-000123" /></Field></div>}
              <Button variant="primary" onClick={() => void openNew()}><FilePlus2 size={13} className="mr-1" />New entry</Button>
            </div>
          )}
        </div>
        {error ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p> : rows.length === 0 ? <p className="text-sm text-neutral-400">No entries yet.</p> : (
          <div className="flex flex-col divide-y divide-neutral-100">
            {rows.map((r) => (
              <button key={r.id} type="button" onClick={() => void openRecord(r)} className="flex flex-wrap items-baseline gap-x-3 py-2 text-left text-sm hover:bg-neutral-50">
                <span className="tabular-nums text-xs text-neutral-500">{fmtWhen(r.created_at)}</span>
                <span className="min-w-0 flex-1 truncate">{r.summary ?? "—"}</span>
                <span className="text-xs text-neutral-500">{r.created_by_name}</span>
                <FormStatusPill status={r.status} />
              </button>
            ))}
          </div>
        )}
        {ssiGroups.size > 0 && (
          <div className="mt-4 overflow-x-auto border-t border-neutral-100 pt-3">
            <p className="mb-1 text-xs font-semibold text-neutral-600">Surgical site infections by month, surgeon, procedure and theatre (for the monthly analysis)</p>
            <table className="w-full min-w-[520px] text-xs">
              <thead><tr className="text-left text-neutral-500"><th className="pr-2 font-medium">Month</th><th className="pr-2 font-medium">Surgeon</th><th className="pr-2 font-medium">Procedure</th><th className="pr-2 font-medium">Theatre</th><th className="font-medium">Cases</th></tr></thead>
              <tbody>{[...ssiGroups.entries()].sort().reverse().map(([k, n]) => <tr key={k}>{k.split(" | ").map((c, i) => <td key={i} className="pr-2">{c}</td>)}<td className="tabular-nums">{n}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
      {open && (
        <FormEditor formKey={def.key} patient={open.patient} episode={null} record={open.record} canFinalize={rights.finalize}
          onClose={() => setOpen(null)} onSaved={() => void reload()} />
      )}
    </div>
  );
}
