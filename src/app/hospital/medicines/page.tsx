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
  stewardshipList, listFormulary, saveFormularyItem, removeFormularyItem, listAdr, assessAdr, submitAdrToDrap, cdStock, cdLedger, recordCdEntry,
  listFridgeLogs, recordFridgeReading, medicineIndicators, type StewardshipRow, type AdrRow, type MedicineIndicators,
} from "@/lib/repo/medicines";
import { listEpisodes, type EpisodeListRow } from "@/lib/repo/hospital";
import { staffRepo } from "@/lib/repo/staff";
import {
  ABX_LABEL, ABX_REVIEW_HOURS, RESERVE_APPROVAL_HOURS, ADR_CAUSALITY, ADR_OUTCOMES, ADR_SERIOUS_REPORT_DAYS, CONTROLLED_DRUGS, CD_ENTRY_TYPES,
  FRIDGE_MIN_C, FRIDGE_MAX_C, type CdEntryType,
} from "@/config/medicines";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import { err } from "@/components/hospital/quality/SafetyModals";
import type { Staff } from "@/lib/types";
import type { CdEntry, FormularyItem, FridgeLog } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const th = "pb-1.5 pr-2 font-medium";
const td = "py-1.5 pr-2";
const pill = (label: string, cls: string) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;

type Tab = "stewardship" | "formulary" | "adr" | "cd" | "fridges" | "indicators";
const TABS: [Tab, string][] = [["stewardship", "Antibiotics"], ["formulary", "Formulary"], ["adr", "Drug reactions"], ["cd", "Controlled drugs"], ["fridges", "Fridges"], ["indicators", "Indicators"]];

