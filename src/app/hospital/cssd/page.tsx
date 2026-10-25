"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Field";
import { isTauri } from "@/lib/platform";
import { localDate } from "@/lib/localDate";
import {
  listSterilisers, saveSteriliser, startCycle, recordCycleResults, releaseCycle, failCycle, recallCycle, recordBiologicalResult,
  listCycles, listCycleItems, recallImpact, STERILISER_KINDS, CYCLE_STATUS, type CycleRow, type RecallImpact,
} from "@/lib/repo/cssd";
import { fmtWhen } from "@/components/hospital/record/FormEditor";
import type { SterilCycle, SterilEquipment, SterilItem } from "@/lib/types-hospital";

const card = "rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]";
const STATUS_CLS: Record<SterilCycle["status"], string> = {
  awaiting_release: "bg-amber-100 text-amber-800", released: "bg-emerald-100 text-emerald-700", failed: "bg-rose-100 text-rose-700", recalled: "bg-rose-200 text-rose-800",
};
const RESULT = (r: string | null) => (r === "pass" ? "Pass" : r === "fail" ? "Fail" : r === "pending" ? "Pending" : r === "na" ? "Not used" : "—");
const expired = (c: SterilCycle) => c.status === "released" && !!c.expires_on && c.expires_on < localDate();

/** Sterilization / CSSD (MSDS IPC-2 Ind. 90-92). */
export default function CssdPage() {
  const [tab, setTab] = useState<"loads" | "sterilisers">("loads");
  const [filter, setFilter] = useState<SterilCycle["status"] | "">("");
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [sterilisers, setSterilisers] = useState<SterilEquipment[]>([]);
  const [newLoad, setNewLoad] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editEq, setEditEq] = useState<SterilEquipment | "new" | null>(null);

  async function reload() {
    if (!isTauri()) return;
    try {
      setSterilisers(await listSterilisers());
      setCycles(await listCycles(filter ? { status: filter } : {}));
    } catch (e) {
      window.alert(`Could not load: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [filter]);

  return (
    <div>
      <PageHeader title="Sterilization (CSSD)" actions={
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm">
            {(["loads", "sterilisers"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 ${tab === t ? "bg-amber-600 text-white" : "bg-white text-neutral-600"}`}>{t === "loads" ? "Loads" : "Sterilisers"}</button>)}
          </div>
          {tab === "loads" ? <Button variant="primary" onClick={() => setNewLoad(true)}><Plus size={14} className="mr-1" />New load</Button>
            : <Button variant="primary" onClick={() => setEditEq("new")}><Plus size={14} className="mr-1" />Add steriliser</Button>}
        </div>
      } />

      {tab === "loads" ? (
        <div className={card}>
          <div className="mb-3 flex flex-wrap gap-1 text-sm">
            {(["", "awaiting_release", "released", "failed", "recalled"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFilter(s)} className={`rounded-full px-3 py-1 ${filter === s ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}>{s ? CYCLE_STATUS[s] : "All"}</button>
            ))}
          </div>
          {cycles.length === 0 ? <p className="text-sm text-neutral-400">No loads.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-neutral-100 text-left text-xs text-neutral-500"><th className="pb-1.5 pr-2 font-medium">Load</th><th className="pb-1.5 pr-2 font-medium">Started</th><th className="pb-1.5 pr-2 font-medium">Sets</th><th className="pb-1.5 pr-2 font-medium">Physical · chemical · biological</th><th className="pb-1.5 pr-2 font-medium">Expires</th><th className="pb-1.5 pr-2 font-medium">Status</th><th /></tr></thead>
                <tbody>
                  {cycles.map((c) => (
                    <tr key={c.id} className="border-b border-neutral-50">
                      <td className="py-1.5 pr-2 font-mono text-xs">{c.equipment_code} · {c.cycle_no}{c.implant_load ? <span className="ml-1 rounded-full bg-violet-100 px-1.5 text-[10px] font-medium text-violet-700">implant</span> : null}</td>
                      <td className="py-1.5 pr-2 text-xs text-neutral-500">{fmtWhen(c.started_at)} · {c.operator_name}</td>
                      <td className="py-1.5 pr-2 tabular-nums">{c.sets}{c.used ? <span className="text-xs text-neutral-400"> · {c.used} used</span> : null}</td>
                      <td className="py-1.5 pr-2 text-xs">{RESULT(c.physical_result)} · {RESULT(c.chemical_result)} · {RESULT(c.biological_result)}</td>
                      <td className="py-1.5 pr-2 tabular-nums text-xs">{c.expires_on ?? "—"}</td>
                      <td className="py-1.5 pr-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${expired(c) ? "bg-neutral-200 text-neutral-600" : STATUS_CLS[c.status]}`}>{expired(c) ? "Expired" : CYCLE_STATUS[c.status]}</span></td>
                      <td className="py-1.5"><Button variant="ghost" onClick={() => setOpen(c.id)}>Open</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-neutral-400">Theatre staff can use a set only from a released load before its expiry date. Failed, recalled and expired loads are never offered.</p>
        </div>
      ) : (
        <div className={card}>
          {sterilisers.length === 0 ? <p className="text-sm text-neutral-400">Add the hospital&apos;s sterilisers first.</p> : sterilisers.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 border-b border-neutral-50 py-2 text-sm">
              <span><b className="font-mono">{e.code}</b> {e.name} <span className="text-xs text-neutral-500">· {STERILISER_KINDS[e.kind]}{e.location ? ` · ${e.location}` : ""}{e.is_active ? "" : " · not in use"}</span></span>
              <Button variant="ghost" onClick={() => setEditEq(e)}>Edit</Button>
            </div>
          ))}
        </div>
      )}

      {newLoad && <NewLoad sterilisers={sterilisers.filter((e) => e.is_active)} onClose={() => setNewLoad(false)} onDone={(id) => { setNewLoad(false); setOpen(id); void reload(); }} />}
      {open && <LoadModal cycleId={open} cycles={cycles} onClose={() => { setOpen(null); void reload(); }} onReprocess={() => { setOpen(null); setNewLoad(true); }} />}
      {editEq && <SteriliserModal eq={editEq === "new" ? null : editEq} onClose={() => setEditEq(null)} onSaved={() => { setEditEq(null); void reload(); }} />}
    </div>
  );
}

