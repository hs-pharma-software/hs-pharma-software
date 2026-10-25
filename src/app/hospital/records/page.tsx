"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  recordCompleteness, listReleases, requestRelease, decideRelease, recordRelease, findPatients, REQUESTER_TYPES, AUTHORITY, type ReleaseRow,
} from "@/lib/repo/records";
import { addDays } from "@/lib/repo/facility";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { RecordRelease } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const pill = (label: string, cls: string) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;

/** Medical records (MSDS IMS): record completeness and release of information. */
export default function RecordsPage() {
  const [tab, setTab] = useState<"complete" | "release">("complete");
  return (
    <div>
      <PageHeader title="Medical Records" actions={
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {([["complete", "Record completeness"], ["release", "Release of information"]] as const).map(([t, l]) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-rose-700 text-white" : "bg-white text-neutral-600"}`}>{l}</button>
          ))}
        </div>
      } />
      {tab === "complete" ? <Completeness /> : <Releases />}
    </div>
  );
}

function Completeness() {
  const [from, setFrom] = useState(() => addDays(localDate(), -30));
  const [to, setTo] = useState(localDate());
  const [onlyGaps, setOnlyGaps] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof recordCompleteness>> | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void recordCompleteness({ from, to }).then(setData).catch(err);
  }, [from, to]);
  const rows = data?.rows.filter((r) => !onlyGaps || r.missing.length) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <Field label="Discharged from"><Input id="rc-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input id="rc-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <p className="pb-2 text-[11px] text-neutral-500">Worked out from the signed forms of each discharged admission. A draft counts as missing until it is signed.</p>
        </div>
        {data && (data.rows.length === 0 ? <p className="text-sm text-neutral-400">No admissions discharged in this period.</p> : (
          <div className="flex flex-col gap-3">
            <p className="text-sm"><b className="text-2xl tabular-nums">{data.completePct}%</b> <span className="text-neutral-600">of {data.rows.length} discharged records complete</span></p>
            <div className="flex flex-col gap-1.5">
              {data.byItem.filter((i) => i.applicable).map((i) => (
                <div key={i.key} className="flex items-center gap-2 text-xs">
                  <span className="w-72 shrink-0">{i.label}</span>
                  <div className="h-2 flex-1 rounded-full bg-neutral-100"><div className={`h-2 rounded-full ${(i.pct ?? 0) >= 90 ? "bg-emerald-600" : "bg-rose-600"}`} style={{ width: `${i.pct ?? 0}%` }} /></div>
                  <span className="w-24 text-right tabular-nums">{i.complete}/{i.applicable} · {i.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {data && data.rows.length > 0 && (
        <div className={card}>
          <label className="mb-3 flex items-center gap-2 text-sm"><input id="rc-gaps" type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />Only records with gaps</label>
          {rows.length === 0 ? <p className="text-sm text-neutral-400">Every record in this period is complete.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Patient</th><th className={th}>Discharged</th><th className={th}>Department</th><th className={th}>Missing or unsigned</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.episode_id} className="border-t border-neutral-100">
                      <td className={td}><Link className="hover:underline" href={`/hospital/episodes/view?id=${r.episode_id}`}>{r.patient_name}</Link><span className="block text-xs text-neutral-500">{r.mr_no} · {r.episode_no}</span></td>
                      <td className={`${td} tabular-nums`}>{r.discharge_date}</td>
                      <td className={td}>{r.department ?? "—"}</td>
                      <td className={td}>{r.missing.length ? <span className="text-xs text-rose-700">{r.missing.join(" · ")}</span> : pill("Complete", "bg-emerald-100 text-emerald-700")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS: Record<RecordRelease["status"], [string, string]> = {
  requested: ["Waiting for decision", "bg-amber-100 text-amber-800"], approved: ["Approved, to collect", "bg-sky-100 text-sky-700"],
  refused: ["Refused", "bg-neutral-200 text-neutral-700"], released: ["Released", "bg-emerald-100 text-emerald-700"],
};

function Releases() {
  const [rows, setRows] = useState<ReleaseRow[]>([]);
  const [status, setStatus] = useState<"open" | "" | RecordRelease["status"]>("open");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<ReleaseRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listReleases({ status })); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Show">
          <Select id="ri-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Waiting or to collect</option><option value="">All</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <div className="ml-auto"><Button variant="primary" onClick={() => setAdding(true)}><Plus size={14} />New request</Button></div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No requests.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>No</th><th className={th}>Patient</th><th className={th}>Requested by</th><th className={th}>Authority</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                  <td className={`${td} font-mono text-xs`}>{r.release_no}</td>
                  <td className={td}>{r.patient_name}<span className="block text-xs text-neutral-500">{r.mr_no}</span></td>
                  <td className={td}>{r.requester_name}<span className="block text-xs text-neutral-500">{r.requester_type} · {fmtWhen(r.requested_at)}</span></td>
                  <td className={td}>{AUTHORITY[r.authority]}{r.authority_ref ? <span className="block text-xs text-neutral-500">{r.authority_ref}</span> : null}</td>
                  <td className={td}>{pill(STATUS[r.status][0], STATUS[r.status][1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <RequestModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
      {open && <ReleaseDetail r={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function RequestModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Awaited<ReturnType<typeof findPatients>>>([]);
  const [patient, setPatient] = useState<{ id: string; name: string; mr_no: string | null } | null>(null);
  const [v, setV] = useState({ requesterName: "", requesterType: "Patient", relation: "", requesterIdNo: "", purpose: "", recordsRequested: "", authority: "patient" as RecordRelease["authority"], authorityRef: "" });
  useEffect(() => {
    const t = window.setTimeout(() => { void findPatients(q).then(setFound).catch(() => setFound([])); }, 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    if (!patient) return window.alert("Choose the patient.");
    try { await requestRelease({ ...v, patientId: patient.id }); onSaved(); } catch (e) { err(e); }
  };
  return (
    <Modal title="Request for a copy of a record" onClose={onClose}>
      <div className="grid gap-3">
        {patient ? (
          <p className="flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2 text-sm"><span><b>{patient.name}</b> · {patient.mr_no}</span><Button variant="ghost" onClick={() => setPatient(null)}>Change</Button></p>
        ) : (
          <div>
            <Field label="Patient" required><Input id="ri-q" value={q} placeholder="Name, MR number or phone" onChange={(e) => setQ(e.target.value)} /></Field>
            {found.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-neutral-200">
                {found.map((p) => <button key={p.id} type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50" onClick={() => setPatient(p)}>{p.name} · {p.mr_no}{p.phone ? ` · ${p.phone}` : ""}</button>)}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Requested by" required><Input id="ri-name" value={v.requesterName} onChange={set("requesterName")} /></Field>
          <Field label="Who they are" required><Select id="ri-type" value={v.requesterType} onChange={set("requesterType")}>{REQUESTER_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Relation to the patient"><Input id="ri-rel" value={v.relation} onChange={set("relation")} /></Field>
          <Field label="CNIC / official ID number" required><Input id="ri-id" value={v.requesterIdNo} onChange={set("requesterIdNo")} /></Field>
        </div>
        <Field label="Purpose" required><Input id="ri-purpose" value={v.purpose} onChange={set("purpose")} /></Field>
        <Field label="Records asked for" required><Textarea id="ri-recs" rows={2} value={v.recordsRequested} onChange={set("recordsRequested")} /></Field>
        <Field label="Authority" required>
          <Select id="ri-auth" value={v.authority} onChange={(e) => setV({ ...v, authority: e.target.value as RecordRelease["authority"] })}>{Object.entries(AUTHORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        {(v.authority === "patient_consent" || v.authority === "legal_order") && <Field label={v.authority === "legal_order" ? "Court order / letter number" : "Where the signed consent is kept"} required><Input id="ri-ref" value={v.authorityRef} onChange={set("authorityRef")} /></Field>}
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record request</Button></div>
    </Modal>
  );
}

function ReleaseDetail({ r, onClose, onSaved }: { r: ReleaseRow; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [rel, setRel] = useState({ recordsReleased: r.records_requested, copies: "1", idChecked: false });
  const run = async (f: () => Promise<unknown>) => { try { await f(); onSaved(); } catch (e) { err(e); } };
  return (
    <Modal title={`${r.release_no} · ${r.patient_name}`} onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-3 text-sm">
        <div className="rounded-xl bg-neutral-50 p-3">
          <p>{r.requester_name} ({r.requester_type}{r.relation ? `, ${r.relation}` : ""}) · ID {r.requester_id_no}</p>
          <p className="text-xs text-neutral-600">{r.purpose} · asked for: {r.records_requested}</p>
          <p className="text-xs text-neutral-600">{AUTHORITY[r.authority]}{r.authority_ref ? ` · ${r.authority_ref}` : ""} · received by {r.received_by_name}, {fmtWhen(r.requested_at)}</p>
        </div>
        {r.decided_at && <p className="text-xs text-neutral-600">{r.status === "refused" ? "Refused" : "Approved"} by {r.decided_by_name}, {fmtWhen(r.decided_at)}{r.decision_note ? `: ${r.decision_note}` : ""}</p>}
        {r.status === "requested" && (
          <>
            <Field label="Decision note"><Input id="rd-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button onClick={() => run(() => decideRelease(r.id, false, note))}>Refuse</Button><Button variant="primary" onClick={() => run(() => decideRelease(r.id, true, note))}>Approve</Button></div>
          </>
        )}
        {r.status === "approved" && (
          <>
            <Field label="Released"><Textarea id="rd-recs" rows={2} value={rel.recordsReleased} onChange={(e) => setRel({ ...rel, recordsReleased: e.target.value })} /></Field>
            <div className="w-32"><Field label="Copies"><Input id="rd-copies" inputMode="numeric" value={rel.copies} onChange={(e) => setRel({ ...rel, copies: e.target.value })} /></Field></div>
            <label className="flex items-center gap-2"><input id="rd-id" type="checkbox" checked={rel.idChecked} onChange={(e) => setRel({ ...rel, idChecked: e.target.checked })} />I checked the ID of the person collecting the copies</label>
            <div className="flex justify-end"><Button variant="primary" onClick={() => run(() => recordRelease(r.id, { ...rel, copies: Number(rel.copies) }))}>Record release</Button></div>
          </>
        )}
        {r.status === "released" && <p className="text-xs text-emerald-700">Released {fmtWhen(r.released_at)} by {r.released_by_name}: {r.records_released} ({r.copies} cop{r.copies === 1 ? "y" : "ies"}).</p>}
      </div>
    </Modal>
  );
}
