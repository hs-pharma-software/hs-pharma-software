"use client";

import { useEffect, useState } from "react";
import { Pill } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import {
  addMedicationOrder, listMedicationOrders, countersignOrder, verifyHighRiskOrder, stopMedicationOrder,
  recordAdministration, voidAdministration, listAdministrations, type MedicationOrderInput,
} from "@/lib/repo/medication";
import { listHospitalDoctors } from "@/lib/repo/hospitalOpd";
import { staffRepo } from "@/lib/repo/staff";
import { highRiskGroup, PATIENT_IDENTIFIERS, ROUTES } from "@/config/highRiskMedicines";
import { fmtWhen } from "./FormEditor";
import type { HospitalEpisode, HospitalRxItem, MarEntry } from "@/lib/types-hospital";
import type { Staff } from "@/lib/types";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const FREQUENCIES = ["OD (once a day)", "BD (twice a day)", "TDS (three times)", "QID (four times)", "6 hourly", "8 hourly", "12 hourly", "HS (at night)", "SOS (when needed)", "STAT (once now)"];
const MAR_STATUS: Record<MarEntry["status"], string> = { given: "Given", held: "Held", refused: "Refused", missed: "Missed" };

/** Inpatient medication orders and the medication administration record (MSDS MOM-1, MOM-3). */
export function MedicationPanel({ episode }: { episode: HospitalEpisode }) {
  const [orders, setOrders] = useState<HospitalRxItem[]>([]);
  const [mar, setMar] = useState<MarEntry[]>([]);
  const [newOrder, setNewOrder] = useState(false);
  const [giving, setGiving] = useState<HospitalRxItem | null>(null);
  const load = async () => {
    const [o, m] = await Promise.all([listMedicationOrders(episode.id), listAdministrations(episode.id)]);
    setOrders(o);
    setMar(m);
  };
  useEffect(() => { void load().catch(() => undefined); }, [episode.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      window.alert(`Could not ${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const ask = (q: string) => {
    const r = window.prompt(q);
    return r?.trim() ? r.trim() : null;
  };

  const active = orders.filter((o) => o.order_status === "active");
  const stopped = orders.filter((o) => o.order_status !== "active");
  const lastGiven = (id: string) => mar.find((m) => m.order_id === id && !m.voided_at);

  return (
    <div className={card}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700"><Pill size={15} />Medication orders and administration</h2>
        {episode.status === "open" && <Button onClick={() => setNewOrder(true)}>New order</Button>}
      </div>
      {active.length === 0 && <p className="text-sm text-neutral-400">No active medication orders.</p>}
      <div className="flex flex-col divide-y divide-neutral-100">
        {active.map((o) => {
          const last = lastGiven(o.id);
          const needsSign = o.order_source && o.order_source !== "written" && !o.countersigned_at;
          return (
            <div key={o.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {o.product_name} <span className="font-normal text-neutral-600">{o.dose} · {o.route} · {o.frequency} · {o.duration}</span>
                </p>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                  {o.high_risk ? <span className="rounded-full bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">High-risk{highRiskGroup(o.product_name, o.generic_name) ? ` · ${highRiskGroup(o.product_name, o.generic_name)}` : ""}</span> : null}
                  {o.high_risk && !o.verified_at ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Not verified yet</span> : null}
                  {needsSign ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">{o.order_source} order · awaiting countersignature</span> : null}
                  {o.own_supply ? <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-neutral-600">Patient&apos;s own medicine</span> : null}
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-400">
                  Ordered by {o.ordered_by_name} · {fmtWhen(o.ordered_at)}{o.received_by_name ? ` · taken by ${o.received_by_name}` : ""}
                  {o.verified_by_name ? ` · verified by ${o.verified_by_name}` : ""}{o.countersigned_by_name ? ` · countersigned by ${o.countersigned_by_name}` : ""}
                  {last ? ` · last ${MAR_STATUS[last.status].toLowerCase()} ${fmtWhen(last.given_at)}` : " · not given yet"}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {o.high_risk && !o.verified_at ? <Button variant="ghost" onClick={() => void act("verify", () => verifyHighRiskOrder(o.id))}>Verify</Button> : null}
                {needsSign ? <Button variant="ghost" onClick={() => void act("countersign", () => countersignOrder(o.id))}>Countersign</Button> : null}
                <Button variant="primary" onClick={() => setGiving(o)}>Give / record</Button>
                <Button variant="ghost" onClick={() => { const r = ask(`Stop ${o.product_name}? Reason:`); if (r) void act("stop", () => stopMedicationOrder(o.id, r)); }}>Stop</Button>
              </div>
            </div>
          );
        })}
      </div>
      {stopped.length > 0 && (
        <details className="mt-2 text-xs text-neutral-500">
          <summary className="cursor-pointer">Stopped ({stopped.length})</summary>
          {stopped.map((o) => <p key={o.id} className="mt-1">{o.product_name} {o.dose} · stopped {fmtWhen(o.stopped_at)} by {o.stopped_by_name}: {o.stop_reason}</p>)}
        </details>
      )}

      {mar.length > 0 && (
        <div className="mt-3 overflow-x-auto border-t border-neutral-100 pt-2">
          <p className="mb-1 text-xs font-semibold text-neutral-600">Administration record</p>
          <table className="w-full min-w-[620px] text-xs">
            <thead><tr className="text-left text-neutral-500"><th className="pb-1 pr-2 font-medium">Time</th><th className="pb-1 pr-2 font-medium">Medicine</th><th className="pb-1 pr-2 font-medium">Status</th><th className="pb-1 pr-2 font-medium">Dose / route</th><th className="pb-1 pr-2 font-medium">Identity · checks</th><th className="pb-1 pr-2 font-medium">By</th><th /></tr></thead>
            <tbody>
              {mar.map((m) => {
                const o = orders.find((x) => x.id === m.order_id);
                return (
                  <tr key={m.id} className={`border-t border-neutral-50 align-top ${m.voided_at ? "text-neutral-400 line-through" : ""}`} title={m.voided_at ? `Void: ${m.void_reason} (${m.voided_by_name})` : undefined}>
                    <td className="py-1 pr-2 tabular-nums">{fmtWhen(m.given_at)}</td>
                    <td className="py-1 pr-2">{o?.product_name ?? "—"}</td>
                    <td className="py-1 pr-2">{MAR_STATUS[m.status]}{m.reason ? ` · ${m.reason}` : ""}</td>
                    <td className="py-1 pr-2">{m.dose_given ? `${m.dose_given} ${m.route_given}` : "—"}</td>
                    <td className="py-1 pr-2">{m.status === "given" ? `${m.identifier_1} + ${m.identifier_2}; medicine, dose, route, time checked${m.second_checker_name ? `; 2nd check ${m.second_checker_name}` : ""}` : "—"}</td>
                    <td className="py-1 pr-2">{m.given_by_name}</td>
                    <td className="py-1">{!m.voided_at && <button type="button" className="text-neutral-400 hover:text-rose-600" onClick={() => { const r = ask("Void this entry (made in error)? Reason:"); if (r) void act("void", () => voidAdministration(m.id, r)); }}>Void</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {newOrder && <OrderModal episode={episode} onClose={() => setNewOrder(false)} onSaved={() => { setNewOrder(false); void load(); }} />}
      {giving && <GiveModal order={giving} onClose={() => setGiving(null)} onSaved={() => { setGiving(null); void load(); }} />}
    </div>
  );
}

function OrderModal({ episode, onClose, onSaved }: { episode: HospitalEpisode; onClose: () => void; onSaved: () => void }) {
  const [o, setO] = useState<MedicationOrderInput>({ product_name: "", dose: "", route: "Oral", frequency: "", duration: "", source: "written" });
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void listHospitalDoctors().then(setDoctors).catch(() => setDoctors([])); }, []);
  const set = (p: Partial<MedicationOrderInput>) => setO((x) => ({ ...x, ...p }));
  const group = highRiskGroup(o.product_name, o.generic_name);

  async function save() {
    setBusy(true);
    try {
      await addMedicationOrder(episode.id, o);
      onSaved();
    } catch (e) {
      window.alert(`Could not save the order: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Medication order" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Medicine (brand and strength)" required><Input id="o-name" value={o.product_name} onChange={(e) => set({ product_name: e.target.value })} autoFocus /></Field>
          <Field label="Generic name"><Input id="o-generic" value={o.generic_name ?? ""} onChange={(e) => set({ generic_name: e.target.value })} /></Field>
          <Field label="Dose" required><Input id="o-dose" value={o.dose} onChange={(e) => set({ dose: e.target.value })} placeholder="e.g. 500 mg, 6 units" /></Field>
          <Field label="Route" required>
            <Select id="o-route" value={o.route} onChange={(e) => set({ route: e.target.value })}>{ROUTES.map((r) => <option key={r}>{r}</option>)}</Select>
          </Field>
          <Field label="Frequency" required>
            <Select id="o-freq" value={o.frequency} onChange={(e) => set({ frequency: e.target.value })}><option value="">—</option>{FREQUENCIES.map((f) => <option key={f}>{f}</option>)}</Select>
          </Field>
          <Field label="Duration" required><Input id="o-dur" value={o.duration} onChange={(e) => set({ duration: e.target.value })} placeholder="e.g. 5 days" /></Field>
          <Field label="Order given">
            <Select id="o-src" value={o.source} onChange={(e) => set({ source: e.target.value as MedicationOrderInput["source"] })}>
              <option value="written">Written by me (doctor)</option>
              <option value="verbal">Verbal order (I am taking it down)</option>
              <option value="telephone">Telephone order (I am taking it down)</option>
            </Select>
          </Field>
          {o.source !== "written" && (
            <Field label="Doctor who gave the order" required>
              <Select id="o-doc" value={o.prescriberId ?? ""} onChange={(e) => set({ prescriberId: e.target.value })}>
                <option value="">—</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.designation ? ` · ${d.designation}` : ""}</option>)}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2"><Field label="Instructions"><Input id="o-instr" value={o.instructions ?? ""} onChange={(e) => set({ instructions: e.target.value })} placeholder="e.g. after meals, dilute in 100 mL NS" /></Field></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input id="o-own" type="checkbox" checked={Boolean(o.ownSupply)} onChange={(e) => set({ ownSupply: e.target.checked })} />Patient&apos;s own medicine brought from outside</label>
        <label className="flex items-center gap-2 text-sm"><input id="o-hr" type="checkbox" checked={Boolean(group) || Boolean(o.highRisk)} disabled={Boolean(group)} onChange={(e) => set({ highRisk: e.target.checked })} />High-risk medicine{group ? ` (on the hospital list: ${group})` : ""}</label>
        {o.source !== "written" && <p className="text-xs text-amber-700">Read the order back to the doctor. It stays marked until the doctor countersigns it.</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>Save order</Button></div>
      </div>
    </Modal>
  );
}

function GiveModal({ order, onClose, onSaved }: { order: HospitalRxItem; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<MarEntry["status"]>("given");
  const [ids, setIds] = useState<[string, string]>(["", ""]);
  const [checks, setChecks] = useState({ medicine: false, dose: false, route: false, time: false });
  const [secondId, setSecondId] = useState("");
  const [givenAt, setGivenAt] = useState("");
  const [reason, setReason] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (order.high_risk) void staffRepo.list({ where: "staff_category IN ('nurse','head_nurse','nursing_superintendent','pharmacist','hod','consultant','medical_specialist','medical_officer')", orderBy: "name ASC" }).then(setStaff).catch(() => setStaff([]));
  }, [order.high_risk]);

  async function save() {
    setBusy(true);
    try {
      await recordAdministration(order.id, { status, identifiers: ids, checks, secondCheckerId: secondId || null, givenAt: givenAt || null, reason: reason || null });
      onSaved();
    } catch (e) {
      window.alert(`Could not record: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const CHECK_LABEL: Record<keyof typeof checks, string> = {
    medicine: `Medicine is ${order.product_name}`, dose: `Dose is ${order.dose}`, route: `Route is ${order.route}`, time: `It is due now (${order.frequency})`,
  };
  return (
    <Modal title={`Administer · ${order.product_name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(MAR_STATUS) as MarEntry["status"][]).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={`rounded-full border px-3 py-1 text-sm ${status === s ? "border-amber-500 bg-amber-50 text-amber-800" : "border-neutral-200 text-neutral-600"}`}>{MAR_STATUS[s]}</button>
          ))}
        </div>
        {status === "given" ? (
          <>
            <p className="text-xs text-neutral-500">Confirm each step yourself, at the bedside, against the order.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <Field key={i} label={`Identifier ${i + 1}`} required>
                  <Select id={`g-id${i}`} value={ids[i]} onChange={(e) => setIds((x) => (i === 0 ? [e.target.value, x[1]] : [x[0], e.target.value]))}>
                    <option value="">—</option>{PATIENT_IDENTIFIERS.map((p) => <option key={p}>{p}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              {(Object.keys(checks) as (keyof typeof checks)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input id={`g-${k}`} type="checkbox" checked={checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} />{CHECK_LABEL[k]}</label>
              ))}
            </div>
            {order.high_risk ? (
              <Field label="Second person who checked (high-risk)" required>
                <Select id="g-second" value={secondId} onChange={(e) => setSecondId(e.target.value)}>
                  <option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.designation ? ` · ${s.designation}` : ""}</option>)}
                </Select>
              </Field>
            ) : null}
          </>
        ) : (
          <Field label={`Why was the dose ${status}?`} required><Input id="g-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. NPO for surgery, doctor informed" /></Field>
        )}
        <div className="w-60"><Field label="Time (empty = now)"><Input id="g-at" type="datetime-local" value={givenAt} onChange={(e) => setGivenAt(e.target.value)} /></Field></div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={busy}>Record</Button></div>
      </div>
    </Modal>
  );
}