function NewLoad({ sterilisers, onClose, onDone }: { sterilisers: SterilEquipment[]; onClose: () => void; onDone: (id: string) => void }) {
  const [equipmentId, setEquipmentId] = useState(sterilisers[0]?.id ?? "");
  const [program, setProgram] = useState("");
  const [implant, setImplant] = useState(false);
  const [desc, setDesc] = useState("");
  const [items, setItems] = useState([{ set_name: "", set_code: "", quantity: 1 }]);
  async function save() {
    try {
      const c = await startCycle({ equipmentId, program, implantLoad: implant, loadDescription: desc, items });
      onDone(c.id);
    } catch (e) {
      window.alert(`Could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return (
    <Modal title="New sterilization load" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {sterilisers.length === 0 && <p className="text-sm text-amber-700">Add a steriliser first (Sterilisers tab).</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Steriliser" required><Select id="ld-eq" value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>{sterilisers.map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</Select></Field>
          <Field label="Programme / cycle type"><Input id="ld-prog" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="e.g. 134 °C wrapped, 121 °C textiles" /></Field>
        </div>
        <Field label="Load description"><Input id="ld-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. OT sets, dressing drums" /></Field>
        <label className="flex items-center gap-2 text-sm"><input id="ld-implant" type="checkbox" checked={implant} onChange={(e) => setImplant(e.target.checked)} />Implant load (released only after the biological indicator passes)</label>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-600">Instrument sets in the load *</p>
          {items.map((it, i) => (
            <div key={i} className="mb-1 flex gap-2">
              <Input id={`ld-set-${i}`} value={it.set_name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, set_name: e.target.value } : x)))} placeholder="Set name, e.g. Major laparotomy set" />
              <Input id={`ld-code-${i}`} className="!w-32" value={it.set_code} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, set_code: e.target.value } : x)))} placeholder="Set code" />
              <Input id={`ld-qty-${i}`} className="!w-20" type="number" min="1" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
              <button type="button" aria-label="Remove" className="text-neutral-300 hover:text-rose-500" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setItems([...items, { set_name: "", set_code: "", quantity: 1 }])}>Add set</Button>
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={!equipmentId}>Start load</Button></div>
      </div>
    </Modal>
  );
}

function LoadModal({ cycleId, cycles, onClose, onReprocess }: { cycleId: string; cycles: CycleRow[]; onClose: () => void; onReprocess: () => void }) {
  const c0 = cycles.find((c) => c.id === cycleId);
  const [c, setC] = useState<SterilCycle | null>(c0 ?? null);
  const [items, setItems] = useState<SterilItem[]>([]);
  const [impact, setImpact] = useState<RecallImpact[]>([]);
  const [r, setR] = useState<Record<string, string>>({});
  useEffect(() => {
    void listCycleItems(cycleId).then(setItems);
    void recallImpact(cycleId).then(setImpact);
    if (c0) setR({ temperature_c: c0.temperature_c?.toString() ?? "", pressure_kpa: c0.pressure_kpa?.toString() ?? "", exposure_min: c0.exposure_min?.toString() ?? "",
      physical_result: c0.physical_result ?? "", chemical_result: c0.chemical_result ?? "", biological_result: c0.biological_result ?? "", sterilized_on: c0.sterilized_on ?? localDate(), expires_on: c0.expires_on ?? "" });
  }, [cycleId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  const act = async (fn: () => Promise<SterilCycle>) => {
    try {
      setC(await fn());
      setImpact(await recallImpact(cycleId));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };
  const editing = c.status === "awaiting_release";
  const sel = (k: string, opts: [string, string][]) => (
    <Select id={`ld-${k}`} value={r[k] ?? ""} onChange={(e) => setR({ ...r, [k]: e.target.value })} disabled={!editing}><option value="">—</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
  );
  return (
    <Modal title={`Load ${c0?.equipment_code ?? ""} · ${c.cycle_no}`} onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CLS[c.status]}`}>{CYCLE_STATUS[c.status]}</span>
          <span>Run by {c.operator_name} · {fmtWhen(c.started_at)}</span>
          {c.released_by_name && <span>Released by {c.released_by_name} · {fmtWhen(c.released_at)}</span>}
          {c.failure_reason && <span className="text-rose-700">Failed: {c.failure_reason} · Action: {c.corrective_action}</span>}
          {c.recall_reason && <span className="text-rose-700">Recalled: {c.recall_reason} ({c.recalled_by_name})</span>}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-neutral-600">Sets</p>
          <p className="text-xs">{items.map((i) => `${i.set_name}${i.set_code ? ` (${i.set_code})` : ""}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(" · ")}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Temperature (°C)"><Input id="ld-temp" type="number" value={r.temperature_c ?? ""} disabled={!editing} onChange={(e) => setR({ ...r, temperature_c: e.target.value })} /></Field>
          <Field label="Pressure (kPa)"><Input id="ld-press" type="number" value={r.pressure_kpa ?? ""} disabled={!editing} onChange={(e) => setR({ ...r, pressure_kpa: e.target.value })} /></Field>
          <Field label="Exposure (minutes)"><Input id="ld-exp" type="number" value={r.exposure_min ?? ""} disabled={!editing} onChange={(e) => setR({ ...r, exposure_min: e.target.value })} /></Field>
          <Field label="Physical monitoring">{sel("physical_result", [["pass", "Pass"], ["fail", "Fail"]])}</Field>
          <Field label="Chemical indicator">{sel("chemical_result", [["pass", "Pass"], ["fail", "Fail"]])}</Field>
          <Field label="Biological indicator">{sel("biological_result", [["pending", "Pending (incubating)"], ["pass", "Pass"], ["fail", "Fail"], ["na", "Not used in this load"]])}</Field>
          <Field label="Sterilized on"><Input id="ld-on" type="date" value={r.sterilized_on ?? ""} disabled={!editing} onChange={(e) => setR({ ...r, sterilized_on: e.target.value })} /></Field>
          <Field label="Expires on (as marked)"><Input id="ld-exp-on" type="date" value={r.expires_on ?? ""} disabled={!editing} onChange={(e) => setR({ ...r, expires_on: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-3">
          {editing && (
            <>
              <Button onClick={() => void act(() => recordCycleResults(c.id, {
                temperature_c: r.temperature_c ? Number(r.temperature_c) : null, pressure_kpa: r.pressure_kpa ? Number(r.pressure_kpa) : null, exposure_min: r.exposure_min ? Number(r.exposure_min) : null,
                physical_result: (r.physical_result || null) as SterilCycle["physical_result"], chemical_result: (r.chemical_result || null) as SterilCycle["chemical_result"],
                biological_result: (r.biological_result || null) as SterilCycle["biological_result"], sterilized_on: r.sterilized_on || null, expires_on: r.expires_on || null,
              }))}>Save results</Button>
              <Button variant="ghost" onClick={() => { const why = window.prompt("What failed?"); const fix = why ? window.prompt("Corrective action taken:") : null; if (why?.trim() && fix?.trim()) void act(() => failCycle(c.id, why, fix)); }}>Mark failed</Button>
              <Button variant="primary" onClick={() => void act(() => releaseCycle(c.id))}>Release load</Button>
            </>
          )}
          {c.status === "released" && c.biological_result === "pending" && (
            <>
              <Button onClick={() => void act(() => recordBiologicalResult(c.id, "pass"))}>Biological: pass</Button>
              <Button variant="danger" onClick={() => { if (window.confirm("The biological indicator failed? This recalls the load.")) void act(() => recordBiologicalResult(c.id, "fail")); }}>Biological: fail</Button>
            </>
          )}
          {c.status === "released" && <Button variant="danger" onClick={() => { const why = window.prompt("Recall this load? Reason:"); if (why?.trim()) void act(() => recallCycle(c.id, why)); }}>Recall</Button>}
          {(c.status === "failed" || c.status === "recalled") && !c.reprocessed_in_cycle_id && <Button onClick={onReprocess}>Reprocess in a new load</Button>}
        </div>
        {impact.length > 0 && (
          <div className={`rounded-xl p-3 text-xs ${c.status === "recalled" ? "bg-rose-50" : "bg-neutral-50"}`}>
            <p className="mb-1 font-semibold">{c.status === "recalled" ? "Sets from this load were used in these surgeries (follow up):" : "Used in:"}</p>
            {impact.map((x, i) => <p key={i}>{fmtWhen(x.used_at)} · {x.set_name} · {x.surgery_name} · {x.patient_name} ({x.mr_no}) · {x.episode_no}</p>)}
          </div>
        )}
      </div>
    </Modal>
  );
}

function SteriliserModal({ eq, onClose, onSaved }: { eq: SterilEquipment | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ code: eq?.code ?? "", name: eq?.name ?? "", kind: eq?.kind ?? "steam_autoclave", location: eq?.location ?? "", is_active: eq?.is_active ?? 1 });
  async function save() {
    try {
      await saveSteriliser(eq?.id ?? null, v as Parameters<typeof saveSteriliser>[1]);
      onSaved();
    } catch (e) {
      window.alert(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return (
    <Modal title={eq ? "Edit steriliser" : "Add steriliser"} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Code" required><Input id="eq-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="AC-1" /></Field>
        <Field label="Name" required><Input id="eq-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Autoclave 1 (CSSD)" /></Field>
        <Field label="Type"><Select id="eq-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as SterilEquipment["kind"] })}>{Object.entries(STERILISER_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Location"><Input id="eq-loc" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} /></Field>
        <Field label="Status"><Select id="eq-active" value={String(v.is_active)} onChange={(e) => setV({ ...v, is_active: Number(e.target.value) })}><option value="1">In use</option><option value="0">Not in use</option></Select></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></div>
    </Modal>
  );
}