/** Medicines management (MSDS MOM). */
export default function MedicinesPage() {
  const [tab, setTab] = useState<Tab>("stewardship");
  return (
    <div>
      <PageHeader title="Medicines" actions={
        <div className="flex flex-wrap overflow-hidden rounded-lg border border-neutral-200 text-sm">
          {TABS.map(([t, l]) => <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-rose-700 text-white" : "bg-white text-neutral-600"}`}>{l}</button>)}
        </div>
      } />
      {tab === "stewardship" && <Stewardship />}
      {tab === "formulary" && <Formulary />}
      {tab === "adr" && <Reactions />}
      {tab === "cd" && <ControlledDrugs />}
      {tab === "fridges" && <Fridges />}
      {tab === "indicators" && <Indicators />}
    </div>
  );
}

// ── Antibiotic stewardship ────────────────────────────────────────────────

function Stewardship() {
  const [rows, setRows] = useState<StewardshipRow[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    void stewardshipList().then(setRows).catch(err);
  }, []);
  return (
    <div className={card}>
      <p className="mb-3 text-xs text-neutral-500">Active Watch and Reserve antibiotics in the hospital. Reserve antibiotics need a consultant&apos;s approval within {RESERVE_APPROVAL_HOURS} hours; every one is reviewed at {ABX_REVIEW_HOURS} hours. Approve and review from the patient&apos;s admission.</p>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No active Watch or Reserve antibiotics.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Patient</th><th className={th}>Antibiotic</th><th className={th}>Indication</th><th className={th}>Day</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-t border-neutral-100 ${r.approval_overdue ? "bg-rose-50/60" : ""}`}>
                  <td className={td}><Link className="hover:underline" href={`/hospital/episodes/view?id=${r.episode_id}`}>{r.patient_name}</Link><span className="block text-xs text-neutral-500">{r.mr_no} · {r.ward ?? r.episode_no}</span></td>
                  <td className={td}>{r.product_name} <span className="text-xs text-neutral-500">{r.dose} {r.route} {r.frequency}</span><span className="block">{pill(ABX_LABEL[r.abx_class!], r.abx_class === "reserve" ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-800")}</span></td>
                  <td className={td}>{r.abx_indication}<span className="block text-xs text-neutral-500">{r.abx_culture_sent ? "Culture sent" : "No culture"}</span></td>
                  <td className={`${td} tabular-nums`}>{Math.floor(r.hours_on / 24) + 1}<span className="block text-xs text-neutral-500">{r.hours_on} h</span></td>
                  <td className={td}>
                    {r.abx_class === "reserve" && (r.abx_approved_at ? <span className="block text-xs text-emerald-700">Approved by {r.abx_approved_by_name}</span> : <span className={`block text-xs font-medium ${r.approval_overdue ? "text-rose-700" : "text-amber-700"}`}>{r.approval_overdue ? "Approval overdue" : "Awaiting approval"}</span>)}
                    {r.abx_reviewed_at ? <span className="block text-xs text-neutral-600">Reviewed: {r.abx_review_outcome}</span> : r.review_due ? <span className="block text-xs font-medium text-amber-700">Review due</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Formulary ─────────────────────────────────────────────────────────────

function Formulary() {
  const [rows, setRows] = useState<FormularyItem[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FormularyItem | "new" | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listFormulary({ search })); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Search"><Input id="fm-q" value={search} placeholder="Generic name or group" onChange={(e) => setSearch(e.target.value)} /></Field>
        <p className="pb-2 text-[11px] text-neutral-500">Once the formulary has medicines, an order for anything else needs a reason.</p>
        <div className="ml-auto"><Button variant="primary" onClick={() => setEditing("new")}><Plus size={14} />Add medicine</Button></div>
      </div>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">The formulary is empty. Orders are not checked against it until medicines are added.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Generic name</th><th className={th}>Strength / form</th><th className={th}>Group</th><th className={th}>Approval</th><th className={th}></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100">
                  <td className={td}>{r.generic_name}{r.restricted ? <span className="ml-1">{pill("Restricted", "bg-rose-100 text-rose-700")}</span> : null}</td>
                  <td className={td}>{r.strength_form ?? "—"}</td>
                  <td className={td}>{r.category ?? "—"}</td>
                  <td className={td}>{r.approval_ref ?? "—"}</td>
                  <td className={td}><div className="flex gap-1"><Button variant="ghost" onClick={() => setEditing(r)}>Edit</Button><Button variant="ghost" onClick={() => { const x = window.prompt("Reason for removing it from the formulary"); if (x) void removeFormularyItem(r.id, x).then(reload).catch(err); }}>Remove</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <FormularyModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

function FormularyModal({ item, onClose, onSaved }: { item: FormularyItem | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ genericName: item?.generic_name ?? "", strengthForm: item?.strength_form ?? "", category: item?.category ?? "", restricted: !!item?.restricted, approvalRef: item?.approval_ref ?? "", notes: item?.notes ?? "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => { try { await saveFormularyItem(item?.id ?? null, v); onSaved(); } catch (e) { err(e); } };
  return (
    <Modal title={item ? "Edit formulary medicine" : "Add to the formulary"} onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        <Field label="Generic name" required><Input id="fm-g" value={v.genericName} onChange={set("genericName")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Strength and form"><Input id="fm-s" value={v.strengthForm} placeholder="500 mg tablet" onChange={set("strengthForm")} /></Field>
          <Field label="Group"><Input id="fm-c" value={v.category} placeholder="Analgesic, antibiotic…" onChange={set("category")} /></Field>
        </div>
        <Field label="P&T committee approval (meeting / minute no)"><Input id="fm-a" value={v.approvalRef} onChange={set("approvalRef")} /></Field>
        <label className="flex items-center gap-2 text-sm"><input id="fm-r" type="checkbox" checked={v.restricted} onChange={(e) => setV({ ...v, restricted: e.target.checked })} />Restricted (prescribed only with approval)</label>
        <Field label="Notes"><Textarea id="fm-n" rows={2} value={v.notes} onChange={set("notes")} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
    </Modal>
  );
}

// ── Adverse drug reactions ────────────────────────────────────────────────

const ADR_STATUS: Record<AdrRow["status"], [string, string]> = {
  reported: ["Reported", "bg-amber-100 text-amber-800"], assessed: ["Assessed", "bg-sky-100 text-sky-700"], submitted: ["Sent to DRAP", "bg-emerald-100 text-emerald-700"],
};

function Reactions() {
  const [rows, setRows] = useState<AdrRow[]>([]);
  const [status, setStatus] = useState<"open" | "" | AdrRow["status"]>("open");
  const [open, setOpen] = useState<AdrRow | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setRows(await listAdr({ status })); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="Show">
          <Select id="adr-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">Not yet sent</option><option value="">All</option>{Object.entries(ADR_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <p className="pb-2 text-[11px] text-neutral-500">Reported from the patient&apos;s medication orders. Serious reactions go to DRAP within {ADR_SERIOUS_REPORT_DAYS} days.</p>
      </div>
      {rows.length === 0 ? <p className="text-sm text-neutral-400">No reports.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>No</th><th className={th}>Patient</th><th className={th}>Medicine and reaction</th><th className={th}>Causality</th><th className={th}>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => setOpen(r)}>
                  <td className={`${td} font-mono text-xs`}>{r.report_no}</td>
                  <td className={td}>{r.patient_name}<span className="block text-xs text-neutral-500">{r.mr_no} · {fmtWhen(r.onset_at)}</span></td>
                  <td className={td}><b>{r.suspected_drug}</b>{r.serious ? <span className="ml-1">{pill(`Serious: ${r.seriousness}`, "bg-rose-100 text-rose-700")}</span> : null}<span className="block text-xs text-neutral-600">{r.reaction}</span></td>
                  <td className={td}>{r.causality ?? "—"}</td>
                  <td className={td}>{pill(ADR_STATUS[r.status][0], ADR_STATUS[r.status][1])}{r.report_overdue ? <span className="block text-xs font-medium text-rose-700">Past {ADR_SERIOUS_REPORT_DAYS} days</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <AdrDetail r={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void reload(); }} />}
    </div>
  );
}

function AdrDetail({ r, onClose, onSaved }: { r: AdrRow; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ causality: r.causality ?? "", assessment: r.assessment ?? "", outcome: r.outcome ?? "" });
  const [drap, setDrap] = useState({ reportedOn: localDate(), ref: "" });
  const run = async (f: () => Promise<unknown>) => { try { await f(); onSaved(); } catch (e) { err(e); } };
  return (
    <Modal title={`${r.report_no} · ${r.suspected_drug}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="rounded-xl bg-neutral-50 p-3">
          <p>{r.patient_name} ({r.mr_no}) · reaction {fmtWhen(r.onset_at)} · reported by {r.reporter_name}</p>
          <p className="mt-1 whitespace-pre-wrap">{r.reaction}</p>
          <p className="mt-1 text-xs text-neutral-600">
            {[r.serious ? `Serious: ${r.seriousness}` : "Not serious", r.action_taken, r.outcome && `Outcome: ${r.outcome}`, r.dechallenge && `Dechallenge: ${r.dechallenge}`, r.rechallenge && `Rechallenge: ${r.rechallenge}`, r.other_drugs && `Other medicines: ${r.other_drugs}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        {r.status !== "submitted" && (
          <section className="grid gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Assessment (pharmacist / senior doctor)</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Causality (WHO-UMC)"><Select id="ad-c" value={v.causality} onChange={(e) => setV({ ...v, causality: e.target.value })}><option value="">Choose…</option>{ADR_CAUSALITY.map((x) => <option key={x}>{x}</option>)}</Select></Field>
              <Field label="Outcome"><Select id="ad-o" value={v.outcome} onChange={(e) => setV({ ...v, outcome: e.target.value })}><option value="">—</option>{ADR_OUTCOMES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
            </div>
            <Field label="Assessment"><Textarea id="ad-a" rows={2} value={v.assessment} onChange={(e) => setV({ ...v, assessment: e.target.value })} /></Field>
            <div><Button onClick={() => run(() => assessAdr(r.id, v))}>Save assessment</Button></div>
          </section>
        )}
        {r.assessed_at && <p className="text-xs text-neutral-500">Assessed by {r.assessed_by_name}, {fmtWhen(r.assessed_at)}: {r.causality}. {r.assessment}</p>}
        {r.status === "assessed" && (
          <section className="flex flex-wrap items-end gap-2">
            <Field label="Sent to DRAP on"><Input id="ad-d" type="date" value={drap.reportedOn} onChange={(e) => setDrap({ ...drap, reportedOn: e.target.value })} /></Field>
            <div className="min-w-48 flex-1"><Field label="DRAP / pharmacovigilance reference"><Input id="ad-r" value={drap.ref} onChange={(e) => setDrap({ ...drap, ref: e.target.value })} /></Field></div>
            <Button variant="primary" onClick={() => run(() => submitAdrToDrap(r.id, drap))}>Record as sent</Button>
          </section>
        )}
        {r.status === "submitted" && <p className="text-xs text-emerald-700">Sent to DRAP on {r.drap_reported_on}, reference {r.drap_ref}.</p>}
      </div>
    </Modal>
  );
}

// ── Controlled drugs ──────────────────────────────────────────────────────

function ControlledDrugs() {
  const [stock, setStock] = useState<Awaited<ReturnType<typeof cdStock>>>([]);
  const [entry, setEntry] = useState<{ location: string; drug: string } | "new" | null>(null);
  const [ledger, setLedger] = useState<{ location: string; drug: string; rows: CdEntry[] } | null>(null);
  const reload = async () => {
    if (!isTauri()) return;
    try { setStock(await cdStock()); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  const showLedger = async (location: string, drug: string) => { try { setLedger({ location, drug, rows: await cdLedger(location, drug) }); } catch (e) { err(e); } };
  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-xs text-neutral-500">Running balance per drug and location. Doses, wastage, returns and counts are witnessed by a second nurse, doctor or pharmacist.</p>
        <div className="ml-auto"><Button variant="primary" onClick={() => setEntry("new")}><Plus size={14} />New entry</Button></div>
      </div>
      {stock.length === 0 ? <p className="text-sm text-neutral-400">The register is empty. Start with a receipt from the pharmacy.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>Location</th><th className={th}>Drug</th><th className={th}>Balance</th><th className={th}>Last count</th><th className={th}></th></tr></thead>
            <tbody>
              {stock.map((s) => (
                <tr key={`${s.location}-${s.drug}`} className={`border-t border-neutral-100 ${s.discrepancy ? "bg-rose-50/60" : ""}`}>
                  <td className={td}>{s.location}</td>
                  <td className={td}>{s.drug}</td>
                  <td className={`${td} font-semibold tabular-nums`}>{s.balance}</td>
                  <td className={td}>{s.lastCount ? <>{fmtWhen(s.lastCount.entry_at)} · counted {s.lastCount.counted_qty}{s.discrepancy ? <span className="block text-xs font-medium text-rose-700">Did not match ({s.lastCount.note})</span> : null}</> : <span className="text-xs text-amber-700">Never counted</span>}</td>
                  <td className={td}><div className="flex gap-1"><Button variant="ghost" onClick={() => showLedger(s.location, s.drug)}>Register</Button><Button onClick={() => setEntry({ location: s.location, drug: s.drug })}>Entry</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entry && <CdEntryModal preset={entry === "new" ? null : entry} onClose={() => setEntry(null)} onSaved={() => { setEntry(null); void reload(); }} />}
      {ledger && (
        <Modal title={`${ledger.drug} · ${ledger.location}`} onClose={() => setLedger(null)} width="max-w-3xl">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-neutral-500"><th className={th}>When</th><th className={th}>Entry</th><th className={th}>Qty</th><th className={th}>Balance</th><th className={th}>By / witness</th><th className={th}>Note</th></tr></thead>
              <tbody>
                {ledger.rows.map((e) => (
                  <tr key={e.id} className="border-t border-neutral-100 tabular-nums">
                    <td className={td}>{fmtWhen(e.entry_at)}</td>
                    <td className={td}>{CD_ENTRY_TYPES[e.entry_type]}{e.reference ? ` · ${e.reference}` : ""}</td>
                    <td className={td}>{e.entry_type === "count" ? `counted ${e.counted_qty}` : e.qty > 0 ? `+${e.qty}` : e.qty}</td>
                    <td className={td}>{e.balance_after}</td>
                    <td className={td}>{e.by_name}{e.witness_name ? <span className="block text-neutral-500">witness {e.witness_name}</span> : null}</td>
                    <td className={td}>{e.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CdEntryModal({ preset, onClose, onSaved }: { preset: { location: string; drug: string } | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ location: preset?.location ?? "", drug: preset?.drug ?? "", other: "", type: "receipt" as CdEntryType, qty: "", countedQty: "", episodeId: "", witnessStaffId: "", reference: "", note: "" });
  const [patients, setPatients] = useState<EpisodeListRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  useEffect(() => {
    void listEpisodes({ status: "open", limit: 300 }).then((r) => setPatients(r.filter((e) => e.type !== "opd"))).catch(() => undefined);
    void staffRepo.list({ where: "staff_category IN ('nurse','head_nurse','nursing_superintendent','pharmacist','hod','consultant','medical_specialist','medical_officer')", orderBy: "name ASC" }).then(setStaff).catch(() => undefined);
  }, []);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    try {
      await recordCdEntry({
        location: v.location, drug: v.drug === "Other" ? v.other : v.drug, type: v.type, qty: Number(v.qty) || 0, countedQty: v.countedQty === "" ? null : Number(v.countedQty),
        episodeId: v.episodeId || null, witnessStaffId: v.witnessStaffId || null, reference: v.reference, note: v.note,
      });
      onSaved();
    } catch (e) { err(e); }
  };
  return (
    <Modal title="Controlled drug register entry" onClose={onClose} width="max-w-lg">
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Location" required><Input id="cd-loc" value={v.location} placeholder="Medical ward, OT, ICU…" onChange={set("location")} /></Field>
          <Field label="Entry" required><Select id="cd-type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as CdEntryType })}>{Object.entries(CD_ENTRY_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        </div>
        <Field label="Drug" required><Select id="cd-drug" value={v.drug} onChange={set("drug")}><option value="">Choose…</option>{[...CONTROLLED_DRUGS, ...(preset && !(CONTROLLED_DRUGS as readonly string[]).includes(preset.drug) ? [preset.drug] : [])].map((d) => <option key={d}>{d}</option>)}</Select></Field>
        {v.drug === "Other" && <Field label="Drug name and strength" required><Input id="cd-other" value={v.other} onChange={set("other")} /></Field>}
        {v.type === "count"
          ? <Field label="Quantity counted" required><Input id="cd-count" inputMode="decimal" value={v.countedQty} onChange={set("countedQty")} /></Field>
          : <Field label="Quantity (ampoules / tablets)" required><Input id="cd-qty" inputMode="decimal" value={v.qty} onChange={set("qty")} /></Field>}
        {v.type === "administered" && <Field label="Patient" required><Select id="cd-pt" value={v.episodeId} onChange={set("episodeId")}><option value="">Choose…</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.patient_name} · {p.mr_no} · {p.episode_no}</option>)}</Select></Field>}
        {v.type === "receipt" && <Field label="Pharmacy issue / requisition no" required><Input id="cd-ref" value={v.reference} onChange={set("reference")} /></Field>}
        {v.type !== "receipt" && <Field label="Witness" required><Select id="cd-w" value={v.witnessStaffId} onChange={set("witnessStaffId")}><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.designation ? ` · ${s.designation}` : ""}</option>)}</Select></Field>}
        <Field label="Note"><Input id="cd-note" value={v.note} onChange={set("note")} placeholder={v.type === "count" ? "Required if the count does not match" : ""} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record</Button></div>
    </Modal>
  );
}

// ── Fridges ───────────────────────────────────────────────────────────────

function Fridges() {
  const [logs, setLogs] = useState<FridgeLog[]>([]);
  const [v, setV] = useState({ fridge: "", tempC: "", minC: "", maxC: "", actionTaken: "" });
  const reload = async () => {
    if (!isTauri()) return;
    try { setLogs(await listFridgeLogs(30)); } catch (e) { err(e); }
  };
  useEffect(() => { void reload(); }, []);
  const fridges = [...new Set(logs.map((l) => l.fridge))];
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const t = num(v.tempC);
  const out = [t, num(v.minC), num(v.maxC)].some((x) => x !== null && (x < FRIDGE_MIN_C || x > FRIDGE_MAX_C));
  const save = async () => {
    try { await recordFridgeReading({ fridge: v.fridge, tempC: Number(v.tempC), minC: num(v.minC), maxC: num(v.maxC), actionTaken: v.actionTaken }); setV({ ...v, tempC: "", minC: "", maxC: "", actionTaken: "" }); void reload(); } catch (e) { err(e); }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className={card}>
        <p className="mb-3 text-xs text-neutral-500">Record each medicine and vaccine fridge at least once a day. The safe range is {FRIDGE_MIN_C}-{FRIDGE_MAX_C} °C.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Fridge"><Input id="fr-name" list="fr-list" value={v.fridge} placeholder="Ward 4 medicine fridge" onChange={(e) => setV({ ...v, fridge: e.target.value })} /></Field>
          <datalist id="fr-list">{fridges.map((f) => <option key={f} value={f} />)}</datalist>
          <div className="w-24"><Field label="Now °C"><Input id="fr-t" inputMode="decimal" value={v.tempC} onChange={(e) => setV({ ...v, tempC: e.target.value })} /></Field></div>
          <div className="w-24"><Field label="Min °C"><Input id="fr-min" inputMode="decimal" value={v.minC} onChange={(e) => setV({ ...v, minC: e.target.value })} /></Field></div>
          <div className="w-24"><Field label="Max °C"><Input id="fr-max" inputMode="decimal" value={v.maxC} onChange={(e) => setV({ ...v, maxC: e.target.value })} /></Field></div>
          {out && <div className="min-w-60 flex-1"><Field label="Out of range: action taken" required><Input id="fr-act" value={v.actionTaken} onChange={(e) => setV({ ...v, actionTaken: e.target.value })} /></Field></div>}
          <Button variant="primary" onClick={save}>Record</Button>
        </div>
      </div>
      <div className={card}>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Last 30 days</h2>
        {logs.length === 0 ? <p className="text-sm text-neutral-400">No readings.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-neutral-500"><th className={th}>When</th><th className={th}>Fridge</th><th className={th}>Now</th><th className={th}>Min / max</th><th className={th}>By</th><th className={th}>Action</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className={`border-t border-neutral-100 tabular-nums ${l.in_range ? "" : "bg-rose-50/60"}`}>
                    <td className={td}>{fmtWhen(l.reading_at)}</td><td className={td}>{l.fridge}</td><td className={td}>{l.temp_c} °C</td>
                    <td className={td}>{l.min_c ?? "—"} / {l.max_c ?? "—"}</td><td className={td}>{l.by_name}</td><td className={td}>{l.action_taken ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Indicators ────────────────────────────────────────────────────────────

function Indicators() {
  const [from, setFrom] = useState(() => localDate().slice(0, 8) + "01");
  const [to, setTo] = useState(localDate());
  const [ind, setInd] = useState<MedicineIndicators | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void medicineIndicators({ from, to }).then(setInd).catch(err);
  }, [from, to]);
  const pc = (x: number | null) => (x === null ? "—" : `${x}%`);
  const tiles: [string, string, string][] = ind ? [
    ["Inpatient orders", String(ind.ordersTotal), `${ind.nonFormularyOrders} non-formulary`],
    ["Antibiotic orders", String(ind.antibioticOrders), `${pc(ind.antibioticPct)} of orders`],
    ["Culture before first dose", pc(ind.cultureBeforePct), "of antibiotic orders"],
    ["Reserve approved within 24 h", pc(ind.reserveApprovedInTimePct), `${ind.reserveOrders} reserve orders`],
    ["Reviewed by 72 h", pc(ind.reviewedBy72hPct), ind.medianHoursToReview === null ? "" : `median ${ind.medianHoursToReview} h`],
    ["Drug reactions reported", String(ind.adrReports), `${ind.adrSerious} serious`],
    ["Controlled drug count mismatches", String(ind.cdDiscrepancies), "last count per drug"],
    ["Fridge readings out of range", String(ind.fridgeOutOfRange), `of ${ind.fridgeReadings}`],
  ] : [];
  return (
    <div className={card}>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From"><Input id="mi-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input id="mi-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {ind && (
        <div className="flex flex-col gap-3">
          {ind.adrSeriousNotSent > 0 && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{ind.adrSeriousNotSent} serious reaction(s) not sent to DRAP within {ADR_SERIOUS_REPORT_DAYS} days.</p>}
          {ind.fridgesWithoutReading7d.length > 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">No reading in the last 7 days: {ind.fridgesWithoutReading7d.join(", ")}.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(([l, n, sub]) => (
              <div key={l} className="rounded-xl bg-neutral-50 p-3">
                <p className="text-xs text-neutral-500">{l}</p>
                <p className="text-xl font-semibold tabular-nums">{n}</p>
                {sub && <p className="text-[11px] text-neutral-500">{sub}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
