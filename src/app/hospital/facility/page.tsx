"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  listEquipment, saveEquipment, equipmentLogs, recordEquipmentLog, returnToService, condemnEquipment, listLicences, saveLicence, renewLicence,
  listDrills, recordDrill, drillSchedule, type EquipmentRow, type LicenceRow, type DueState, type EquipmentInput, type LicenceInput,
} from "@/lib/repo/facility";
import { EQUIPMENT_CATEGORIES, EQUIPMENT_LOG_KINDS, LICENCE_KINDS, DRILL_KINDS, SHIFTS, drillLabel, type EquipmentLogKind } from "@/config/facility";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { Drill, EquipmentLog } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const pill = (label: string, cls: string) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
const DUE: Record<DueState, [string, string]> = {
  ok: ["In date", "bg-emerald-100 text-emerald-700"], soon: ["Due soon", "bg-amber-100 text-amber-800"], overdue: ["Overdue", "bg-rose-100 text-rose-700"],
  never: ["Never done", "bg-rose-100 text-rose-700"], na: ["Not scheduled", "bg-neutral-100 text-neutral-500"],
};
const dueCell = (d: { due: string | null; state: DueState; last: string | null }) => (
  <>{pill(DUE[d.state][0], DUE[d.state][1])}{d.due ? <span className="block text-[11px] text-neutral-500">due {d.due}</span> : null}</>
);
const STATUS: Record<EquipmentRow["status"], [string, string]> = {
  in_service: ["In service", "bg-emerald-100 text-emerald-700"], out_of_service: ["Out of service", "bg-rose-600 text-white"], condemned: ["Condemned", "bg-neutral-200 text-neutral-600"],
};

type Tab = "equipment" | "licences" | "drills";

/** Facility management and safety (MSDS FMS, ROM). */
export default function FacilityPage() {
  const [tab, setTab] = useState<Tab>("equipment");
  return (
    <div>
      <PageHeader title="Facility" actions={
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {([["equipment", "Equipment"], ["licences", "Licences"], ["drills", "Mock drills"]] as const).map(([t, l]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-rose-700 text-white" : "bg-white text-neutral-600"}`}>{l}</button>
          ))}
        </div>
      } />
      {tab === "equipment" && <EquipmentTab />}
      {tab === "licences" && <LicencesTab />}
      {tab === "drills" && <DrillsTab />}
    </div>
  );
}

// ── Equipment ─────────────────────────────────────────────────────────────

