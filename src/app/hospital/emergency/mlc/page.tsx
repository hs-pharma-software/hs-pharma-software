"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { listMlc, type MlcRow } from "@/lib/repo/emergency";
import { MlcModal } from "@/components/hospital/record/EmergencyPanel";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { MlcCase } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const STATUS: Record<MlcCase["status"], [string, string]> = {
  open: ["Open", "bg-amber-100 text-amber-800"], report_issued: ["Report issued", "bg-sky-100 text-sky-700"], closed: ["Closed", "bg-neutral-200 text-neutral-700"],
};

/** Medico-legal case register. A case is registered by the doctor from the patient's visit. */
export default function MlcRegisterPage() {
  const [rows, setRows] = useState<MlcRow[]>([]);
  const [status, setStatus] = useState<MlcCase["status"] | "">("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<MlcRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listMlc({ status, search })); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status, search]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <PageHeader title="MLC Register" />
      <div className={card}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="Search"><Input id="mlc-q" value={search} placeholder="MLC no, patient, MR no, police station" onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Status">
            <Select id="mlc-st" value={status} onChange={(e) => setStatus(e.target.value as MlcCase["status"] | "")}>
              <option value="">All</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <p className="pb-2 text-[11px] text-neutral-400">Register a new case from the patient&apos;s emergency visit.</p>
        </div>
        {rows.length === 0 ? <p className="text-sm text-neutral-400">No medico-legal cases.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>MLC no</th><th className={th}>Patient</th><th className={th}>Nature</th><th className={th}>Arrived</th><th className={th}>Police</th><th className={th}>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                    <td className={`${td} font-mono text-xs`}>{r.mlc_no}</td>
                    <td className={td}>
                      <Link className="hover:underline" href={`/hospital/episodes/view?id=${r.episode_id}`} onClick={(e) => e.stopPropagation()}>{r.patient_name}</Link>
                      <span className="block text-xs text-neutral-500">{r.mr_no} · {r.episode_no}</span>
                    </td>
                    <td className={td}>{r.nature}</td>
                    <td className={`${td} tabular-nums`}>{fmtWhen(r.arrived_at)}</td>
                    <td className={td}>{r.police_informed_at ? `${r.police_station}${r.police_ref ? ` · ${r.police_ref}` : ""}` : <span className="text-rose-700">Not informed</span>}</td>
                    <td className={td}><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <MlcModal episode={null} mlc={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}