function EquipmentTab() {
  const [rows, setRows] = useState<EquipmentRow[]>([]);
  const [status, setStatus] = useState<"active" | "" | EquipmentRow["status"]>("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EquipmentRow | "new" | null>(null);
  const [open, setOpen] = useState<EquipmentRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try {
      const list = await listEquipment({ status, search });
      setRows(list);
      setOpen((o) => (o ? list.find((x) => x.id === o.id) ?? null : null));
    } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const late = rows.filter((r) => r.status !== "condemned" && (["overdue", "never"].includes(r.ppm.state) || ["overdue", "never"].includes(r.calibration.state))).length;
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Search"><Input id="eq-q" value={search} placeholder="Asset no, name, serial, location" onChange={(e) => setSearch(e.target.value)} /></Field>
        <Field label="Status">
          <Select id="eq-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">In use (not condemned)</option><option value="">All</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        {late > 0 && <p className="pb-2 text-xs font-medium text-rose-700">{late} item(s) with maintenance or calibration overdue.</p>}
        <div className="ml-auto"><Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />Add equipment</Button></div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No equipment registered.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Asset</th><th className={th}>Equipment</th><th className={th}>Where</th><th className={th}>Maintenance</th><th className={th}>Calibration</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                  <td className={`${td} font-mono text-xs`}>{r.asset_no}{r.is_critical ? <span className="ml-1 rounded bg-rose-50 px-1 text-[10px] font-semibold text-rose-700">CRITICAL</span> : null}</td>
                  <td className={td}>{r.name}<span className="block text-xs text-neutral-500">{[r.make, r.model, r.serial_no && `S/N ${r.serial_no}`].filter(Boolean).join(" · ")}</span></td>
                  <td className={td}>{[r.department, r.location].filter(Boolean).join(" · ") || "—"}</td>
                  <td className={td}>{dueCell(r.ppm)}</td>
                  <td className={td}>{dueCell(r.calibration)}</td>
                  <td className={td}>{pill(STATUS[r.status][0], STATUS[r.status][1])}{r.breakdown_open ? <span className="block text-[11px] text-rose-700">Breakdown open</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <EquipmentModal row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {open && <EquipmentDetail row={open} onClose={() => setOpen(null)} onEdit={() => { setEditing(open); setOpen(null); }} onChanged={reload} />}
    </div>
  );
}

function EquipmentModal({ row, onClose, onSaved }: { row: EquipmentRow | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    assetNo: row?.asset_no ?? "", name: row?.name ?? "", category: row?.category ?? "", make: row?.make ?? "", model: row?.model ?? "", serialNo: row?.serial_no ?? "",
    department: row?.department ?? "", location: row?.location ?? "", supplier: row?.supplier ?? "", purchasedOn: row?.purchased_on ?? "",
    warrantyUntil: row?.warranty_until ?? "", amcVendor: row?.amc_vendor ?? "", amcUntil: row?.amc_until ?? "", isCritical: !!row?.is_critical,
    ppm: row?.ppm_interval_days ? String(row.ppm_interval_days) : "", cal: row?.calibration_interval_days ? String(row.calibration_interval_days) : "", notes: row?.notes ?? "",
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const input: EquipmentInput = { ...v, ppmIntervalDays: v.ppm ? Number(v.ppm) : null, calibrationIntervalDays: v.cal ? Number(v.cal) : null };
    try { await saveEquipment(row?.id ?? null, input); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title={row ? `Edit ${row.asset_no}` : "Add equipment"} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required><Input id="eq-name" value={v.name} onChange={set("name")} /></Field>
        <Field label="Category" required><Select id="eq-cat" value={v.category} onChange={set("category")}><option value="">Choose…</option>{EQUIPMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Asset number"><Input id="eq-asset" value={v.assetNo} placeholder={row ? "" : "Given automatically if empty"} onChange={set("assetNo")} /></Field>
        <Field label="Serial number"><Input id="eq-sn" value={v.serialNo} onChange={set("serialNo")} /></Field>
        <Field label="Make"><Input id="eq-make" value={v.make} onChange={set("make")} /></Field>
        <Field label="Model"><Input id="eq-model" value={v.model} onChange={set("model")} /></Field>
        <Field label="Department"><Input id="eq-dept" value={v.department} onChange={set("department")} /></Field>
        <Field label="Location"><Input id="eq-loc" value={v.location} onChange={set("location")} /></Field>
        <Field label="Supplier"><Input id="eq-sup" value={v.supplier} onChange={set("supplier")} /></Field>
        <Field label="Purchased on"><Input id="eq-bought" type="date" value={v.purchasedOn} onChange={set("purchasedOn")} /></Field>
        <Field label="Warranty until"><Input id="eq-war" type="date" value={v.warrantyUntil} onChange={set("warrantyUntil")} /></Field>
        <Field label="Maintenance contract (AMC / CMC) with"><Input id="eq-amc" value={v.amcVendor} onChange={set("amcVendor")} /></Field>
        <Field label="Contract until"><Input id="eq-amcu" type="date" value={v.amcUntil} onChange={set("amcUntil")} /></Field>
        <Field label="Preventive maintenance every (days)"><Input id="eq-ppm" inputMode="numeric" value={v.ppm} placeholder="180" onChange={set("ppm")} /></Field>
        <Field label="Calibration every (days)"><Input id="eq-cal" inputMode="numeric" value={v.cal} placeholder="365" onChange={set("cal")} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input id="eq-crit" type="checkbox" checked={v.isCritical} onChange={(e) => setV({ ...v, isCritical: e.target.checked })} />Critical (life support / patient safety)</label>
      </div>
      <div className="mt-3"><Field label="Notes"><Textarea id="eq-notes" rows={2} value={v.notes} onChange={set("notes")} /></Field></div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
    </Modal>
  );
}

function EquipmentDetail({ row, onClose, onEdit, onChanged }: { row: EquipmentRow; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void> }) {
  const [logs, setLogs] = useState<EquipmentLog[]>([]);
  const [v, setV] = useState({ kind: "ppm" as EquipmentLogKind, performedOn: localDate(), performedBy: "", result: "pass" as "pass" | "fail", certificateRef: "", description: "" });
  const load = () => equipmentLogs(row.id).then(setLogs).catch(() => undefined);
  useEffect(() => { void load(); }, [row.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: () => Promise<unknown>) => { try { await f(); await load(); await onChanged(); } catch (e) { err(e); } };
  const periodic = v.kind === "ppm" || v.kind === "calibration";
  const record = () => run(async () => {
    await recordEquipmentLog(row.id, { ...v, result: periodic ? v.result : null });
    setV({ ...v, performedBy: "", certificateRef: "", description: "" });
  });
  return (
    <Modal title={`${row.asset_no} ${row.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {pill(STATUS[row.status][0], STATUS[row.status][1])}
          <span className="text-xs text-neutral-500">{row.category}{row.warranty_until ? ` · warranty until ${row.warranty_until}` : ""}{row.amc_vendor ? ` · contract ${row.amc_vendor}${row.amc_until ? ` until ${row.amc_until}` : ""}` : ""}</span>
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" onClick={onEdit}>Edit</Button>
            {row.status === "out_of_service" && <Button onClick={() => run(() => returnToService(row.id))}>Return to service</Button>}
            {row.status !== "condemned" && <Button variant="ghost" onClick={() => { const r = window.prompt("Reason for condemning this equipment"); if (r) void run(() => condemnEquipment(row.id, r)); }}>Condemn</Button>}
          </div>
        </div>
        {row.status !== "condemned" && (
          <section className="rounded-xl bg-neutral-50 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Record"><Select id="log-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as EquipmentLogKind })}>{Object.entries(EQUIPMENT_LOG_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Date"><Input id="log-d" type="date" value={v.performedOn} onChange={(e) => setV({ ...v, performedOn: e.target.value })} /></Field>
              {v.kind !== "breakdown" && <Field label="Done by"><Input id="log-by" value={v.performedBy} placeholder="Engineer / company" onChange={(e) => setV({ ...v, performedBy: e.target.value })} /></Field>}
              {periodic && <Field label="Result"><Select id="log-r" value={v.result} onChange={(e) => setV({ ...v, result: e.target.value as "pass" | "fail" })}><option value="pass">Pass</option><option value="fail">Fail (takes it out of service)</option></Select></Field>}
              {periodic && <Field label="Certificate / report no"><Input id="log-c" value={v.certificateRef} onChange={(e) => setV({ ...v, certificateRef: e.target.value })} /></Field>}
            </div>
            <div className="mt-2"><Field label={v.kind === "breakdown" ? "Fault" : "Work done / findings"}><Textarea id="log-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field></div>
            <div className="mt-2 flex justify-end"><Button variant="primary" onClick={record}>Record</Button></div>
          </section>
        )}
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">History</h3>
          {logs.length === 0 ? <p className="text-xs text-neutral-400">Nothing recorded yet.</p> : logs.map((l) => (
            <p key={l.id} className="border-t border-neutral-100 py-1 text-xs">
              <b>{l.performed_on}</b> · {EQUIPMENT_LOG_KINDS[l.kind]}{l.result ? ` · ${l.result === "pass" ? "Pass" : "FAIL"}` : ""}{l.performed_by ? ` · ${l.performed_by}` : ""}
              {l.certificate_ref ? ` · ${l.certificate_ref}` : ""}{l.kind === "breakdown" ? (l.restored_on ? ` · repaired ${l.restored_on}` : " · open") : ""}
              {l.description ? <span className="block text-neutral-500">{l.description}</span> : null}
            </p>
          ))}
        </section>
      </div>
    </Modal>
  );
}

// ── Licences ──────────────────────────────────────────────────────────────

const LIC: Record<LicenceRow["state"], [string, string]> = {
  valid: ["Valid", "bg-emerald-100 text-emerald-700"], expiring: ["Expiring soon", "bg-amber-100 text-amber-800"], expired: ["Expired", "bg-rose-600 text-white"], no_expiry: ["No expiry", "bg-neutral-100 text-neutral-600"],
};

function LicencesTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof listLicences>> | null>(null);
  const [editing, setEditing] = useState<{ row: LicenceRow | null; renew: boolean } | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setData(await listLicences()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {data && data.missing.length > 0 && <p className="text-xs text-rose-700">Not recorded: {data.missing.join(" · ")}</p>}
        <div className="ml-auto"><Button variant="primary" onClick={() => setEditing({ row: null, renew: false })}><Plus size={14} />Add licence</Button></div>
      </div>
      {!data || data.current.length === 0 ? <p className="text-sm text-neutral-400">No licences recorded.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Licence / certificate</th><th className={th}>Number</th><th className={th}>Issued by</th><th className={th}>Expires</th><th className={th}>Responsible</th><th className={th}></th></tr></thead>
            <tbody>
              {data.current.map((l) => (
                <tr key={l.id} className="border-t border-neutral-100">
                  <td className={td}>{l.label}</td>
                  <td className={`${td} font-mono text-xs`}>{l.number}</td>
                  <td className={td}>{l.issued_by ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{l.expires_on ?? "—"} {pill(LIC[l.state][0], LIC[l.state][1])}{l.days_left !== null && l.days_left >= 0 ? <span className="block text-[11px] text-neutral-500">{l.days_left} days left</span> : null}</td>
                  <td className={td}>{l.responsible ?? "—"}</td>
                  <td className={td}><div className="flex gap-1"><Button variant="ghost" onClick={() => setEditing({ row: l, renew: false })}>Edit</Button><Button onClick={() => setEditing({ row: l, renew: true })}>Renew</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.history.length > 0 && <p className="mt-3 text-xs text-neutral-500">{data.history.length} earlier licence(s) kept in the history after renewal.</p>}
      {editing && <LicenceModal row={editing.row} renew={editing.renew} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function LicenceModal({ row, renew, onClose, onSaved }: { row: LicenceRow | null; renew: boolean; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<LicenceInput>(renew || !row
    ? { kind: row?.kind ?? "", number: "", issuedBy: row?.issued_by ?? "", issuedOn: "", expiresOn: "", responsible: row?.responsible ?? "", documentRef: "", notes: "" }
    : { kind: row.kind, number: row.number, issuedBy: row.issued_by, issuedOn: row.issued_on, expiresOn: row.expires_on, responsible: row.responsible, documentRef: row.document_ref, notes: row.notes });
  const set = (k: keyof LicenceInput) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    try { await (renew && row ? renewLicence(row.id, v) : saveLicence(row?.id ?? null, v)); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title={renew ? `Renew: ${row?.label}` : row ? "Edit licence" : "Add licence"} onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        <Field label="Licence / certificate" required>
          <Select id="lic-k" disabled={!!row} value={v.kind} onChange={set("kind")}><option value="">Choose…</option>{LICENCE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Number" required><Input id="lic-no" value={v.number ?? ""} onChange={set("number")} /></Field>
          <Field label="Issued by"><Input id="lic-by" value={v.issuedBy ?? ""} onChange={set("issuedBy")} /></Field>
          <Field label="Issued on"><Input id="lic-on" type="date" value={v.issuedOn ?? ""} onChange={set("issuedOn")} /></Field>
          <Field label="Expires on"><Input id="lic-exp" type="date" value={v.expiresOn ?? ""} onChange={set("expiresOn")} /></Field>
          <Field label="Responsible person"><Input id="lic-resp" value={v.responsible ?? ""} onChange={set("responsible")} /></Field>
          <Field label="File / copy reference"><Input id="lic-doc" value={v.documentRef ?? ""} onChange={set("documentRef")} /></Field>
        </div>
        <Field label="Notes"><Textarea id="lic-notes" rows={2} value={v.notes ?? ""} onChange={set("notes")} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{renew ? "Record renewal" : "Save"}</Button></div>
    </Modal>
  );
}

// ── Drills ────────────────────────────────────────────────────────────────

function DrillsTab() {
  const [drills, setDrills] = useState<Drill[]>([]);
  const [sched, setSched] = useState<Awaited<ReturnType<typeof drillSchedule>>>([]);
  const [adding, setAdding] = useState(false);
  const reload = async () => {
    if (!isTauri()) return;
    try { setDrills(await listDrills()); setSched(await drillSchedule()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-700">Schedule</h2>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} />Record drill</Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sched.map((d) => (
            <div key={d.key} className="rounded-xl bg-neutral-50 p-3 text-sm">
              <p className="font-medium">{d.label}</p>
              <p className="mt-1 text-xs text-neutral-500">Every {d.everyDays} days · last {d.last ?? "never"}{d.due ? ` · next by ${d.due}` : ""}</p>
              <div className="mt-1">{pill(DUE[d.state][0], DUE[d.state][1])}</div>
            </div>
          ))}
        </div>
      </div>
      <div className={card}>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Drills held</h2>
        {drills.length === 0 ? <p className="text-sm text-neutral-400">No drills recorded.</p> : drills.map((d) => (
          <div key={d.id} className="border-t border-neutral-100 py-2 text-sm">
            <p><b>{d.held_on}</b> · {drillLabel(d.kind)} · {d.location}{d.shift ? ` · ${d.shift}` : ""}{d.participants ? ` · ${d.participants} took part` : ""}{d.response_min != null ? ` · response ${d.response_min} min` : ""}</p>
            <p className="text-xs text-neutral-600">{d.observations}</p>
            {d.gaps && <p className="text-xs text-rose-700">Gaps: {d.gaps} <span className="text-neutral-500">(raise a corrective action in Quality & Safety)</span></p>}
          </div>
        ))}
      </div>
      {adding && <DrillModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
    </div>
  );
}

function DrillModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ kind: "", heldOn: localDate(), shift: "", location: "", scenario: "", participants: "", responseMin: "", observations: "", gaps: "", conductedBy: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    try {
      await recordDrill({ ...v, participants: v.participants ? Number(v.participants) : null, responseMin: v.responseMin ? Number(v.responseMin) : null });
      onSaved();
    } catch (e) { err(e); }
  };
  return (
    <Modal title="Record a mock drill" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Drill" required><Select id="dr-k" value={v.kind} onChange={set("kind")}><option value="">Choose…</option>{DRILL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></Field>
        <Field label="Held on" required><Input id="dr-on" type="date" value={v.heldOn} onChange={set("heldOn")} /></Field>
        <Field label="Shift"><Select id="dr-sh" value={v.shift} onChange={set("shift")}><option value="">—</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Where" required><Input id="dr-loc" value={v.location} onChange={set("location")} /></Field>
        <Field label="People taking part"><Input id="dr-n" inputMode="numeric" value={v.participants} onChange={set("participants")} /></Field>
        <Field label="Response time (minutes)"><Input id="dr-rt" inputMode="numeric" value={v.responseMin} onChange={set("responseMin")} /></Field>
        <Field label="Conducted by"><Input id="dr-by" value={v.conductedBy} onChange={set("conductedBy")} /></Field>
      </div>
      <div className="mt-3 grid gap-3">
        <Field label="Scenario"><Input id="dr-sc" value={v.scenario} onChange={set("scenario")} /></Field>
        <Field label="What was observed" required><Textarea id="dr-obs" rows={3} value={v.observations} onChange={set("observations")} /></Field>
        <Field label="Gaps found"><Textarea id="dr-gaps" rows={2} value={v.gaps} onChange={set("gaps")} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record</Button></div>
    </Modal>
  );
}
